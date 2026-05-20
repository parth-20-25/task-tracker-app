const { AppError } = require("../lib/AppError");
const { requireUserDepartment } = require("../lib/departmentContext");
const { instrumentModuleExports } = require("../lib/observability");
const { logger } = require("../lib/logger");
const { createAuditLog } = require("../repositories/auditRepository");
const { getActiveWorkflowForDepartment } = require("../repositories/fixtureWorkflowRepository");
const {
  buildVisibleUsersCte,
  visibleFixturePredicate,
  visibleProjectPredicate,
} = require("../repositories/projectVisibility");
const { pool } = require("../db");
const {
  upsertProjectByNumber,
  createUploadBatch,
  createUploadErrors,
  createUploadRowCorrections,
  findFixtureByIdForUser,
  updateFixtureReferenceImageForDepartment,
} = require("../repositories/designProjectCatalogRepository");
const {
  createIngestionSession,
  getDraftIngestionSessionForUser,
  getIngestionSessionById,
  finalizeIngestionSessionPreview,
  markIngestionSessionCommitted,
} = require("../repositories/ingestionSessionRepository");

const { parsePasteData, normalize } = require("./designIngestion/parser");
const { validateParsedData } = require("./designIngestion/validator");
const { diffWithDatabase } = require("./designIngestion/differ");
const { formatPreview } = require("./designIngestion/formatter");
const { extractDesignWorkbook } = require("./pythonExtractionClient");
const { uploadExtractedDesignImage } = require("../lib/supabaseStorage");

const CORRECTIONABLE_FIELDS = ["fixture_no", "part_name", "fixture_type", "qty"];
const FIELD_LABEL_TO_KEY = {
  "fixture no": "fixture_no",
  "fixture number": "fixture_no",
  "part name": "part_name",
  "fixture type": "fixture_type",
  qty: "qty",
};

function normalizeRowReferenceSource(value) {
  return value === "business_serial" ? "business_serial" : "excel_row";
}

function normalizeFieldKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function mapFieldLabelToKey(value) {
  return FIELD_LABEL_TO_KEY[normalizeFieldKey(value)] || null;
}

function normalizeRowReference(row = {}) {
  const explicitReference = String(
    row.row_reference
      || row.business_row_reference
      || row.raw_data?.row_reference
      || row.raw_data?.business_row_reference
      || row.row_number
      || row.excel_row
      || "",
  ).trim();

  return explicitReference || "General";
}

function normalizePrimaryRowNumber(row = {}) {
  const primaryRow = Number(row.row_number);
  if (Number.isFinite(primaryRow) && primaryRow > 0) {
    return primaryRow;
  }

  const excelRow = Number(row.excel_row);
  if (Number.isFinite(excelRow) && excelRow > 0) {
    return excelRow;
  }

  return 0;
}

function normalizeExcelRow(row = {}) {
  const excelRow = Number(row.excel_row ?? row.raw_data?.excel_row);
  return Number.isFinite(excelRow) && excelRow > 0 ? excelRow : null;
}

function buildCorrectionDiagnosticsFromExtractionError(error = {}) {
  const rawData = error.raw_data && typeof error.raw_data === "object" ? error.raw_data : {};
  const parsed = rawData.parsed && typeof rawData.parsed === "object" ? rawData.parsed : {};
  const normalizedFields = rawData.normalized_fields && typeof rawData.normalized_fields === "object"
    ? rawData.normalized_fields
    : {};
  const candidateField = typeof rawData.candidate_field === "string" ? rawData.candidate_field : null;
  const parsedMissingFields = CORRECTIONABLE_FIELDS
    .filter((fieldName) => !String(parsed[fieldName] || "").trim())
    .map((fieldName) => {
      switch (fieldName) {
        case "fixture_no":
          return "Fixture No";
        case "part_name":
          return "Part Name";
        case "fixture_type":
          return "Fixture Type";
        case "qty":
          return "QTY";
        default:
          return fieldName;
      }
    });

  const problemFields = [
    ...new Set([
      ...parsedMissingFields.map(mapFieldLabelToKey).filter(Boolean),
      mapFieldLabelToKey(candidateField),
    ].filter(Boolean)),
  ];

  const rowReference = normalizeRowReference({
    row_reference: rawData.row_reference,
    business_row_reference: rawData.business_row_reference,
    row_number: error.row_number,
    excel_row: error.excel_row,
  });

  return {
    sheet_name: rawData.sheet_name || null,
    excel_row: normalizeExcelRow(error),
    row_reference: rowReference,
    row_reference_source: normalizeRowReferenceSource(rawData.row_reference_source),
    business_row_reference: rawData.business_row_reference || null,
    raw: {
      fixture_no: parsed.fixture_no || null,
      part_name: parsed.part_name || null,
      fixture_type: parsed.fixture_type || null,
      qty: parsed.qty || null,
    },
    normalized: {
      fixture_no: normalizedFields.fixture_no || parsed.fixture_no || null,
      part_name: normalizedFields.part_name || parsed.part_name || null,
      fixture_type: normalizedFields.fixture_type || parsed.fixture_type || null,
      qty: normalizedFields.qty || parsed.qty || null,
    },
    inherited: rawData.inherited_hints || {},
    candidate_field: candidateField,
    candidate_values: Array.isArray(rawData.candidate_values) ? rawData.candidate_values : [],
    missing_fields: parsedMissingFields,
    problem_fields: problemFields,
    rejected_field: rawData.rejected_field || rawData.candidate_field || candidateField || parsedMissingFields[0] || null,
    detected_value: rawData.detected_value ?? null,
    expected: rawData.expected || null,
    snapshot_cells: Array.isArray(rawData.cells) ? rawData.cells : [],
  };
}

