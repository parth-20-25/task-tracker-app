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
  upsertFixture
} = require("../repositories/designProjectCatalogRepository");

const { parsePasteData, normalize } = require("./designIngestion/parser");
const { SCOPE_STATUSES, classifyScopeOwnership } = require("./designIngestion/scope");
const { validateParsedData } = require("./designIngestion/validator");
const { diffWithDatabase } = require("./designIngestion/differ");
const { formatPreview } = require("./designIngestion/formatter");
const { extractDesignWorkbook } = require("./pythonExtractionClient");

function mapExtractionErrors(errors = []) {
  return errors.map((error) => ({
    row_number: error.excel_row || 0,
    error_message: error.error_message,
    raw_data: error.raw_data || {},
  }));
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
  const opNo = String(fixtureData.op_no || "").trim();
  const partName = String(fixtureData.part_name || "").trim();
  const fixtureType = String(fixtureData.fixture_type || "").trim();
  const qty = Number(fixtureData.qty);

  if (!fixtureNo || !opNo || !partName || !fixtureType || !Number.isInteger(qty) || qty <= 0) {
    throw new AppError(400, buildDecisionErrorMessage("Fixture confirmation payload failed strict validation", fixtureData));
  }
}

async function buildPreviewPayload(user, {
  fileInfo,
  validRows,
  rejectedRows,
  skippedRows,
  metadataSource,
}) {
  const departmentId = requireUserDepartment(user);
  const project_code_clean = fileInfo.project_code.trim();
  const scope_name_display = fileInfo.scope_name.trim();
  const scope_name_normalized = normalize(scope_name_display);
  const company_name_clean = fileInfo.company_name.trim();

  const client = await pool.connect();
  let existingFixtures = [];
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

    if (projectCheck.rows.length > 0) {
      const projectId = projectCheck.rows[0].project_id;
      const scopeCheck = await client.query(
        `
          SELECT id AS scope_id, scope_name
          FROM design.scopes
          WHERE project_id = $1
        `,
        [projectId],
      );

      for (const sc of scopeCheck.rows) {
        if (normalize(sc.scope_name) === scope_name_normalized) {
          existingFixtures = await findFixturesByScopeForDedupe(sc.scope_id, client);
          break;
        }
      }
    }
  } finally {
    client.release();
  }

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
    const rejectedRows = [...mapExtractionErrors(extractionResult.errors), ...validationErrors];

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

async function confirmUpload(user, payload = {}) {
  const { file_info, resolved_items, rejected_items, skipped_items } = payload;

  const departmentId = requireUserDepartment(user);

  if (!file_info || !file_info.project_code || !file_info.scope_name_display || !file_info.company_name) {
    throw new AppError(400, "Missing file info in confirm payload");
  }

  const ingestionSource = file_info.metadata_source === "manual_paste" ? "manual_paste" : "excel_upload";

  const resolvedItems = Array.isArray(resolved_items) ? resolved_items : [];
  const rejectedItems = Array.isArray(rejected_items) ? rejected_items : [];
  const skippedItems = Array.isArray(skipped_items) ? skipped_items : [];
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
        fixture_no: item.fixture_no || null,
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
        error_message: r.error_message,
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
            error_message: r.error_message,
            ingestion_source: ingestionSource,
          },
        }, client);
      }

      await createUploadErrors(batchId, errorsPayload, client);
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
});
