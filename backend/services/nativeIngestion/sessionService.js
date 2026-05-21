const { AppError } = require("../../lib/AppError");
const { logger } = require("../../lib/logger");
const { pool } = require("../../db");
const { createAuditLog } = require("../../repositories/auditRepository");
const {
  createUploadBatch,
  createUploadErrors,
  upsertProjectByNumber,
} = require("../../repositories/designProjectCatalogRepository");
const { getActiveWorkflowForDepartment } = require("../../repositories/fixtureWorkflowRepository");
const {
  buildVisibleUsersCte,
  visibleFixturePredicate,
} = require("../../repositories/projectVisibility");
const {
  createIngestionSession,
  finalizeIngestionSessionPreview,
  getDraftIngestionSessionForUser,
  getIngestionSessionById,
  markIngestionSessionCommitted,
} = require("../../repositories/ingestionSessionRepository");
const {
  deleteStorageObjects,
  promoteStagedExtractedDesignImage,
  uploadBufferToSupabaseStorage,
} = require("../../lib/supabaseStorage");
const {
  CATALOG_MEMBERSHIP_MODES,
  synchronizeDesignWorkflowTruthFromIngestion,
} = require("../designWorkflowSync/workflowTruthSynchronizationService");
const {
  buildNativeTemplateWorkbook,
  parseNativeClipboard,
  parseNativeWorkbook,
} = require("./excelParser");
const {
  collapseWhitespace,
  normalizeNativeContext,
} = require("./normalization");
const {
  resolveNativeDepartmentId,
  validateNativeRows,
} = require("./validation");

const NATIVE_SUBSYSTEM = "native_spreadsheet_ingestion";
const NATIVE_INGESTION_SOURCE = "native_workspace";

function parseJsonLike(value, fallback = {}) {
  if (!value) {
    return fallback;
  }
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch (_error) {
      return fallback;
    }
  }
  return typeof value === "object" ? value : fallback;
}

function sanitizeStorageSegment(value, fallback) {
  const sanitized = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  return sanitized || fallback;
}

function buildNativeFileInfo(context) {
  return {
    project_code: context.project_no || "",
    project_name_display: context.project_no || "Native spreadsheet workspace",
    company_name: context.customer || "",
    metadata_source: NATIVE_INGESTION_SOURCE,
  };
}

function normalizeResolution(value) {
  const normalized = collapseWhitespace(value).toLowerCase();
  if (["merge", "replace", "skip"].includes(normalized)) {
    return normalized;
  }
  return "";
}

function requireNativeSession(sessionRow) {
  if (!sessionRow) {
    throw new AppError(400, "Invalid, expired, or already committed native ingestion session");
  }

  const snapshot = parseJsonLike(sessionRow.snapshot, {});
  if (snapshot.subsystem && snapshot.subsystem !== NATIVE_SUBSYSTEM) {
    throw new AppError(400, "Session does not belong to the native ingestion subsystem");
  }

  return snapshot;
}

async function getNativeDraftSession(user, sessionId, context = {}, client = pool) {
  const normalizedContext = normalizeNativeContext(context, user);
  const departmentId = resolveNativeDepartmentId(user, normalizedContext.department_id);
  const sessionRow = await getDraftIngestionSessionForUser(
    sessionId,
    departmentId,
    user.employee_id,
    client,
  );

  const snapshot = requireNativeSession(sessionRow);
  return { sessionRow, snapshot, departmentId };
}

async function persistNativeSnapshot(sessionId, context, rows, extra = {}) {
  const existing = await getIngestionSessionById(sessionId, pool);
  const previousSnapshot = parseJsonLike(existing?.snapshot, {});
  const stagingObjectPaths = [
    ...(Array.isArray(previousSnapshot.staging_object_paths) ? previousSnapshot.staging_object_paths : []),
    ...(Array.isArray(extra.staging_object_paths) ? extra.staging_object_paths : []),
  ];
  const uniqueStaging = [];
  const seen = new Set();
  for (const entry of stagingObjectPaths) {
    const key = `${entry?.bucket || ""}::${entry?.path || ""}`;
    if (!entry?.path || seen.has(key)) {
      continue;
    }
    seen.add(key);
    uniqueStaging.push(entry);
  }

  await finalizeIngestionSessionPreview(sessionId, {
    file_info: buildNativeFileInfo(context),
    snapshot: {
      ...previousSnapshot,
      ...extra,
      subsystem: NATIVE_SUBSYSTEM,
      version: 1,
      context,
      rows: Array.isArray(rows) ? rows : [],
      staging_object_paths: uniqueStaging,
      updated_at: new Date().toISOString(),
    },
  }, pool);
}