function mapExtractionErrors(errors = []) {
  return errors.map((error) => {
    const diagnostics = buildCorrectionDiagnosticsFromExtractionError(error);
    return {
      row_number: normalizePrimaryRowNumber(error),
      excel_row: diagnostics.excel_row,
      row_reference: diagnostics.row_reference,
      row_reference_source: diagnostics.row_reference_source,
      business_row_reference: diagnostics.business_row_reference,
      error_message: error.error_message,
      raw_data: {
        ...(error.raw_data || {}),
        validation: diagnostics,
      },
    };
  });
}

function isNonBlockingImageExtractionError(error) {
  const message = String(error?.error_message || "").toLowerCase();
  return message.includes("image");
}

function logImportDecision(event, payload = {}) {
  console.info("[design-import]", {
    event,
    ...payload,
  });
}

function normalizeResolution(value) {
  return value === "existing" ? "existing" : "incoming";
}

function normalizeFixtureIdentity(value) {
  const canon = canonicalFixtureNo(value);
  return canon ? canon.toLowerCase() : "";
}

function buildDecisionErrorMessage(prefix, fixtureData) {
  const fixtureNo = String(fixtureData?.fixture_no || "").trim() || "unknown fixture";
  const rowNumber = Number(fixtureData?.row_number);
  return Number.isFinite(rowNumber) && rowNumber > 0
    ? `${prefix} (${fixtureNo}, row ${rowNumber})`
    : `${prefix} (${fixtureNo})`;
}

function stripExtractedImageUploads(row = {}) {
  const { image_1_upload, image_2_upload, ...rest } = row;
  return rest;
}

function hasExtractedImageUpload(row = {}) {
  return Boolean(row.image_1_upload || row.image_2_upload);
}

async function materializeExtractedWorkbookImages(sessionId, fileInfo, rows = [], stagingPathsOut) {
  let uploadedCount = 0;
  const materializedRows = [];

  for (const row of rows) {
    let nextRow = stripExtractedImageUploads(row);

    if (row.image_1_upload) {
      const uploaded = await uploadExtractedDesignImageStaging({
        image: row.image_1_upload,
        sessionId,
        fileInfo,
        row,
        slotName: "image_1_url",
        stagingPathsOut,
      });
      nextRow = {
        ...nextRow,
        image_1_url: uploaded.publicUrl,
        raw_data: {
          ...(nextRow.raw_data || {}),
          image_storage: {
            ...(nextRow.raw_data?.image_storage || {}),
            image_1_url: {
              bucket: uploaded.bucket,
              path: uploaded.path,
              staging: true,
              anchor: row.image_1_upload.anchor || {},
            },
          },
        },
      };
      uploadedCount += 1;
    }

    if (row.image_2_upload) {
      const uploaded = await uploadExtractedDesignImageStaging({
        image: row.image_2_upload,
        sessionId,
        fileInfo,
        row,
        slotName: "image_2_url",
        stagingPathsOut,
      });
      nextRow = {
        ...nextRow,
        image_2_url: uploaded.publicUrl,
        raw_data: {
          ...(nextRow.raw_data || {}),
          image_storage: {
            ...(nextRow.raw_data?.image_storage || {}),
            image_2_url: {
              bucket: uploaded.bucket,
              path: uploaded.path,
              staging: true,
              anchor: row.image_2_upload.anchor || {},
            },
          },
        },
      };
      uploadedCount += 1;
    }

    materializedRows.push(nextRow);
  }

  return {
    rows: materializedRows,
    uploadedCount,
  };
}

function assertImportableFixtureShape(fixtureData) {
  if (!fixtureData || typeof fixtureData !== "object") {
    throw new AppError(400, "Malformed fixture payload in confirm request");
  }

  const fixtureNo = String(fixtureData.fixture_no || "").trim();
  const partName = String(fixtureData.part_name || "").trim();
  const fixtureType = String(fixtureData.fixture_type || "").trim();
  const qty = Number(fixtureData.qty);

  if (!fixtureNo || !partName || !fixtureType || !Number.isInteger(qty) || qty <= 0) {
    throw new AppError(400, buildDecisionErrorMessage("Fixture confirmation payload failed strict validation", fixtureData));
  }
}

async function resolveExistingFixturesForProject(user, fileInfo) {
  const departmentId = requireUserDepartment(user);
  const project_code_clean = fileInfo.project_code.trim();

  const client = await pool.connect();
  try {
    const projectCheck = await client.query(
      `
        ${buildVisibleUsersCte("$1")}
        SELECT p.id AS project_id
        FROM design.projects p
        WHERE p.project_no = $2
          AND p.department_id = $3
          AND ${visibleProjectPredicate("p")}
      `,
      [user.employee_id, project_code_clean, departmentId],
    );

    if (projectCheck.rows.length === 0) {
      await assertProjectNumberVisibleForImport(user, project_code_clean, departmentId, client);
      return [];
    }

    const projectId = projectCheck.rows[0].project_id;
    const fixtureResult = await client.query(
      `
        ${buildVisibleUsersCte("$1")}
        SELECT
          f.id AS fixture_id,
          f.project_id,
          f.batch_id,
          f.fixture_no,
          f.part_name,
          f.fixture_type,
          f.remark,
          f.qty,
          f.image_1_url,
          f.image_2_url,
          f.ingestion_source,
          f.revision_no,
          f.is_legacy_workflow
        FROM design.fixtures f
        JOIN design.projects p
          ON p.id = f.project_id
        WHERE f.project_id = $2
          AND ${visibleFixturePredicate("f", "p")}
      `,
      [user.employee_id, projectId],
    );

    return fixtureResult.rows.map((row) => ({
      fixture_id: row.fixture_id,
      project_id: row.project_id,
      batch_id: row.batch_id,
      fixture_no: row.fixture_no,
      part_name: row.part_name,
      fixture_type: row.fixture_type,
      remark: row.remark || null,
      qty: Number(row.qty),
      image_1_url: row.image_1_url || null,
      image_2_url: row.image_2_url || null,
      ingestion_source: row.ingestion_source || null,
      revision_no: Number(row.revision_no || 0),
      is_legacy_workflow: row.is_legacy_workflow === true,
    }));
  } finally {
    client.release();
  }
}

