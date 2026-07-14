const fs = require("fs/promises");
const path = require("path");
const { AppError } = require("../../lib/AppError");
const { logger } = require("../../lib/logger");
const { pool } = require("../../db");
const { getUploadsRoot } = require("../../lib/runtimePaths");
const { generateUUID } = require("../../lib/uuid");
const { createAuditLog } = require("../../repositories/auditRepository");
const { requireOwningLeaderPair } = require("../accessControlService");
const {
  createUploadBatch,
  updateProjectIdentityById,
  upsertProjectByNumber,
} = require("../../repositories/designProjectCatalogRepository");
const { getActiveWorkflowForDepartment } = require("../../repositories/fixtureWorkflowRepository");
const {
  buildVisibleUsersCte,
  visibleFixturePredicate,
  visibleProjectPredicate,
} = require("../../repositories/projectVisibility");
const {
  createIngestionSession,
  finalizeIngestionSessionPreview,
  getDraftIngestionSessionForUser,
  getIngestionSessionById,
  markIngestionSessionCommitted,
} = require("../../repositories/ingestionSessionRepository");
const {
  DEFAULT_DESIGN_IMAGE_MAX_SIZE_BYTES,
  deleteStorageObjects,
  normalizeExtension,
  normalizeMimeType,
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
  formatProjectIdentity,
  normalizeNativeContext,
} = require("./normalization");
const {
  loadProjectTruthForNative,
  resolveNativeDepartmentId,
  validateNativeRows,
} = require("./validation");

const NATIVE_SUBSYSTEM = "native_spreadsheet_ingestion";
const NATIVE_INGESTION_SOURCE = "native_workspace";
const REFERENCE_IMAGE_SLOT = "reference_image_url";
const DB_REFERENCE_IMAGE_SLOT = "image_1_url";
const LOCAL_STORAGE_ADAPTER = "local";
const SUPABASE_STORAGE_ADAPTER = "supabase";

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

function uploadsRoot() {
  return getUploadsRoot();
}

function toPublicUploadUrl(relativePath) {
  return `/uploads/${String(relativePath || "").split(path.sep).join("/")}`;
}

function resolveLocalUploadPath(relativePath) {
  const root = uploadsRoot();
  const target = path.resolve(root, String(relativePath || ""));
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new AppError(400, "Invalid local image storage path");
  }
  return target;
}