async function createNativeIngestionSession(user, payload = {}) {
  const context = normalizeNativeContext(payload.context || {}, user);
  const departmentId = resolveNativeDepartmentId(user, context.department_id);
  const session = await createIngestionSession({
    department_id: departmentId,
    created_by_employee_id: user.employee_id,
    file_info: buildNativeFileInfo({ ...context, department_id: departmentId }),
    snapshot: {
      subsystem: NATIVE_SUBSYSTEM,
      version: 1,
      context: { ...context, department_id: departmentId },
      rows: Array.isArray(payload.rows) ? payload.rows : [],
      source: "workspace_open",
      staging_object_paths: [],
    },
  }, pool);

  return {
    session_id: session.id,
    expires_at: session.expires_at,
    context: { ...context, department_id: departmentId },
    rows: Array.isArray(payload.rows) ? payload.rows : [],
  };
}

async function saveNativeDraft(user, sessionId, payload = {}) {
  const context = normalizeNativeContext(payload.context || {}, user);
  await getNativeDraftSession(user, sessionId, context, pool);
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  await persistNativeSnapshot(sessionId, context, rows, {
    source: payload.source || "save_draft",
  });

  return {
    session_id: sessionId,
    saved_at: new Date().toISOString(),
    row_count: rows.length,
  };
}

async function importNativeExcel(user, sessionId, file, payload = {}) {
  const context = normalizeNativeContext(payload.context || {}, user);
  await getNativeDraftSession(user, sessionId, context, pool);
  const parsed = parseNativeWorkbook(file);

  await persistNativeSnapshot(sessionId, context, parsed.rows, {
    source: "excel_import",
    workbook: {
      file_name: file?.originalname || null,
      sheet_name: parsed.sheet_name,
      imported_at: new Date().toISOString(),
    },
  });

  return {
    session_id: sessionId,
    rows: parsed.rows,
    sheet_name: parsed.sheet_name,
  };
}

async function pasteNativeClipboardRows(user, sessionId, payload = {}) {
  const context = normalizeNativeContext(payload.context || {}, user);
  await getNativeDraftSession(user, sessionId, context, pool);
  const rows = parseNativeClipboard(payload.text);
  await persistNativeSnapshot(sessionId, context, rows, {
    source: "clipboard_paste",
  });

  return {
    session_id: sessionId,
    rows,
  };
}

async function validateNativeSession(user, sessionId, payload = {}) {
  const context = normalizeNativeContext(payload.context || {}, user);
  await getNativeDraftSession(user, sessionId, context, pool);
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const validation = await validateNativeRows(user, { context, rows }, pool);

  await persistNativeSnapshot(sessionId, validation.context, rows, {
    source: payload.source || "validate",
    validation,
  });

  return {
    session_id: sessionId,
    ...validation,
  };
}

function collectStagingPaths(rows) {
  const paths = [];
  for (const row of rows || []) {
    const storage = row?.image_storage && typeof row.image_storage === "object" ? row.image_storage : {};
    for (const slotName of ["image_1_url", "image_2_url"]) {
      const meta = storage[slotName];
      if (meta?.staging && meta?.path) {
        paths.push({ bucket: meta.bucket, path: meta.path });
      }
    }
  }
  return paths;
}

async function promoteNativeStagedImages(row, context, productionPathsAccumulator) {
  let next = { ...row };
  const storage = next.image_storage && typeof next.image_storage === "object" ? next.image_storage : {};
  for (const slotName of ["image_1_url", "image_2_url"]) {
    const meta = storage[slotName];
    if (!meta?.staging || !meta.bucket || !meta.path) {
      continue;
    }

    const promoted = await promoteStagedExtractedDesignImage({
      sourceBucket: meta.bucket,
      sourcePath: meta.path,
      fileInfo: { project_code: context.project_no },
      row: next,
      slotName,
    });

    productionPathsAccumulator.push({ bucket: promoted.bucket, path: promoted.path });
    next = {
      ...next,
      [slotName]: promoted.publicUrl,
      image_storage: {
        ...(next.image_storage || {}),
        [slotName]: {
          bucket: promoted.bucket,
          path: promoted.path,
          staging: false,
        },
      },
    };
  }
  return next;
}

function rowForMerge(validationRow) {
  const incoming = validationRow.incoming;
  const existing = validationRow.existing;
  if (!existing) {
    return incoming;
  }

  return {
    ...incoming,
    part_name: existing.part_name,
    fixture_type: existing.fixture_type,
    image_1_url: incoming.image_1_url || existing.image_1_url || null,
    image_2_url: incoming.image_2_url || existing.image_2_url || null,
  };
}