async function assertProjectNumberVisibleForImport(user, projectNo, departmentId, client = pool) {
  const result = await client.query(
    `
      ${buildVisibleUsersCte("$1")}
      SELECT p.id
      FROM design.projects p
      WHERE p.project_no = $2
        AND p.department_id = $3
        AND NOT (${visibleProjectPredicate("p")})
      LIMIT 1
    `,
    [user.employee_id, projectNo, departmentId],
  );

  if (result.rows.length > 0) {
    throw new AppError(403, "Project No is outside your reporting-tree visibility and cannot be imported or updated.");
  }
}

async function assertNoHiddenFixtureConflicts(user, projectId, fixtureNumbers, client = pool) {
  const normalizedFixtureNumbers = [...new Set(
    fixtureNumbers
      .map((value) => String(value || "").trim())
      .filter(Boolean),
  )];

  if (normalizedFixtureNumbers.length === 0) {
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
    [user.employee_id, projectId, normalizedFixtureNumbers],
  );

  if (result.rows.length > 0) {
    throw new AppError(403, "One or more Fixture No values are outside your reporting-tree visibility and cannot be updated.");
  }
}

function buildCorrectionRejectedRow(originalRow, correctedRow, errorMessage, extra = {}) {
  const originalRawData = originalRow?.raw_data && typeof originalRow.raw_data === "object"
    ? originalRow.raw_data
    : {};
  const originalValidation = originalRawData.validation && typeof originalRawData.validation === "object"
    ? originalRawData.validation
    : {};

  return {
    row_number: normalizePrimaryRowNumber(correctedRow || originalRow),
    excel_row: normalizeExcelRow(correctedRow || originalRow),
    row_reference: normalizeRowReference(correctedRow || originalRow),
    row_reference_source: normalizeRowReferenceSource(
      correctedRow?.row_reference_source
      || originalRow?.row_reference_source
      || originalValidation.row_reference_source,
    ),
    business_row_reference:
      correctedRow?.business_row_reference
      || originalRow?.business_row_reference
      || originalValidation.business_row_reference
      || null,
    error_message: errorMessage,
    raw_data: {
      ...originalRawData,
      validation: {
        ...originalValidation,
        ...extra,
      },
    },
  };
}

function buildCorrectionAudit(originalRow, correctedRow, classification) {
  const originalValidation = originalRow?.raw_data?.validation || {};
  const originalNormalized = originalValidation.normalized || {};
  const correctedComparable = {
    fixture_no: correctedRow?.fixture_no ?? "",
    part_name: correctedRow?.part_name ?? "",
    fixture_type: correctedRow?.fixture_type ?? "",
    qty: correctedRow?.qty ?? "",
  };

  const corrected_fields = CORRECTIONABLE_FIELDS.filter((fieldName) => (
    String(originalNormalized[fieldName] ?? "").trim() !== String(correctedComparable[fieldName] ?? "").trim()
  ));

  return {
    row_reference: normalizeRowReference(correctedRow || originalRow),
    row_number: normalizePrimaryRowNumber(correctedRow || originalRow),
    excel_row: normalizeExcelRow(correctedRow || originalRow),
    correction_reason: originalRow?.error_message || "Rejected row corrected inline before import.",
    corrected_fields,
    original_row: originalRow,
    corrected_row: correctedRow,
    correction_result: classification,
  };
}

async function promoteFixtureStagingImages(fixtureData, fileInfo, productionPathsAccumulator) {
  let next = { ...fixtureData };
  for (const slotName of ["image_1_url", "image_2_url"]) {
    const meta = next.raw_data?.image_storage?.[slotName];
    if (!meta?.staging || !meta.bucket || !meta.path) {
      continue;
    }

    const promoted = await promoteStagedExtractedDesignImage({
      sourceBucket: meta.bucket,
      sourcePath: meta.path,
      fileInfo,
      row: next,
      slotName,
    });

    productionPathsAccumulator.push({ bucket: promoted.bucket, path: promoted.path });
    next = {
      ...next,
      [slotName]: promoted.publicUrl,
      raw_data: {
        ...(next.raw_data || {}),
        image_storage: {
          ...(next.raw_data?.image_storage || {}),
          [slotName]: {
            bucket: promoted.bucket,
            path: promoted.path,
            staging: false,
            anchor: meta.anchor || {},
          },
        },
      },
    };
  }

  return next;
}

function shapeSessionFileInfoCompare(fileInfo = {}) {
  return {
    project_code: String(fileInfo.project_code || "").trim(),
    project_name_display: String(fileInfo.project_name_display || fileInfo.project_name || "").trim(),
    company_name: String(fileInfo.company_name || "").trim(),
    metadata_source: String(fileInfo.metadata_source || "").trim(),
  };
}

function assertSessionMatchesConfirmFileInfo(sessionRow, file_info) {
  const expected = shapeSessionFileInfoCompare(sessionRow.file_info || {});
  const actual = shapeSessionFileInfoCompare(file_info || {});

  if (
    expected.project_code !== actual.project_code
    || expected.project_name_display !== actual.project_name_display
    || expected.company_name !== actual.company_name
    || expected.metadata_source !== actual.metadata_source
  ) {
    throw new AppError(400, "Confirm payload file_info does not match ingestion session");
  }
}