function buildNativeFileInfo(context) {
  return {
    project_code: context.project_code || "",
    project_name_display: context.project_name || context.project_code || "Native fixture workspace",
    company_name: context.customer_name || "",
    metadata_source: NATIVE_INGESTION_SOURCE,
  };
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

function mergeNativeContextDepartment(context, departmentId) {
  return {
    ...context,
    department_id: departmentId || "",
  };
}

async function getNativeDraftSession(user, sessionId, context = {}, client = pool, options = {}) {
  const normalizedContext = normalizeNativeContext(context, user);
  const sessionRow = await getDraftIngestionSessionForUser(
    sessionId,
    null,
    user.employee_id,
    client,
  );

  const snapshot = requireNativeSession(sessionRow);
  const sessionDepartmentId = collapseWhitespace(sessionRow.department_id);
  const requestedDepartmentId = collapseWhitespace(normalizedContext.department_id);
  const candidateDepartmentId = requestedDepartmentId || sessionDepartmentId;
  const departmentId = resolveNativeDepartmentId(user, candidateDepartmentId, options);

  if (sessionDepartmentId && departmentId && sessionDepartmentId !== departmentId) {
    throw new AppError(403, "Native ingestion session is already bound to another department");
  }

  return {
    sessionRow,
    snapshot,
    departmentId,
    context: mergeNativeContextDepartment(normalizedContext, departmentId),
  };
}

function mergeStagingPaths(previousSnapshot, extra = {}) {
  const stagingObjectPaths = [
    ...(Array.isArray(previousSnapshot.staging_object_paths) ? previousSnapshot.staging_object_paths : []),
    ...(Array.isArray(extra.staging_object_paths) ? extra.staging_object_paths : []),
  ];
  const uniqueStaging = [];
  const seen = new Set();
  for (const entry of stagingObjectPaths) {
    const key = `${entry?.adapter || entry?.bucket || ""}::${entry?.path || ""}`;
    if (!entry?.path || seen.has(key)) {
      continue;
    }
    seen.add(key);
    uniqueStaging.push(entry);
  }
  return uniqueStaging;
}

async function persistNativeSnapshot(sessionId, context, rows, extra = {}, departmentId = null) {
  const existing = await getIngestionSessionById(sessionId, pool);
  const previousSnapshot = parseJsonLike(existing?.snapshot, {});

  await finalizeIngestionSessionPreview(sessionId, {
    department_id: departmentId,
    file_info: buildNativeFileInfo(context),
    snapshot: {
      ...previousSnapshot,
      ...extra,
      subsystem: NATIVE_SUBSYSTEM,
      version: 2,
      context,
      rows: Array.isArray(rows) ? rows : [],
      staging_object_paths: mergeStagingPaths(previousSnapshot, extra),
      updated_at: new Date().toISOString(),
    },
  }, pool);
}

async function createNativeIngestionSession(user, payload = {}) {
  const context = normalizeNativeContext(payload.context || {}, user);
  const departmentId = resolveNativeDepartmentId(user, context.department_id, {
    requireDepartment: false,
  });
  const sessionContext = mergeNativeContextDepartment(context, departmentId);
  const session = await createIngestionSession({
    department_id: departmentId,
    created_by_employee_id: user.employee_id,
    file_info: buildNativeFileInfo(sessionContext),
    snapshot: {
      subsystem: NATIVE_SUBSYSTEM,
      version: 2,
      context: sessionContext,
      rows: Array.isArray(payload.rows) ? payload.rows : [],
      source: "workspace_open",
      staging_object_paths: [],
    },
  }, pool);

  return {
    session_id: session.id,
    expires_at: session.expires_at,
    context: sessionContext,
    rows: Array.isArray(payload.rows) ? payload.rows : [],
  };
}

function buildRowsFromExistingFixtures(fixtures = []) {
  return fixtures.map((fixture, index) => ({
    row_id: `native-existing-${fixture.fixture_id || index + 1}`,
    row_number: index + 1,
    status: "EXISTING",
    classification: "EXISTING",
    severity: "safe",
    fixture_no: fixture.fixture_no || "",
    part_name: fixture.part_name || "",
    fixture_type: fixture.fixture_type || "",
    remark: fixture.remark || "",
    qty: fixture.qty === null || fixture.qty === undefined ? "" : String(fixture.qty),
    assigned_team: fixture.assigned_team || "",
    is_outsourced: fixture.is_outsourced === true,
    vendor_name: fixture.vendor_name || "",
    reference_image_url: fixture.reference_image_url || fixture.image_1_url || "",
    validation_state: "Loaded from existing project",
    cell_states: {},
    issues: [],
    existing: fixture,
  }));
}

async function resolveVisibleProjectForNativeEdit(user, projectReference, requestedDepartmentId, client = pool) {
  const normalizedReference = collapseWhitespace(projectReference);
  if (!normalizedReference) {
    throw new AppError(400, "project_id is required for native project editing");
  }

  const result = await client.query(
    `
      ${buildVisibleUsersCte("$1")}
      SELECT
        p.id AS project_id,
        p.project_no,
        p.project_name,
        p.customer_name,
        p.department_id,
        d.name AS department_name,
        p.status,
        CASE WHEN p.id::text = $2 THEN 0 ELSE 1 END AS match_rank
      FROM design.projects p
      LEFT JOIN departments d
        ON d.id = p.department_id
      WHERE (p.id::text = $2 OR p.project_no = $2)
        AND ${visibleProjectPredicate("p")}
      ORDER BY match_rank ASC, p.updated_at DESC NULLS LAST, p.created_at DESC NULLS LAST
      LIMIT 1
    `,
    [user.employee_id, normalizedReference],
  );

  const project = result.rows[0] || null;
  if (!project) {
    throw new AppError(404, "Project not found for native editing");
  }

  const projectDepartmentId = collapseWhitespace(project.department_id);
  if (!projectDepartmentId) {
    throw new AppError(409, "Project is missing a department and cannot be opened in the native edit workspace.");
  }

  const requestedDepartment = collapseWhitespace(requestedDepartmentId);
  if (requestedDepartment && requestedDepartment !== projectDepartmentId) {
    logger.warn("Native edit ignored stale department context from project card", {
      project_id: project.project_id,
      requested_department_id: requestedDepartment,
      project_department_id: projectDepartmentId,
    });
  }

  resolveNativeDepartmentId(user, projectDepartmentId, {
    requireDepartment: true,
    message: "Invalid native project edit department context",
  });

  return project;
}

async function createNativeProjectEditSession(user, projectId, payload = {}) {
  const normalizedProjectId = collapseWhitespace(projectId);
  if (!normalizedProjectId) {
    throw new AppError(400, "project_id is required for native project editing");
  }

  const requestedDepartmentId = collapseWhitespace(payload.department_id || payload.departmentId);
  const resolvedProject = await resolveVisibleProjectForNativeEdit(user, normalizedProjectId, requestedDepartmentId, pool);
  await requireOwningLeaderPair(user, resolvedProject.project_id);
  const seedContext = normalizeNativeContext({
    project_id: resolvedProject.project_id,
    project_code: resolvedProject.project_no,
    project_name: resolvedProject.project_name,
    customer_name: resolvedProject.customer_name,
    department_id: resolvedProject.department_id,
    upload_mode: "fixture_delta",
  }, user);
  const truth = await loadProjectTruthForNative(user, {
    ...seedContext,
    department_id: resolvedProject.department_id,
  }, pool);

  if (!truth.project) {
    throw new AppError(404, "Project not found for native editing");
  }

  const context = normalizeNativeContext({
    project_id: truth.project.project_id,
    project_code: truth.project.project_no,
    project_name: truth.project.project_name,
    customer_name: truth.project.customer_name,
    department_id: truth.project.department_id,
    department_name: truth.project.department_name || truth.project.department_id,
    upload_mode: "fixture_delta",
  }, user);
  const sessionContext = {
    ...context,
    project_identity: formatProjectIdentity(context),
  };
  const rows = buildRowsFromExistingFixtures(truth.existing);
  const session = await createIngestionSession({
    department_id: sessionContext.department_id,
    created_by_employee_id: user.employee_id,
    file_info: buildNativeFileInfo(sessionContext),
    snapshot: {
      subsystem: NATIVE_SUBSYSTEM,
      version: 2,
      context: sessionContext,
      rows,
      source: "project_edit_open",
      staging_object_paths: [],
    },
  }, pool);

  return {
    session_id: session.id,
    expires_at: session.expires_at,
    context: sessionContext,
    rows,
  };
}

async function saveNativeDraft(user, sessionId, payload = {}) {
  const context = normalizeNativeContext(payload.context || {}, user);
  const { context: resolvedContext, departmentId } = await getNativeDraftSession(user, sessionId, context, pool, {
    requireDepartment: false,
  });
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  await persistNativeSnapshot(sessionId, resolvedContext, rows, {
    source: payload.source || "save_draft",
  }, departmentId);

  return {
    session_id: sessionId,
    saved_at: new Date().toISOString(),
    row_count: rows.length,
  };
}

async function importNativeExcel(user, sessionId, file, payload = {}) {
  const context = normalizeNativeContext(payload.context || {}, user);
  const { context: resolvedContext, departmentId } = await getNativeDraftSession(user, sessionId, context, pool, {
    requireDepartment: false,
  });
  const parsed = parseNativeWorkbook(file);

  await persistNativeSnapshot(sessionId, resolvedContext, parsed.rows, {
    source: "excel_import",
    workbook: {
      file_name: file?.originalname || null,
      sheet_name: parsed.sheet_name,
      imported_at: new Date().toISOString(),
    },
  }, departmentId);

  return {
    session_id: sessionId,
    rows: parsed.rows,
    sheet_name: parsed.sheet_name,
  };
}

async function pasteNativeClipboardRows(user, sessionId, payload = {}) {
  const context = normalizeNativeContext(payload.context || {}, user);
  const { context: resolvedContext, departmentId } = await getNativeDraftSession(user, sessionId, context, pool, {
    requireDepartment: false,
  });
  const rows = parseNativeClipboard(payload.text);
  await persistNativeSnapshot(sessionId, resolvedContext, rows, {
    source: "clipboard_paste",
  }, departmentId);

  return {
    session_id: sessionId,
    rows,
  };
}

async function validateNativeSession(user, sessionId, payload = {}) {
  const context = normalizeNativeContext(payload.context || {}, user);
  const { context: resolvedContext } = await getNativeDraftSession(user, sessionId, context, pool, {
    requireDepartment: true,
  });
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const validation = await validateNativeRows(user, { context: resolvedContext, rows }, pool);

  await persistNativeSnapshot(sessionId, validation.context, rows, {
    source: payload.source || "validate",
    validation,
  }, validation.context.department_id);

  return {
    session_id: sessionId,
    ...validation,
  };
}

function collectStagingPaths(rows) {
  const paths = [];
  for (const row of rows || []) {
    const storage = row?.image_storage && typeof row.image_storage === "object" ? row.image_storage : {};
    const meta = storage[REFERENCE_IMAGE_SLOT];
    if (meta?.staging && meta?.path) {
      paths.push({
        adapter: meta.adapter || (meta.bucket ? SUPABASE_STORAGE_ADAPTER : LOCAL_STORAGE_ADAPTER),
        bucket: meta.bucket || null,
        path: meta.path,
      });
    }
  }
  return paths;
}

async function deleteNativeStorageObjects(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return;
  }
  const localEntries = entries.filter((entry) => entry?.adapter === LOCAL_STORAGE_ADAPTER && entry.path);
  const supabaseEntries = entries.filter((entry) => entry?.adapter !== LOCAL_STORAGE_ADAPTER && entry?.path);

  for (const entry of localEntries) {
    const target = resolveLocalUploadPath(entry.path);
    await fs.unlink(target).catch((error) => {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    });
  }

  if (supabaseEntries.length > 0) {
    await deleteStorageObjects(supabaseEntries);
  }
}