function buildRowsForCommit(validationRows, resolutions) {
  const rowsToPromote = [];
  const skippedRows = [];
  const unresolvedConflicts = [];

  for (const row of validationRows) {
    if (row.severity === "error") {
      continue;
    }

    if (row.classification === "CONFLICT") {
      const resolution = normalizeResolution(resolutions[row.row_id] || resolutions[row.incoming?.fixture_no]);
      if (!resolution) {
        unresolvedConflicts.push(row);
        continue;
      }
      if (resolution === "skip") {
        skippedRows.push(row);
        continue;
      }
      rowsToPromote.push(resolution === "merge" ? rowForMerge(row) : row.incoming);
      continue;
    }

    if (row.classification === "NEW" || row.classification === "UPDATED") {
      rowsToPromote.push(row.incoming);
    }
  }

  return { rowsToPromote, skippedRows, unresolvedConflicts };
}

async function assertNoHiddenFixtureConflicts(user, projectId, fixtureNos, client) {
  const normalizedFixtureNos = [...new Set(fixtureNos.map(collapseWhitespace).filter(Boolean))];
  if (normalizedFixtureNos.length === 0) {
    return;
  }

  const result = await client.query(
    `
      ${buildVisibleUsersCte("$1")}
      SELECT f.fixture_no
      FROM design.fixtures f
      JOIN design.projects p
        ON p.id = f.project_id
      WHERE f.project_id = $2
        AND f.fixture_no = ANY($3::text[])
        AND NOT (${visibleFixturePredicate("f", "p")})
      LIMIT 1
    `,
    [user.employee_id, projectId, normalizedFixtureNos],
  );

  if (result.rows.length > 0) {
    throw new AppError(403, "One or more native Fixture No values are outside your reporting-tree visibility.");
  }
}