function assertCommitResolutionsMatchFreshPreview(resolvedItems, freshPreview) {
  const expectedCount = freshPreview.accepted.length + freshPreview.conflicts.length;
  if (resolvedItems.length !== expectedCount) {
    throw new AppError(
      409,
      "Import review is out of date. Re-run preview before committing.",
      { expected_decisions: expectedCount, received: resolvedItems.length },
    );
  }

  const conflictKeys = new Set(
    freshPreview.conflicts.map((c) => canonicalFixtureNo(c.incoming.fixture_no).toLowerCase()),
  );
  const autoKeys = new Set(
    freshPreview.accepted.map((a) => canonicalFixtureNo(a.incoming.fixture_no).toLowerCase()),
  );

  for (const item of resolvedItems) {
    const key = canonicalFixtureNo(item.data.fixture_no).toLowerCase();
    const resolution = normalizeResolution(item.resolution);

    if (resolution === "existing") {
      if (!conflictKeys.has(key)) {
        throw new AppError(400, `Cannot keep existing production data for non-conflict row (${key}).`, {
          fixture_no: key,
        });
      }
      continue;
    }

    if (!autoKeys.has(key) && !conflictKeys.has(key)) {
      throw new AppError(400, `Fixture ${key} is not part of the current preview import set.`, {
        fixture_no: key,
      });
    }
  }
}

async function completeDesignIngestionPreview(user, {
  sessionId,
  fileInfo,
  validRows,
  rejectedRows,
  skippedRows,
  metadataSource,
  stagingPaths,
  catalogMembershipMode,
}) {
  const project_code_clean = String(fileInfo.project_code || "").trim();
  const project_name_display = String(
    fileInfo.project_name_display || fileInfo.project_name || "",
  ).trim();
  const company_name_clean = String(fileInfo.company_name || "").trim();

  const existingFixtures = await resolveExistingFixturesForProject(user, {
    project_code: project_code_clean,
    project_name_display,
    company_name: company_name_clean,
  });

  const diffResults = diffWithDatabase(validRows, existingFixtures);
  const preview = formatPreview(diffResults, rejectedRows, skippedRows);

  await finalizeIngestionSessionPreview(sessionId, {
    snapshot: {
      version: 1,
      metadata_source: metadataSource,
      staging_object_paths: stagingPaths || [],
      catalog_membership_mode:
        catalogMembershipMode === CATALOG_MEMBERSHIP_MODES.FULL_REPLACE
          ? CATALOG_MEMBERSHIP_MODES.FULL_REPLACE
          : CATALOG_MEMBERSHIP_MODES.DELTA,
    },
    file_info: {
      project_code: project_code_clean,
      project_name_display,
      company_name: company_name_clean,
      metadata_source: metadataSource,
    },
  }, pool);

  const sessionMeta = await getIngestionSessionById(sessionId, pool);

  return {
    file_info: {
      project_code: project_code_clean,
      project_name_display,
      company_name: company_name_clean,
      metadata_source: metadataSource,
    },
    preview,
    ingestion_session_id: sessionId,
    ingestion_session_expires_at: sessionMeta?.expires_at || null,
  };
}

async function parseAndPreviewUpload(user, payload = {}) {
  const { text, catalog_membership_mode: catalogMembershipMode } = payload;

  logImportDecision("paste_upload_start", {
    user_id: user.id,
    employee_id: user.employee_id,
    has_text: Boolean(text),
    text_length: text ? String(text).length : 0,
  });

  if (!text) {
    logImportDecision("paste_upload_validation_failed", {
      error: "Missing required fields: text",
      user_id: user.id,
    });
    throw new AppError(400, "Missing required fields: text");
  }

  try {
    const { file_info, parsedRows } = parsePasteData(text);
    const { validRows, rejectedRows, skippedRows } = validateParsedData(parsedRows);

    logImportDecision("paste_upload_parse_success", {
      project_code: file_info.project_code,
      project_name: file_info.project_name,
      company_name: file_info.company_name,
      total_rows: parsedRows.length,
      valid_rows: validRows.length,
      rejected_rows: rejectedRows.length,
      skipped_rows: skippedRows.length,
    });

    const departmentId = requireUserDepartment(user);
    const sessionRow = await createIngestionSession({
      department_id: departmentId,
      created_by_employee_id: user.employee_id,
      file_info: {
        project_code: file_info.project_code.trim(),
        project_name_display: file_info.project_name || "",
        company_name: file_info.company_name.trim(),
        metadata_source: "manual_paste",
      },
      snapshot: {},
    }, pool);

    return completeDesignIngestionPreview(user, {
      sessionId: sessionRow.id,
      fileInfo: file_info,
      validRows,
      rejectedRows,
      skippedRows,
      metadataSource: "manual_paste",
      stagingPaths: [],
      catalogMembershipMode,
    });
  } catch (err) {
    logImportDecision("paste_upload_parse_error", {
      error_message: err instanceof Error ? err.message : String(err),
      user_id: user.id,
    });
    throw err;
  }
}