async function writeLocalStagedImage({ file, sessionId, context, rowId, fixtureNo }) {
  if (!Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
    throw new AppError(400, "Image upload payload is empty");
  }
  if (file.buffer.length > DEFAULT_DESIGN_IMAGE_MAX_SIZE_BYTES) {
    throw new AppError(400, "Image file must be 10 MB or smaller");
  }

  const extension = normalizeExtension(String(file.originalname || "").split(".").pop(), file.mimetype);
  const mimeType = normalizeMimeType(file.mimetype, extension);
  const relativePath = path.join(
    "design-native-staging",
    sanitizeStorageSegment(sessionId, "session"),
    sanitizeStorageSegment(context.project_code, "project"),
    sanitizeStorageSegment(fixtureNo, rowId || "fixture"),
    `reference-image-${sanitizeStorageSegment(rowId, "row")}-${generateUUID()}.${extension}`,
  );
  const target = resolveLocalUploadPath(relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, file.buffer);

  return {
    adapter: LOCAL_STORAGE_ADAPTER,
    path: relativePath,
    publicUrl: toPublicUploadUrl(relativePath),
    mimeType,
  };
}

async function promoteLocalStagedImage({ meta, context, row }) {
  const source = resolveLocalUploadPath(meta.path);
  const extension = normalizeExtension(String(meta.path || "").split(".").pop(), null);
  const relativePath = path.join(
    "design-excel",
    sanitizeStorageSegment(context.project_code, "project"),
    sanitizeStorageSegment(row.fixture_no, `row-${row.row_number || "unknown"}`),
    `reference-image-r${sanitizeStorageSegment(row.row_number, "row")}-${generateUUID()}.${extension}`,
  );
  const target = resolveLocalUploadPath(relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(source, target);

  return {
    adapter: LOCAL_STORAGE_ADAPTER,
    path: relativePath,
    publicUrl: toPublicUploadUrl(relativePath),
  };
}

async function promoteNativeStagedImages(row, context, productionPathsAccumulator) {
  const storage = row.image_storage && typeof row.image_storage === "object" ? row.image_storage : {};
  const meta = storage[REFERENCE_IMAGE_SLOT];
  if (!meta?.staging || !meta.path) {
    return {
      ...row,
      image_1_url: row.reference_image_url || row.image_1_url || null,
      image_2_url: null,
    };
  }

  if (meta.adapter === LOCAL_STORAGE_ADAPTER) {
    const promoted = await promoteLocalStagedImage({ meta, context, row });
    productionPathsAccumulator.push({ adapter: LOCAL_STORAGE_ADAPTER, path: promoted.path });
    return {
      ...row,
      reference_image_url: promoted.publicUrl,
      image_1_url: promoted.publicUrl,
      image_2_url: null,
      image_storage: {
        ...(row.image_storage || {}),
        [REFERENCE_IMAGE_SLOT]: {
          adapter: LOCAL_STORAGE_ADAPTER,
          path: promoted.path,
          staging: false,
        },
      },
    };
  }

  const promoted = await promoteStagedExtractedDesignImage({
    sourceBucket: meta.bucket,
    sourcePath: meta.path,
    fileInfo: { project_code: context.project_code },
    row,
    slotName: DB_REFERENCE_IMAGE_SLOT,
  });

  productionPathsAccumulator.push({
    adapter: SUPABASE_STORAGE_ADAPTER,
    bucket: promoted.bucket,
    path: promoted.path,
  });
  return {
    ...row,
    reference_image_url: promoted.publicUrl,
    image_1_url: promoted.publicUrl,
    image_2_url: null,
    image_storage: {
      ...(row.image_storage || {}),
      [REFERENCE_IMAGE_SLOT]: {
        adapter: SUPABASE_STORAGE_ADAPTER,
        bucket: promoted.bucket,
        path: promoted.path,
        staging: false,
      },
    },
  };
}

function buildRowsForCommit(validationRows) {
  return validationRows
    .filter((row) => row.severity !== "error")
    .filter((row) => row.classification !== "DUPLICATE")
    .map((row) => row.incoming);
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

async function resolveNativeCommitProject(user, validation, client) {
  const context = validation.context || {};
  if (context.project_id) {
    if (!validation.project) {
      throw new AppError(404, "Project not found for native editing");
    }

    return updateProjectIdentityById({
      project_id: context.project_id,
      project_no: context.project_code,
      project_name: context.project_name,
      customer_name: context.customer_name,
      department_id: context.department_id,
      uploaded_by: user.employee_id,
    }, client);
  }

  return upsertProjectByNumber({
    project_no: context.project_code,
    project_name: context.project_name,
    customer_name: context.customer_name,
    department_id: context.department_id,
    uploaded_by: user.employee_id,
    created_by_user_id: user.employee_id,
  }, client);
}

async function commitNativeSession(user, sessionId, payload = {}) {
  const context = normalizeNativeContext(payload.context || {}, user);
  const { sessionRow, snapshot, context: resolvedContext } = await getNativeDraftSession(user, sessionId, context, pool, {
    requireDepartment: true,
  });
  const rows = Array.isArray(payload.rows) ? payload.rows : (Array.isArray(snapshot.rows) ? snapshot.rows : []);
  const validation = await validateNativeRows(user, { context: resolvedContext, rows }, pool);
  const invalidRows = validation.rows.filter((row) => row.severity === "error");

  if (invalidRows.length > 0) {
    throw new AppError(400, "Native ingestion has blocking validation errors.", {
      invalid_rows: invalidRows,
      summary: validation.summary,
    }, "NATIVE_INGESTION_VALIDATION_FAILED");
  }

  if (validation.context?.project_id) {
    await requireOwningLeaderPair(user, validation.context.project_id);
  }

  const rowsToPromote = buildRowsForCommit(validation.rows);
  if (rowsToPromote.length === 0) {
    throw new AppError(400, "No populated native ingestion rows are ready to commit.");
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
    await deleteNativeStorageObjects(productionPathsForCleanup).catch(() => {});
    await deleteNativeStorageObjects(allStagingPaths).catch(() => {});
    throw error;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const workflow = await getActiveWorkflowForDepartment(validation.context.department_id, client);
    if (!workflow || !Array.isArray(workflow.stages) || workflow.stages.length === 0) {
      throw new AppError(409, `No workflow configured for department ${validation.context.department_id}`);
    }

    const project = await resolveNativeCommitProject(user, validation, client);

    await assertNoHiddenFixtureConflicts(
      user,
      project.project_id,
      promotedRows.map((row) => row.fixture_no),
      client,
    );

    const projectWasCreated = project.was_created === true;
    const batchId = await createUploadBatch({
        project_id: project.project_id,
        uploaded_by: user.employee_id,
        uploaded_by_user_id: user.employee_id,
        total_rows: promotedRows.length,
        accepted_rows: promotedRows.length,
        rejected_rows: 0,
      }, client);

    const syncAudit = await synchronizeDesignWorkflowTruthFromIngestion(client, {
      projectId: project.project_id,
      batchId,
      departmentId: validation.context.department_id,
      employeeId: user.employee_id,
      ingestionSource: NATIVE_INGESTION_SOURCE,
      promotedFixtureRows: promotedRows,
      workflowStages: workflow.stages,
      catalogMembershipMode: validation.context.upload_mode === "full_project_update"
        ? CATALOG_MEMBERSHIP_MODES.FULL_REPLACE
        : CATALOG_MEMBERSHIP_MODES.DELTA,
    });

    await createAuditLog({
      userEmployeeId: user.employee_id,
      actionType: "DESIGN_NATIVE_INGESTION_COMMITTED",
      targetType: batchId ? "design_upload_batch" : "design_project",
      targetId: batchId || project.project_id,
      metadata: {
        session_id: sessionRow.id,
        project_id: project.project_id,
        project_no: validation.context.project_code,
        project_was_created: projectWasCreated,
        upload_mode: validation.context.upload_mode,
        created_fixture_nos: syncAudit.created_fixture_nos,
        updated_fixture_nos: syncAudit.updated_fixture_nos,
        archived_fixture_nos: syncAudit.archived_fixture_nos,
        unchanged_fixture_nos: syncAudit.unchanged_fixture_nos,
        summary: validation.summary,
      },
    }, client);

    await client.query("COMMIT");
    await markIngestionSessionCommitted(sessionId, batchId, pool);
    await deleteNativeStorageObjects(allStagingPaths).catch(() => {});

    const deletedFixtureNos = syncAudit.archived_fixture_nos || [];
    const updatedFixtureNos = syncAudit.updated_fixture_nos || [];
    const createdFixtureNos = syncAudit.created_fixture_nos || [];
    return {
      success: true,
      session_id: sessionId,
      batch_id: batchId || null,
      project_id: project.project_id,
      project_code: validation.context.project_code,
      project_was_created: projectWasCreated,
      accepted_count: createdFixtureNos.length + updatedFixtureNos.length + deletedFixtureNos.length,
      created_fixture_nos: createdFixtureNos,
      updated_fixture_nos: updatedFixtureNos,
      deleted_fixture_nos: deletedFixtureNos,
      unchanged_fixture_nos: syncAudit.unchanged_fixture_nos || [],
    };
  } catch (error) {
    await client.query("ROLLBACK");
    await deleteNativeStorageObjects(productionPathsForCleanup).catch(() => {});
    await deleteNativeStorageObjects(allStagingPaths).catch(() => {});
    logger.error("Native ingestion commit failed", {
      session_id: sessionId,
      employee_id: user?.employee_id,
      project_no: validation.context.project_code,
      errorMessage: error?.message || String(error),
      code: error?.code || error?.errorCode || null,
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
  const { snapshot, context: resolvedContext, departmentId } = await getNativeDraftSession(user, sessionId, context, pool, {
    requireDepartment: false,
  });
  const rowId = sanitizeStorageSegment(payload.row_id, "row");
  const fixtureNo = sanitizeStorageSegment(payload.fixture_no, rowId);
  const extension = String(file.originalname || "").split(".").pop();
  const folder = `design-native-ingestion-staging/${sanitizeStorageSegment(sessionId, "session")}/${sanitizeStorageSegment(resolvedContext.project_code, "project")}/${fixtureNo}`;
  let staged;
  let warning = null;

  try {
    const uploaded = await uploadBufferToSupabaseStorage({
      buffer: file.buffer,
      mimeType: file.mimetype,
      extension,
      folder,
      fileStem: `reference-image-${rowId}`,
    });
    staged = {
      publicUrl: uploaded.publicUrl,
      storage: {
        adapter: SUPABASE_STORAGE_ADAPTER,
        bucket: uploaded.bucket,
        path: uploaded.path,
        staging: true,
      },
    };
  } catch (error) {
    const storageUnavailable = [
      "SUPABASE_STORAGE_NOT_CONFIGURED",
      "SUPABASE_STORAGE_UPLOAD_FAILED",
    ].includes(error?.errorCode);
    if (!storageUnavailable) {
      throw error;
    }
    const local = await writeLocalStagedImage({
      file,
      sessionId,
      context: resolvedContext,
      rowId,
      fixtureNo,
    });
    warning = "Supabase Storage is not configured; image staged locally for this transaction.";
    staged = {
      publicUrl: local.publicUrl,
      storage: {
        adapter: LOCAL_STORAGE_ADAPTER,
        path: local.path,
        staging: true,
        warning,
      },
    };
  }

  const rows = Array.isArray(snapshot.rows) ? snapshot.rows : [];
  await persistNativeSnapshot(sessionId, resolvedContext, rows, {
    source: "image_stage",
    staging_object_paths: [staged.storage],
  }, departmentId);

  return {
    public_url: staged.publicUrl,
    image_slot: REFERENCE_IMAGE_SLOT,
    storage: staged.storage,
    warning,
  };
}

async function queryOptionalDependency(client, sql, params) {
  try {
    return await client.query(sql, params);
  } catch (error) {
    if (error?.code === "42P01") {
      return { rows: [{}], rowCount: 0 };
    }
    throw error;
  }
}

function pushDependencyBlocker(blockers, count, singular, plural = `${singular}s`) {
  const numericCount = Number(count || 0);
  if (numericCount > 0) {
    blockers.push(`${numericCount} ${numericCount === 1 ? singular : plural}`);
  }
}

async function listFixtureDeleteBlockers(fixtureId, client) {
  const blockers = [];

  const taskResult = await queryOptionalDependency(client, `
    SELECT
      COUNT(*)::integer AS total_count,
      COUNT(*) FILTER (WHERE COALESCE(status, '') NOT IN ('closed', 'cancelled'))::integer AS active_count
    FROM tasks
    WHERE fixture_id = $1
  `, [fixtureId]);
  const taskRow = taskResult.rows[0] || {};
  pushDependencyBlocker(blockers, taskRow.active_count, "active task", "active tasks");
  if (Number(taskRow.active_count || 0) === 0) {
    pushDependencyBlocker(blockers, taskRow.total_count, "task history record", "task history records");
  }

  const progressResult = await queryOptionalDependency(client, `
    SELECT COUNT(*)::integer AS touched_count
    FROM fixture_workflow_progress
    WHERE fixture_id = $1
      AND (
        status <> 'PENDING'
        OR assigned_to IS NOT NULL
        OR assigned_at IS NOT NULL
        OR started_at IS NOT NULL
        OR completed_at IS NOT NULL
      )
  `, [fixtureId]);
  pushDependencyBlocker(blockers, progressResult.rows[0]?.touched_count, "started workflow stage", "started workflow stages");

  const attemptResult = await queryOptionalDependency(client, `
    SELECT COUNT(*)::integer AS count
    FROM fixture_workflow_stage_attempts
    WHERE fixture_id = $1
  `, [fixtureId]);
  pushDependencyBlocker(blockers, attemptResult.rows[0]?.count, "workflow attempt", "workflow attempts");

  const revisionResult = await queryOptionalDependency(client, `
    SELECT COUNT(*)::integer AS count
    FROM fixture_workflow_revisions
    WHERE fixture_id = $1
  `, [fixtureId]);
  pushDependencyBlocker(blockers, revisionResult.rows[0]?.count, "workflow revision", "workflow revisions");

  const contributionResult = await queryOptionalDependency(client, `
    SELECT COUNT(*)::integer AS count
    FROM design.fixture_stage_contributions
    WHERE fixture_id = $1
  `, [fixtureId]);
  pushDependencyBlocker(blockers, contributionResult.rows[0]?.count, "stage contribution", "stage contributions");

  const snapshotResult = await queryOptionalDependency(client, `
    SELECT COUNT(*)::integer AS count
    FROM design.workflow_completion_snapshots
    WHERE fixture_id = $1
  `, [fixtureId]);
  pushDependencyBlocker(blockers, snapshotResult.rows[0]?.count, "completion snapshot", "completion snapshots");

  const outsourceResult = await queryOptionalDependency(client, `
    SELECT COUNT(*)::integer AS count
    FROM design.fixture_outsource_records
    WHERE fixture_id = $1
  `, [fixtureId]);
  pushDependencyBlocker(blockers, outsourceResult.rows[0]?.count, "outsource history record", "outsource history records");

  return blockers;
}

async function deleteNativeProjectFixture(user, fixtureId, payload = {}) {
  const normalizedFixtureId = collapseWhitespace(fixtureId);
  if (!normalizedFixtureId) {
    throw new AppError(400, "fixture_id is required");
  }

  const requestedDepartmentId = collapseWhitespace(payload.department_id || payload.departmentId);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const fixtureResult = await client.query(
      `
        ${buildVisibleUsersCte("$1")}
        SELECT
          f.id AS fixture_id,
          f.project_id,
          f.fixture_no,
          p.project_no,
          p.department_id
        FROM design.fixtures f
        JOIN design.projects p
          ON p.id = f.project_id
        WHERE f.id = $2
          AND ($3::text IS NULL OR p.department_id = $3)
          AND ${visibleFixturePredicate("f", "p")}
        LIMIT 1
        FOR UPDATE
      `,
      [user.employee_id, normalizedFixtureId, requestedDepartmentId || null],
    );

    const fixture = fixtureResult.rows[0] || null;
    if (!fixture) {
      throw new AppError(404, "Fixture not found or not accessible");
    }

    await requireOwningLeaderPair(user, fixture.project_id, client);

    resolveNativeDepartmentId(user, fixture.department_id, {
      requireDepartment: true,
      message: "Invalid native fixture delete department context",
    });

    const blockers = await listFixtureDeleteBlockers(normalizedFixtureId, client);
    if (blockers.length > 0) {
      throw new AppError(
        409,
        `Cannot delete fixture ${fixture.fixture_no}: ${blockers.join(", ")} still reference it.`,
        { blockers, fixture_id: normalizedFixtureId, fixture_no: fixture.fixture_no },
        "FIXTURE_DELETE_BLOCKED",
      );
    }

    await queryOptionalDependency(client, `DELETE FROM fixture_workflow WHERE fixture_id = $1`, [normalizedFixtureId]);
    await client.query(`DELETE FROM design.fixtures WHERE id = $1`, [normalizedFixtureId]);

    await createAuditLog({
      userEmployeeId: user.employee_id,
      actionType: "DESIGN_FIXTURE_DELETED",
      targetType: "design_fixture",
      targetId: normalizedFixtureId,
      metadata: {
        project_id: fixture.project_id,
        project_no: fixture.project_no,
        fixture_no: fixture.fixture_no,
        department_id: fixture.department_id,
        source: "native_project_edit_workspace",
      },
    }, client);

    await client.query("COMMIT");

    return {
      deleted: true,
      fixture_id: normalizedFixtureId,
      fixture_no: fixture.fixture_no,
      project_id: fixture.project_id,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
module.exports = {
  NATIVE_INGESTION_SOURCE,
  NATIVE_SUBSYSTEM,
  buildNativeTemplateWorkbook,
  commitNativeSession,
  createNativeIngestionSession,
  createNativeProjectEditSession,
  deleteNativeProjectFixture,
  importNativeExcel,
  pasteNativeClipboardRows,
  saveNativeDraft,
  stageNativeIngestionImage,
  validateNativeSession,
};