async function commitNativeSession(user, sessionId, payload = {}) {
  const context = normalizeNativeContext(payload.context || {}, user);
  const { sessionRow, snapshot } = await getNativeDraftSession(user, sessionId, context, pool);
  const rows = Array.isArray(payload.rows) ? payload.rows : (Array.isArray(snapshot.rows) ? snapshot.rows : []);
  const resolutions = payload.resolutions && typeof payload.resolutions === "object" ? payload.resolutions : {};
  const validation = await validateNativeRows(user, { context, rows }, pool);
  const invalidRows = validation.rows.filter((row) => row.severity === "error");

  if (invalidRows.length > 0) {
    throw new AppError(400, "Native ingestion has blocking validation errors.", {
      invalid_rows: invalidRows,
      summary: validation.summary,
    }, "NATIVE_INGESTION_VALIDATION_FAILED");
  }

  const { rowsToPromote, skippedRows, unresolvedConflicts } = buildRowsForCommit(validation.rows, resolutions);
  if (unresolvedConflicts.length > 0) {
    throw new AppError(409, "Resolve every native ingestion conflict before commit.", {
      conflicts: unresolvedConflicts,
    }, "NATIVE_INGESTION_CONFLICTS_UNRESOLVED");
  }

  if (rowsToPromote.length === 0 && skippedRows.length === 0) {
    throw new AppError(400, "No native ingestion rows are ready to commit.");
  }

  const allStagingPaths = [
    ...collectStagingPaths(rows),
    ...(
      Array.isArray(snapshot.staging_object_paths)
        ? snapshot.staging_object_paths.filter((entry) => entry?.path)
        : []
    ),
  ];
  const productionPathsForCleanup = [];
  let promotedRows = [];

  try {
    for (const row of rowsToPromote) {
      promotedRows.push(await promoteNativeStagedImages(row, validation.context, productionPathsForCleanup));
    }
  } catch (error) {
    await deleteStorageObjects(productionPathsForCleanup).catch(() => {});
    await deleteStorageObjects(allStagingPaths).catch(() => {});
    throw error;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const workflow = await getActiveWorkflowForDepartment(validation.context.department_id, client);
    if (!workflow || !Array.isArray(workflow.stages) || workflow.stages.length === 0) {
      throw new AppError(409, `No workflow configured for department ${validation.context.department_id}`);
    }

    const project = await upsertProjectByNumber({
      project_no: validation.context.project_no,
      project_name: validation.context.project_no,
      customer_name: validation.context.customer,
      department_id: validation.context.department_id,
      uploaded_by: user.employee_id,
      created_by_user_id: user.employee_id,
    }, client);

    await assertNoHiddenFixtureConflicts(
      user,
      project.project_id,
      promotedRows.map((row) => row.fixture_no),
      client,
    );

    const skippedErrorRows = skippedRows.map((row) => ({
      row_number: row.row_number || 0,
      excel_row: null,
      row_reference: row.row_id,
      error_message: "Conflict skipped in native ingestion workspace.",
      raw_data: {
        classification: row.classification,
        issues: row.issues,
        incoming: row.incoming,
        existing: row.existing,
      },
    }));

    const batchId = await createUploadBatch({
      project_id: project.project_id,
      uploaded_by: user.employee_id,
      uploaded_by_user_id: user.employee_id,
      total_rows: promotedRows.length + skippedErrorRows.length,
      accepted_rows: promotedRows.length,
      rejected_rows: skippedErrorRows.length,
    }, client);

    const syncAudit = await synchronizeDesignWorkflowTruthFromIngestion(client, {
      projectId: project.project_id,
      batchId,
      departmentId: validation.context.department_id,
      employeeId: user.employee_id,
      ingestionSource: NATIVE_INGESTION_SOURCE,
      promotedFixtureRows: promotedRows,
      workflowStages: workflow.stages,
      catalogMembershipMode: CATALOG_MEMBERSHIP_MODES.DELTA,
    });

    if (skippedErrorRows.length > 0) {
      await createUploadErrors(batchId, skippedErrorRows, client);
    }

    await createAuditLog({
      userEmployeeId: user.employee_id,
      actionType: "DESIGN_NATIVE_INGESTION_COMMITTED",
      targetType: "design_upload_batch",
      targetId: batchId,
      metadata: {
        session_id: sessionRow.id,
        project_id: project.project_id,
        project_no: validation.context.project_no,
        created_fixture_nos: syncAudit.created_fixture_nos,
        updated_fixture_nos: syncAudit.updated_fixture_nos,
        skipped_conflicts: skippedRows.map((row) => row.incoming?.fixture_no),
        summary: validation.summary,
      },
    }, client);

    await client.query("COMMIT");
    await markIngestionSessionCommitted(sessionId, batchId, pool);
    await deleteStorageObjects(allStagingPaths).catch(() => {});

    return {
      success: true,
      session_id: sessionId,
      batch_id: batchId,
      accepted_count: syncAudit.created_fixture_nos.length + syncAudit.updated_fixture_nos.length,
      created_fixture_nos: syncAudit.created_fixture_nos,
      updated_fixture_nos: syncAudit.updated_fixture_nos,
      skipped_count: skippedRows.length,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    await deleteStorageObjects(productionPathsForCleanup).catch(() => {});
    await deleteStorageObjects(allStagingPaths).catch(() => {});
    logger.error("Native ingestion commit failed", {
      session_id: sessionId,
      employee_id: user?.employee_id,
      project_no: validation.context.project_no,
      errorMessage: error?.message || String(error),
      code: error?.code || null,
      constraint: error?.constraint || null,
    });
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(500, "Native ingestion commit failed. The transaction was rolled back.", {
      code: error?.code || null,
      constraint: error?.constraint || null,
      detail: error?.detail || null,
    });
  } finally {
    client.release();
  }
}

async function stageNativeIngestionImage(user, sessionId, file, payload = {}) {
  if (!file?.buffer) {
    throw new AppError(400, "No native ingestion image uploaded");
  }

  const context = normalizeNativeContext(payload.context || {}, user);
  const { snapshot } = await getNativeDraftSession(user, sessionId, context, pool);
  const imageSlot = payload.image_slot === "image_2_url" ? "image_2_url" : "image_1_url";
  const extension = String(file.originalname || "").split(".").pop();
  const rowId = sanitizeStorageSegment(payload.row_id, "row");
  const fixtureNo = sanitizeStorageSegment(payload.fixture_no, rowId);

  const uploaded = await uploadBufferToSupabaseStorage({
    buffer: file.buffer,
    mimeType: file.mimetype,
    extension,
    folder: `design-native-ingestion-staging/${sanitizeStorageSegment(sessionId, "session")}/${sanitizeStorageSegment(context.project_no, "project")}/${fixtureNo}`,
    fileStem: `${sanitizeStorageSegment(imageSlot.replace(/_url$/i, ""), "image")}-${rowId}`,
  });

  const rows = Array.isArray(snapshot.rows) ? snapshot.rows : [];
  await persistNativeSnapshot(sessionId, context, rows, {
    source: "image_stage",
    staging_object_paths: [{ bucket: uploaded.bucket, path: uploaded.path }],
  });

  return {
    public_url: uploaded.publicUrl,
    image_slot: imageSlot,
    storage: {
      bucket: uploaded.bucket,
      path: uploaded.path,
      staging: true,
    },
  };
}

module.exports = {
  NATIVE_INGESTION_SOURCE,
  NATIVE_SUBSYSTEM,
  buildNativeTemplateWorkbook,
  commitNativeSession,
  createNativeIngestionSession,
  importNativeExcel,
  pasteNativeClipboardRows,
  saveNativeDraft,
  stageNativeIngestionImage,
  validateNativeSession,
};