async function parseAndPreviewUploadedWorkbook(user, file, options = {}) {
  if (!file) {
    logImportDecision("excel_upload_validation_failed", {
      error: "No Excel file uploaded",
      user_id: user.id,
    });
    throw new AppError(400, "No Excel file uploaded");
  }

  logImportDecision("excel_upload_start", {
    user_id: user.id,
    employee_id: user.employee_id,
    file_name: file.originalname,
    file_size_bytes: file.size,
    mime_type: file.mimetype,
  });

  try {
    const extractionResult = await extractDesignWorkbook(file);
    const departmentId = requireUserDepartment(user);
    const fi = extractionResult.file_info;
    const initialFi = {
      project_code: String(fi.project_code || "").trim(),
      project_name_display: String(fi.project_name_display || fi.project_name || "").trim(),
      company_name: String(fi.company_name || "").trim(),
      metadata_source: "python_excel_upload",
    };

    const sessionRow = await createIngestionSession({
      department_id: departmentId,
      created_by_employee_id: user.employee_id,
      file_info: initialFi,
      snapshot: {},
    }, pool);

    const stagingPaths = [];
    const materializedImages = await materializeExtractedWorkbookImages(
      sessionRow.id,
      extractionResult.file_info,
      extractionResult.rows,
      stagingPaths,
    );
    const {
      validRows,
      rejectedRows: validationErrors,
      skippedRows,
    } = validateParsedData(materializedImages.rows);
    const acceptedRowNumbers = new Set(validRows.map((row) => Number(row.excel_row ?? row.row_number)));
    const extractionErrors = mapExtractionErrors(extractionResult.errors).filter((error) => {
      if (!isNonBlockingImageExtractionError(error)) {
        return true;
      }

      return !acceptedRowNumbers.has(Number(error.excel_row ?? error.row_number));
    });
    const rejectedRows = [...extractionErrors, ...validationErrors];

    logImportDecision("excel_upload_parse_success", {
      project_code: extractionResult.file_info.project_code,
      project_name: extractionResult.file_info.project_name,
      company_name: extractionResult.file_info.company_name,
      total_rows: extractionResult.rows.length,
      valid_rows: validRows.length,
      rejected_rows: rejectedRows.length,
      skipped_rows: skippedRows.length,
      extraction_errors_count: extractionResult.errors.length,
      extracted_image_rows: extractionResult.rows.filter(hasExtractedImageUpload).length,
      supabase_images_uploaded: materializedImages.uploadedCount,
    });

    return completeDesignIngestionPreview(user, {
      sessionId: sessionRow.id,
      fileInfo: extractionResult.file_info,
      validRows,
      rejectedRows,
      skippedRows,
      metadataSource: "python_excel_upload",
    });
  } catch (err) {
    logImportDecision("excel_upload_parse_error", {
      error_message: err instanceof Error ? err.message : String(err),
      file_name: file.originalname,
      user_id: user.id,
    });
    throw err;
  }
}

async function validateRejectedUploadRow(user, payload = {}) {
  const { file_info, original_row, corrected_row, reserved_fixture_numbers } = payload;

  if (!file_info || !file_info.project_code || !file_info.project_name_display || !file_info.company_name) {
    throw new AppError(400, "Missing file info for row correction");
  }

  if (!original_row || typeof original_row !== "object") {
    throw new AppError(400, "Missing original rejected row for correction");
  }

  if (!corrected_row || typeof corrected_row !== "object") {
    throw new AppError(400, "Missing corrected row payload");
  }

  const candidateRow = {
    row_number: normalizePrimaryRowNumber({
      ...original_row,
      ...corrected_row,
    }),
    excel_row: normalizeExcelRow({
      ...original_row,
      ...corrected_row,
    }),
    row_reference: normalizeRowReference({
      ...original_row,
      ...corrected_row,
    }),
    row_reference_source: normalizeRowReferenceSource(
      corrected_row.row_reference_source
      || original_row.row_reference_source
      || original_row.raw_data?.validation?.row_reference_source,
    ),
    business_row_reference:
      corrected_row.business_row_reference
      || original_row.business_row_reference
      || original_row.raw_data?.validation?.business_row_reference
      || null,
    fixture_no: corrected_row.fixture_no,
    part_name: corrected_row.part_name,
    fixture_type: corrected_row.fixture_type,
    remark: null,
    qty: corrected_row.qty,
    image_1_url: corrected_row.image_1_url ?? original_row.image_1_url ?? original_row.raw_data?.image_1_url ?? null,
    image_2_url: corrected_row.image_2_url ?? original_row.image_2_url ?? original_row.raw_data?.image_2_url ?? null,
    parser_confidence: "HIGH",
    raw_data: {
      ...(original_row.raw_data && typeof original_row.raw_data === "object" ? original_row.raw_data : {}),
      validation: original_row.raw_data?.validation || {},
    },
  };

  const { validRows, rejectedRows, skippedRows } = validateParsedData([candidateRow]);
  if (rejectedRows.length > 0) {
    return {
      classification: "rejected",
      rejected: rejectedRows[0],
      correction_audit: buildCorrectionAudit(original_row, candidateRow, "rejected"),
    };
  }

  if (skippedRows.length > 0) {
    return {
      classification: "skipped",
      skipped: skippedRows[0],
      correction_audit: buildCorrectionAudit(original_row, skippedRows[0], "skipped"),
    };
  }

  const validatedRow = validRows[0];
  const originalFixtureIdentity = normalizeFixtureIdentity(
    original_row?.raw_data?.validation?.normalized?.fixture_no
      || original_row?.fixture_no
      || original_row?.raw_data?.fixture_no,
  );
  const reservedFixtureNumbers = new Set(
    (Array.isArray(reserved_fixture_numbers) ? reserved_fixture_numbers : [])
      .map(normalizeFixtureIdentity)
      .filter(Boolean),
  );
  const candidateFixtureIdentity = normalizeFixtureIdentity(validatedRow.fixture_no);

  if (
    candidateFixtureIdentity
    && reservedFixtureNumbers.has(candidateFixtureIdentity)
    && candidateFixtureIdentity !== originalFixtureIdentity
  ) {
    const rejected = buildCorrectionRejectedRow(
      original_row,
      validatedRow,
      "Fixture No duplicates another row already staged in this upload.",
      {
        reason: "duplicate_fixture_no",
        missing_fields: [],
        problem_fields: ["fixture_no"],
      },
    );

    return {
      classification: "rejected",
      rejected,
      correction_audit: buildCorrectionAudit(original_row, validatedRow, "rejected"),
    };
  }

  const existingFixtures = await resolveExistingFixturesForProject(user, {
    project_code: file_info.project_code,
    project_name: file_info.project_name_display,
    company_name: file_info.company_name,
  });
  const diffResults = diffWithDatabase([validatedRow], existingFixtures);
  const diffResult = diffResults[0];

  if (!diffResult) {
    const rejected = buildCorrectionRejectedRow(
      original_row,
      validatedRow,
      "Unable to classify this row against production data.",
      {
        reason: "classification_failed",
        missing_fields: [],
      },
    );

    return {
      classification: "rejected",
      rejected,
      correction_audit: buildCorrectionAudit(original_row, validatedRow, "rejected"),
    };
  }

  if (diffResult.type === "UNCHANGED") {
    const rejected = buildCorrectionRejectedRow(
      original_row,
      validatedRow,
      "This corrected row already matches an existing fixture and does not require import.",
      {
        reason: "already_exists",
        missing_fields: [],
      },
    );

    return {
      classification: "rejected",
      rejected,
      correction_audit: buildCorrectionAudit(original_row, validatedRow, "rejected"),
    };
  }

  const correctionAudit = buildCorrectionAudit(
    original_row,
    diffResult.incoming,
    diffResult.type === "NEW" || diffResult.type === "UPDATE_QTY" ? "accepted" : "conflict",
  );

  if (diffResult.type === "NEW" || diffResult.type === "UPDATE_QTY") {
    return {
      classification: "accepted",
      accepted: diffResult,
      correction_audit: correctionAudit,
    };
  }

  return {
    classification: "conflict",
    conflict: diffResult,
    correction_audit: correctionAudit,
  };
}

