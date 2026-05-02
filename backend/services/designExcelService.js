const { AppError } = require("../lib/AppError");
const { requireUserDepartment } = require("../lib/departmentContext");
const { instrumentModuleExports } = require("../lib/observability");
const { logger } = require("../lib/logger");
const { createAuditLog } = require("../repositories/auditRepository");
const { getActiveWorkflowForDepartment, initProgressForFixture } = require("../repositories/fixtureWorkflowRepository");
const { pool } = require("../db");
const {
  upsertProjectByNumber,
  findOrCreateScope,
  findFixturesByScopeForDedupe,
  createUploadBatch,
  createUploadErrors,
  createUploadRowCorrections,
  upsertFixture
} = require("../repositories/designProjectCatalogRepository");

const { parsePasteData, normalize } = require("./designIngestion/parser");
const { SCOPE_STATUSES, classifyScopeOwnership } = require("./designIngestion/scope");
const { validateParsedData } = require("./designIngestion/validator");
const { diffWithDatabase } = require("./designIngestion/differ");
const { formatPreview } = require("./designIngestion/formatter");
const { extractDesignWorkbook } = require("./pythonExtractionClient");

const CORRECTIONABLE_FIELDS = ["fixture_no", "op_no", "part_name", "fixture_type", "qty", "remark"];
const FIELD_LABEL_TO_KEY = {
  "fixture no": "fixture_no",
  "fixture number": "fixture_no",
  "op.no": "op_no",
  "op no": "op_no",
  "part name": "part_name",
  "fixture type": "fixture_type",
  qty: "qty",
  remark: "remark",
  remarks: "remark",
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
    .filter((fieldName) => fieldName !== "remark" && !String(parsed[fieldName] || "").trim())
    .map((fieldName) => {
      switch (fieldName) {
        case "fixture_no":
          return "Fixture No";
        case "op_no":
          return "OP.NO";
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
      op_no: parsed.op_no || null,
      part_name: parsed.part_name || null,
      fixture_type: parsed.fixture_type || null,
      qty: parsed.qty || null,
      remark: parsed.remark || null,
    },
    normalized: {
      fixture_no: normalizedFields.fixture_no || parsed.fixture_no || null,
      op_no: normalizedFields.op_no || parsed.op_no || null,
      part_name: normalizedFields.part_name || parsed.part_name || null,
      fixture_type: normalizedFields.fixture_type || parsed.fixture_type || null,
      qty: normalizedFields.qty || parsed.qty || null,
      remark: parsed.remark || null,
    },
    inherited: rawData.inherited_hints || {},
    candidate_field: candidateField,
    candidate_values: Array.isArray(rawData.candidate_values) ? rawData.candidate_values : [],
    missing_fields: parsedMissingFields,
    problem_fields: problemFields,
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

function normalizeScopeDecision(value) {
  return value === "add_fixture" || value === "skip_fixture" ? value : null;
}

function normalizeResolution(value) {
  return value === "existing" ? "existing" : "incoming";
}

function normalizeFixtureIdentity(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .toLowerCase();
}

function buildDecisionErrorMessage(prefix, fixtureData) {
  const fixtureNo = String(fixtureData?.fixture_no || "").trim() || "unknown fixture";
  const rowNumber = Number(fixtureData?.row_number);
  return Number.isFinite(rowNumber) && rowNumber > 0
    ? `${prefix} (${fixtureNo}, row ${rowNumber})`
    : `${prefix} (${fixtureNo})`;
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

async function resolveExistingFixturesForScope(user, fileInfo) {
  const departmentId = requireUserDepartment(user);
  const project_code_clean = fileInfo.project_code.trim();
  const scope_name_display = fileInfo.scope_name.trim();
  const scope_name_normalized = normalize(scope_name_display);

  const client = await pool.connect();
  try {
    const projectCheck = await client.query(
      `
        SELECT id AS project_id
        FROM design.projects
        WHERE project_no = $1
          AND department_id = $2
      `,
      [project_code_clean, departmentId],
    );

    if (projectCheck.rows.length === 0) {
      return [];
    }

    const projectId = projectCheck.rows[0].project_id;
    const scopeCheck = await client.query(
      `
        SELECT id AS scope_id, scope_name
        FROM design.scopes
        WHERE project_id = $1
      `,
      [projectId],
    );

    for (const scope of scopeCheck.rows) {
      if (normalize(scope.scope_name) === scope_name_normalized) {
        return findFixturesByScopeForDedupe(scope.scope_id, client);
      }
    }

    return [];
  } finally {
    client.release();
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
    op_no: correctedRow?.op_no ?? "",
    part_name: correctedRow?.part_name ?? "",
    fixture_type: correctedRow?.fixture_type ?? "",
    qty: correctedRow?.qty ?? "",
    remark: correctedRow?.remark ?? "",
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

async function buildPreviewPayload(user, {
  fileInfo,
  validRows,
  rejectedRows,
  skippedRows,
  metadataSource,
}) {
  const project_code_clean = fileInfo.project_code.trim();
  const scope_name_display = fileInfo.scope_name.trim();
  const company_name_clean = fileInfo.company_name.trim();
  const existingFixtures = await resolveExistingFixturesForScope(user, fileInfo);

  const diffResults = diffWithDatabase(validRows, existingFixtures);
  const preview = formatPreview(diffResults, rejectedRows, skippedRows);

  return {
    file_info: {
      project_code: project_code_clean,
      scope_name_display,
      company_name: company_name_clean,
      metadata_source: metadataSource,
    },
    preview,
  };
}

async function parseAndPreviewUpload(user, payload = {}) {
  const { text } = payload;

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
      scope_name: file_info.scope_name,
      company_name: file_info.company_name,
      total_rows: parsedRows.length,
      valid_rows: validRows.length,
      rejected_rows: rejectedRows.length,
      skipped_rows: skippedRows.length,
    });

    return buildPreviewPayload(user, {
      fileInfo: {
        project_code: file_info.project_code,
        scope_name: file_info.scope_name,
        company_name: file_info.company_name,
      },
      validRows,
      rejectedRows,
      skippedRows,
      metadataSource: "manual_paste",
    });
  } catch (err) {
    logImportDecision("paste_upload_parse_error", {
      error_message: err instanceof Error ? err.message : String(err),
      user_id: user.id,
    });
    throw err;
  }
}

async function parseAndPreviewUploadedWorkbook(user, file) {
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
    const {
      validRows,
      rejectedRows: validationErrors,
      skippedRows,
    } = validateParsedData(extractionResult.rows);
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
      scope_name: extractionResult.file_info.scope_name,
      company_name: extractionResult.file_info.company_name,
      total_rows: extractionResult.rows.length,
      valid_rows: validRows.length,
      rejected_rows: rejectedRows.length,
      skipped_rows: skippedRows.length,
      extraction_errors_count: extractionResult.errors.length,
    });

    return buildPreviewPayload(user, {
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

  if (!file_info || !file_info.project_code || !file_info.scope_name_display || !file_info.company_name) {
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
    op_no: corrected_row.op_no,
    part_name: corrected_row.part_name,
    fixture_type: corrected_row.fixture_type,
    remark: corrected_row.remark,
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

  const existingFixtures = await resolveExistingFixturesForScope(user, {
    project_code: file_info.project_code,
    scope_name: file_info.scope_name_display,
    company_name: file_info.company_name,
  });
  const diffResults = diffWithDatabase([validatedRow], existingFixtures);

  if (diffResults.length === 0) {
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

  const diffResult = diffResults[0];
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
  const { file_info, resolved_items, rejected_items, skipped_items, correction_items } = payload;

  const departmentId = requireUserDepartment(user);

  if (!file_info || !file_info.project_code || !file_info.scope_name_display || !file_info.company_name) {
    throw new AppError(400, "Missing file info in confirm payload");
  }

  const ingestionSource = file_info.metadata_source === "manual_paste" ? "manual_paste" : "excel_upload";

  const resolvedItems = Array.isArray(resolved_items) ? resolved_items : [];
  const rejectedItems = Array.isArray(rejected_items) ? rejected_items : [];
  const skippedItems = Array.isArray(skipped_items) ? skipped_items : [];
  const correctionItems = Array.isArray(correction_items) ? correction_items : [];
  const actionableItems = [];
  const uploadDecisionLogs = [];
  const seenFixtureNumbers = new Set();

  for (const item of resolvedItems) {
    if (!item || typeof item !== "object" || !item.data) {
      throw new AppError(400, "Malformed resolved_items payload");
    }

    const fixtureData = item.data;
    const resolution = normalizeResolution(item.resolution);
    const scopeDecision = normalizeScopeDecision(item.scope_decision);
    const scopeAssessment = classifyScopeOwnership(fixtureData.remark);

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
        scope_name: file_info.scope_name_display,
        fixture_no: fixtureData.fixture_no,
        row_number: fixtureData.row_number,
      });
      continue;
    }

    if (scopeAssessment.status === SCOPE_STATUSES.CUSTOMER) {
      logImportDecision("blocked_customer_scope_fixture", {
        project_code: file_info.project_code,
        scope_name: file_info.scope_name_display,
        fixture_no: fixtureData.fixture_no,
        row_number: fixtureData.row_number,
      });

      // Audit: block customer-scope imports (no fixture mutations happen for this row)
      await createAuditLog({
        userEmployeeId: user.employee_id,
        actionType: "DESIGN_FIXTURE_BLOCKED_CUSTOMER_SCOPE",
        targetType: "design_fixture",
        targetId: fixtureData.fixture_no || "unknown",
        metadata: {
          project_code: file_info.project_code,
          scope_name: file_info.scope_name_display,
          row_number: fixtureData.row_number,
          ingestion_source: file_info.metadata_source,
        },
      });

      throw new AppError(400, buildDecisionErrorMessage("Customer-scope fixture cannot be imported", fixtureData));
    }

    if (scopeAssessment.status === SCOPE_STATUSES.AMBIGUOUS) {
      if (!scopeDecision) {
        await createAuditLog({
          userEmployeeId: user.employee_id,
          actionType: "DESIGN_FIXTURE_MISSING_AMBIGUOUS_SCOPE_DECISION",
          targetType: "design_fixture",
          targetId: fixtureData.fixture_no || "unknown",
          metadata: {
            project_code: file_info.project_code,
            scope_name: file_info.scope_name_display,
            row_number: fixtureData.row_number,
            ingestion_source: file_info.metadata_source,
          },
        });

        throw new AppError(
          400,
          buildDecisionErrorMessage("This fixture does not have a clearly defined scope in remarks. Choose Add Fixture or Skip Fixture", fixtureData),
        );
      }

      if (scopeDecision === "skip_fixture") {
        uploadDecisionLogs.push({
          row_number: Number.isFinite(Number(fixtureData.row_number)) ? Number(fixtureData.row_number) : 0,
          excel_row: Number.isFinite(Number(fixtureData.excel_row)) ? Number(fixtureData.excel_row) : null,
          row_reference: normalizeRowReference(fixtureData),
          fixture_no: fixtureData.fixture_no || null,
          error_message: buildDecisionErrorMessage("Ambiguous-scope fixture skipped by explicit user decision", fixtureData),
        });
        logImportDecision("user_skipped_ambiguous_fixture", {
          project_code: file_info.project_code,
          scope_name: file_info.scope_name_display,
          fixture_no: fixtureData.fixture_no,
          row_number: fixtureData.row_number,
        });
        continue;
      }

      logImportDecision("user_confirmed_ambiguous_fixture", {
        project_code: file_info.project_code,
        scope_name: file_info.scope_name_display,
        fixture_no: fixtureData.fixture_no,
        row_number: fixtureData.row_number,
      });
    }

    assertImportableFixtureShape(fixtureData);

    const normalizedFixtureNo = String(fixtureData.fixture_no).trim().toLowerCase();
    if (seenFixtureNumbers.has(normalizedFixtureNo)) {
      await createAuditLog({
        userEmployeeId: user.employee_id,
        actionType: "DESIGN_FIXTURE_DUPLICATE_IN_CONFIRM_PAYLOAD",
        targetType: "design_fixture",
        targetId: fixtureData.fixture_no || "unknown",
        metadata: {
          project_code: file_info.project_code,
          scope_name: file_info.scope_name_display,
          row_number: fixtureData.row_number,
          ingestion_source: file_info.metadata_source,
        },
      });

      throw new AppError(400, buildDecisionErrorMessage("Duplicate fixture identity detected in confirm payload", fixtureData));
    }

    seenFixtureNumbers.add(normalizedFixtureNo);
    actionableItems.push(fixtureData);
  }

  if (actionableItems.length === 0) {
    throw new AppError(400, "No PARC-scope fixtures were approved for import");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const workflow = await getActiveWorkflowForDepartment(departmentId, client);
    if (!workflow || !Array.isArray(workflow.stages) || workflow.stages.length === 0) {
      throw new AppError(409, `No workflow configured for department ${departmentId}`);
    }

    const project = await upsertProjectByNumber({
      project_no: file_info.project_code,
      project_name: file_info.project_code,
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

    const scope = await findOrCreateScope(project.project_id, file_info.scope_name_display, client);

    let acceptedCount = 0;
      const strictRejectedItems = [
        ...rejectedItems,
        ...skippedItems.map((item) => ({
          row_number: item.row_number,
          excel_row: item.excel_row ?? null,
          row_reference: item.row_reference || normalizeRowReference(item),
          fixture_no: item.fixture_no || null,
          raw_data: item.raw_data || {},
          error_message: item.skip_reason || "Customer-scope fixture skipped.",
        })),
        ...uploadDecisionLogs,
      ];

    if (!project?.project_id) {
      throw new AppError(500, "Project resolution failed during controlled import");
    }

    if (!scope?.scope_id) {
      throw new AppError(500, "Scope resolution failed during controlled import");
    }

    const batchId = await createUploadBatch({
      project_id: project.project_id,
      scope_id: scope.scope_id,
      uploaded_by: user.employee_id,
      total_rows: actionableItems.length + strictRejectedItems.length,
      accepted_rows: actionableItems.length,
      rejected_rows: strictRejectedItems.length,
    }, client);

    for (const fixtureData of actionableItems) {
      const scopeAssessment = classifyScopeOwnership(fixtureData.remark);
      if (scopeAssessment.status !== SCOPE_STATUSES.PARC && scopeAssessment.status !== SCOPE_STATUSES.AMBIGUOUS) {
        throw new AppError(400, buildDecisionErrorMessage("Fixture failed final ownership verification", fixtureData));
      }

      const fixtureObj = {
        project_id: project.project_id,
        scope_id: scope.scope_id,
        batch_id: batchId,
        fixture_no: fixtureData.fixture_no,
        op_no: fixtureData.op_no,
        part_name: fixtureData.part_name,
        fixture_type: fixtureData.fixture_type,
        remark: fixtureData.remark || null,
        qty: fixtureData.qty,
        image_1_url: fixtureData.image_1_url || null,
        image_2_url: fixtureData.image_2_url || null,
        ingestion_source: ingestionSource,
      };

      const fixture = await upsertFixture(fixtureObj, client);
      await initProgressForFixture(fixture.fixture_id, departmentId, workflow.stages, client);

      logImportDecision("imported_fixture", {
        batch_id: batchId,
        project_id: project.project_id,
        scope_id: scope.scope_id,
        fixture_id: fixture.fixture_id,
        fixture_no: fixtureData.fixture_no,
        row_number: fixtureData.row_number,
        ingestion_source: ingestionSource,
      });

      await createAuditLog({
        userEmployeeId: user.employee_id,
        actionType: "DESIGN_FIXTURE_IMPORTED",
        targetType: "design_fixture",
        targetId: fixture.fixture_id || fixtureData.fixture_no || "unknown",
        metadata: {
          batch_id: batchId,
          fixture_id: fixture.fixture_id,
          project_id: project.project_id,
          scope_id: scope.scope_id,
          project_code: file_info.project_code,
          scope_name: file_info.scope_name_display,
          row_number: fixtureData.row_number,
          ingestion_source: ingestionSource,
        },
      }, client);

      acceptedCount++;
    }

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
            scope_name: file_info.scope_name_display,
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
            scope_name: file_info.scope_name_display,
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
    return { success: true, batch_id: batchId, accepted_count: acceptedCount };
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error("Design upload confirmation failed", {
      operation: "confirmUpload",
      department_id: departmentId,
      user_employee_id: user?.employee_id || null,
      project_code: file_info?.project_code || null,
      scope_name: file_info?.scope_name_display || null,
      accepted_item_count: actionableItems.length,
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