async function confirmUpload(user, payload = {}) {
  const {
    file_info,
    resolved_items,
    rejected_items,
    skipped_items,
    correction_items,
    ingestion_session_id,
  } = payload;

  const departmentId = requireUserDepartment(user);

  if (!ingestion_session_id) {
    throw new AppError(400, "ingestion_session_id is required for transactional import");
  }

  const sessionRow = await getDraftIngestionSessionForUser(
    ingestion_session_id,
    departmentId,
    user.employee_id,
    pool,
  );

  if (!sessionRow) {
    throw new AppError(400, "Invalid, expired, or already committed ingestion session");
  }

  if (!file_info || !file_info.project_code || !file_info.project_name_display || !file_info.company_name) {
    throw new AppError(400, "Missing file info in confirm payload");
  }

  assertSessionMatchesConfirmFileInfo(sessionRow, file_info);

  const ingestionSource = file_info.metadata_source === "manual_paste" ? "manual_paste" : "excel_upload";

  const resolvedItems = Array.isArray(resolved_items) ? resolved_items : [];
  const rejectedItems = Array.isArray(rejected_items) ? rejected_items : [];
  const skippedItems = Array.isArray(skipped_items) ? skipped_items : [];
  const correctionItems = Array.isArray(correction_items) ? correction_items : [];

  const incomingRows = resolvedItems
    .filter((item) => normalizeResolution(item.resolution) !== "existing")
    .map((item) => item.data);

  const { validRows: bulkValid, rejectedRows: bulkRejected } = validateParsedData(incomingRows);

  if (bulkRejected.length > 0) {
    throw new AppError(
      400,
      "One or more import rows failed validation. Fix grid errors before committing.",
      { rejected_rows: bulkRejected },
    );
  }

  const existingFixtures = await resolveExistingFixturesForProject(user, file_info);
  const freshDiff = diffWithDatabase(bulkValid, existingFixtures);
  const freshPreview = formatPreview(freshDiff, [], []);

  assertCommitResolutionsMatchFreshPreview(resolvedItems, freshPreview);

  const incomingKeyOrder = [];
  const incomingKeySeen = new Set();
  for (const item of resolvedItems) {
    if (normalizeResolution(item.resolution) === "existing") {
      continue;
    }
    const fiKey = canonicalFixtureNo(item.data.fixture_no).toLowerCase();
    if (incomingKeySeen.has(fiKey)) {
      throw new AppError(400, buildDecisionErrorMessage("Duplicate fixture identity detected in confirm payload", item.data));
    }
    incomingKeySeen.add(fiKey);
    incomingKeyOrder.push(fiKey);
  }

  const incomingKeySet = new Set(incomingKeyOrder);
  const actionableSourceRows = bulkValid.filter((row) => (
    incomingKeySet.has(canonicalFixtureNo(row.fixture_no).toLowerCase())
  ));

  const uploadDecisionLogs = [];
  for (const item of resolvedItems) {
    if (!item || typeof item !== "object" || !item.data) {
      throw new AppError(400, "Malformed resolved_items payload");
    }

    const fixtureData = item.data;
    const resolution = normalizeResolution(item.resolution);

    if (resolution === "existing") {
      uploadDecisionLogs.push({
        row_number: Number.isFinite(Number(fixtureData.row_number)) ? Number(fixtureData.row_number) : 0,
        excel_row: Number.isFinite(Number(fixtureData.excel_row)) ? Number(fixtureData.excel_row) : null,
        row_reference: normalizeRowReference(fixtureData),
        fixture_no: fixtureData.fixture_no || null,
        error_message: buildDecisionErrorMessage("Existing fixture retained after conflict review", fixtureData),
      });
      logImportDecision("kept_existing_fixture", {
        project_code: file_info.project_code,
        project_name: file_info.project_name_display,
        fixture_no: fixtureData.fixture_no,
        row_number: fixtureData.row_number,
      });
    }
  }

  const actionableItems = [];
  for (const fixtureData of actionableSourceRows) {
    assertImportableFixtureShape(fixtureData);
    actionableItems.push(fixtureData);
  }

  if (actionableItems.length === 0) {
    throw new AppError(400, "No fixtures were approved for import");
  }

  const productionPathsForCleanup = [];
  let promotedActionableItems = [];
  try {
    for (const fixtureData of actionableItems) {
      promotedActionableItems.push(await promoteFixtureStagingImages(fixtureData, file_info, productionPathsForCleanup));
    }
  } catch (promoteErr) {
    await deleteStorageObjects(productionPathsForCleanup).catch(() => {});
    logger.error("Design ingestion image promotion failed", {
      errorMessage: promoteErr?.message || String(promoteErr),
    });
    throw promoteErr;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const workflow = await getActiveWorkflowForDepartment(departmentId, client);
    if (!workflow || !Array.isArray(workflow.stages) || workflow.stages.length === 0) {
      throw new AppError(409, `No workflow configured for department ${departmentId}`);
    }

    await assertProjectNumberVisibleForImport(user, file_info.project_code, departmentId, client);

    const project = await upsertProjectByNumber({
      project_no: file_info.project_code,
      project_name: file_info.project_name_display,
      customer_name: file_info.company_name,
      department_id: departmentId,
      uploaded_by: user.employee_id,
    }, client);

    // Project update logic if company name missing from existing project
    if (!project.company_name && project.project_id) {
      await client.query(
        `
          UPDATE design.projects
          SET customer_name = $1
          WHERE id = $2
            AND (customer_name IS NULL OR customer_name = '')
        `,
        [file_info.company_name, project.project_id],
      );
    }

    let acceptedCount = 0;
      const strictRejectedItems = [
        ...rejectedItems,
        ...skippedItems.map((item) => ({
          row_number: item.row_number,
          excel_row: item.excel_row ?? null,
          row_reference: item.row_reference || normalizeRowReference(item),
          fixture_no: item.fixture_no || null,
          raw_data: item.raw_data || {},
          error_message: item.skip_reason || "Fixture skipped.",
        })),
        ...uploadDecisionLogs,
      ];

    if (!project?.project_id) {
      throw new AppError(500, "Project resolution failed during controlled import");
    }

    await assertNoHiddenFixtureConflicts(
      user,
      project.project_id,
      promotedActionableItems.map((fixtureData) => canonicalFixtureNo(fixtureData.fixture_no)),
      client,
    );

    const batchId = await createUploadBatch({
      project_id: project.project_id,
      uploaded_by: user.employee_id,
      uploaded_by_user_id: user.employee_id,
      total_rows: promotedActionableItems.length + strictRejectedItems.length,
      accepted_rows: promotedActionableItems.length,
      rejected_rows: strictRejectedItems.length,
    }, client);

    const sessionSnapshot = typeof sessionRow.snapshot === "string"
      ? JSON.parse(sessionRow.snapshot)
      : (sessionRow.snapshot || {});
    const catalogModeRaw = sessionSnapshot.catalog_membership_mode;
    const catalogMembershipMode = catalogModeRaw === CATALOG_MEMBERSHIP_MODES.FULL_REPLACE
      ? CATALOG_MEMBERSHIP_MODES.FULL_REPLACE
      : CATALOG_MEMBERSHIP_MODES.DELTA;

    const syncAudit = await synchronizeDesignWorkflowTruthFromIngestion(client, {
      projectId: project.project_id,
      batchId,
      departmentId,
      employeeId: user.employee_id,
      ingestionSource,
      promotedFixtureRows: promotedActionableItems,
      workflowStages: workflow.stages,
      catalogMembershipMode,
    });

    acceptedCount = syncAudit.created_fixture_nos.length + syncAudit.updated_fixture_nos.length;

    for (let idx = 0; idx < syncAudit.created_fixture_nos.length; idx++) {
      const fixtureNo = syncAudit.created_fixture_nos[idx];
      const fixtureId = syncAudit.created_fixture_ids[idx];
      logImportDecision("imported_fixture", {
        batch_id: batchId,
        project_id: project.project_id,
        fixture_id: fixtureId,
        fixture_no: fixtureNo,
        ingestion_source: ingestionSource,
        sync: "created",
      });

      await createAuditLog({
        userEmployeeId: user.employee_id,
        actionType: "DESIGN_FIXTURE_IMPORTED",
        targetType: "design_fixture",
        targetId: fixtureId || fixtureNo || "unknown",
        metadata: {
          batch_id: batchId,
          fixture_id: fixtureId,
          project_id: project.project_id,
          project_code: file_info.project_code,
          ingestion_source: ingestionSource,
          workflow_sync: "created",
        },
      }, client);
    }

    for (const fixtureNo of syncAudit.updated_fixture_nos) {
      logImportDecision("imported_fixture", {
        batch_id: batchId,
        project_id: project.project_id,
        fixture_no: fixtureNo,
        ingestion_source: ingestionSource,
        sync: "metadata_merge",
      });
    }

    await createAuditLog({
      userEmployeeId: user.employee_id,
      actionType: "DESIGN_WORKFLOW_INGESTION_SYNC",
      targetType: "design_upload_batch",
      targetId: batchId,
      metadata: {
        batch_id: batchId,
        project_id: project.project_id,
        project_code: file_info.project_code,
        catalog_membership_mode: catalogMembershipMode,
        created_fixture_ids: syncAudit.created_fixture_ids,
        created_fixture_nos: syncAudit.created_fixture_nos,
        updated_fixture_nos: syncAudit.updated_fixture_nos,
        archived_fixture_nos: syncAudit.archived_fixture_nos,
        revived_fixture_count: syncAudit.revived_fixture_count,
        outsourcing_rows_touched: syncAudit.outsourcing_rows_touched,
      },
    }, client);

    if (strictRejectedItems.length > 0) {
      const errorsPayload = strictRejectedItems.map((r) => ({
        row_number: Number.isFinite(Number(r.row_number)) ? Number(r.row_number) : 0,
        excel_row: Number.isFinite(Number(r.excel_row)) ? Number(r.excel_row) : null,
        row_reference: normalizeRowReference(r),
        error_message: r.error_message,
        raw_data: r.raw_data || null,
      }));

      // Audit: every rejected/skipped row (including conflict decisions + skipped ambiguouss)
      for (const r of strictRejectedItems) {
        await createAuditLog({
          userEmployeeId: user.employee_id,
          actionType: "DESIGN_FIXTURE_SKIPPED_OR_REJECTED",
          targetType: "design_fixture",
          targetId: r.fixture_no || "unknown",
          metadata: {
            batch_id: batchId,
            project_code: file_info.project_code,
          project_name: file_info.project_name_display,
            row_number: r.row_number,
            row_reference: normalizeRowReference(r),
            excel_row: Number.isFinite(Number(r.excel_row)) ? Number(r.excel_row) : null,
            error_message: r.error_message,
            ingestion_source: ingestionSource,
          },
        }, client);
      }

      await createUploadErrors(batchId, errorsPayload, client);
    }

    if (correctionItems.length > 0) {
      const persistedCorrections = correctionItems
        .filter((item) => item && typeof item === "object")
        .map((item) => ({
          row_reference: normalizeRowReference(item.corrected_row || item.original_row || item),
          row_number: normalizePrimaryRowNumber(item.corrected_row || item.original_row || item),
          excel_row: normalizeExcelRow(item.corrected_row || item.original_row || item),
          correction_reason: item.correction_reason || item.original_row?.error_message || "Rejected row corrected inline before import.",
          correction_result: item.correction_result || "accepted",
          original_data: item.original_row || {},
          corrected_data: item.corrected_row || {},
          corrected_by: user.employee_id,
        }));

      await createUploadRowCorrections(batchId, persistedCorrections, client);

      for (const correction of persistedCorrections) {
        await createAuditLog({
          userEmployeeId: user.employee_id,
          actionType: "DESIGN_REJECTED_ROW_CORRECTED",
          targetType: "design_fixture",
          targetId: correction.corrected_data?.fixture_no || correction.row_reference || "unknown",
          metadata: {
            batch_id: batchId,
            project_code: file_info.project_code,
            project_name: file_info.project_name_display,
            row_reference: correction.row_reference,
            row_number: correction.row_number,
            excel_row: correction.excel_row,
            correction_reason: correction.correction_reason,
            correction_result: correction.correction_result,
            original_data: correction.original_data,
            corrected_data: correction.corrected_data,
            ingestion_source: ingestionSource,
          },
        }, client);
      }
    }

    await client.query("COMMIT");
    await markIngestionSessionCommitted(ingestion_session_id, batchId, pool);
    return { success: true, batch_id: batchId, accepted_count: acceptedCount };
  } catch (err) {
    await client.query("ROLLBACK");
    await deleteStorageObjects(productionPathsForCleanup).catch(() => {});
    logger.error("Design upload confirmation failed", {
      operation: "confirmUpload",
      department_id: departmentId,
      user_employee_id: user?.employee_id || null,
      project_code: file_info?.project_code || null,
      project_name: file_info?.project_name_display || null,
      accepted_item_count: promotedActionableItems.length,
      rejected_item_count: rejectedItems.length,
      skipped_item_count: skippedItems.length,
      errorMessage: err?.message || "Unknown upload confirmation error",
      errorCode: err?.code || null,
      constraint: err?.constraint || null,
      detail: err?.detail || null,
      stack: err?.stack || null,
    });
    if (err instanceof AppError) {
      throw err;
    }

    throw new AppError(
      500,
      "Upload confirmation failed while saving fixture data. The operation was rolled back.",
      {
        code: err?.code || null,
        constraint: err?.constraint || null,
        detail: err?.detail || null,
      },
    );
  } finally {
    client.release();
  }
}

async function uploadFixtureReferenceImage(
  user,
  fixtureId,
  departmentId,
  imageType,
  imageUrl,
) {
  const fixture = await findFixtureByIdForUser(fixtureId, user, departmentId);
  if (!fixture) {
    throw new AppError(404, "Fixture not found");
  }

  const result = await updateFixtureReferenceImageForDepartment({
    fixtureId,
    departmentId,
    imageType,
    imageUrl,
  });

  logImportDecision("fixture_reference_image_uploaded", {
    fixture_id: fixtureId,
    fixture_no: result.fixture_no,
    image_type: imageType,
    image_url: imageUrl,
    previous_image_url: result.previous_image_url,
    user_id: user.id,
    employee_id: user.employee_id,
  });

  return result;
}

module.exports = instrumentModuleExports("service.designExcelService", {
  parseAndPreviewUpload,
  parseAndPreviewUploadedWorkbook,
  confirmUpload,
  uploadFixtureReferenceImage,
  validateRejectedUploadRow,
});
