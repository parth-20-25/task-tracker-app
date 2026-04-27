const { AppError } = require("../lib/AppError");
const { requireUserDepartment } = require("../lib/departmentContext");
const { instrumentModuleExports } = require("../lib/observability");
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

async function buildPreviewPayload(user, {
  fileInfo,
  validRows,
  rejectedRows,
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
  const preview = formatPreview(diffResults, rejectedRows);

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

  if (!text) {
    throw new AppError(400, "Missing required fields: text");
  }

  const { file_info, parsedRows } = parsePasteData(text);
  const { validRows, rejectedRows } = validateParsedData(parsedRows);

  return buildPreviewPayload(user, {
    fileInfo: {
      project_code: file_info.project_code,
      scope_name: file_info.scope_name,
      company_name: file_info.company_name,
    },
    validRows,
    rejectedRows,
    metadataSource: "manual_paste",
  });
}

async function parseAndPreviewUploadedWorkbook(user, file) {
  if (!file) {
    throw new AppError(400, "No Excel file uploaded");
  }

  const extractionResult = await extractDesignWorkbook(file);
  const { validRows, rejectedRows: validationErrors } = validateParsedData(extractionResult.rows);
  const rejectedRows = [...mapExtractionErrors(extractionResult.errors), ...validationErrors];

  return buildPreviewPayload(user, {
    fileInfo: extractionResult.file_info,
    validRows,
    rejectedRows,
    metadataSource: "python_excel_upload",
  });
}

async function confirmUpload(user, payload = {}) {
  const { file_info, resolved_items, rejected_items } = payload;

  const departmentId = requireUserDepartment(user);

  if (!file_info || !file_info.project_code || !file_info.scope_name_display || !file_info.company_name) {
    throw new AppError(400, "Missing file info in confirm payload");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

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
    const acceptedItems = resolved_items || [];
    const rejectedItems = rejected_items || [];

    const batchId = await createUploadBatch({
      project_id: project.project_id,
      scope_id: scope.scope_id,
      uploaded_by: user.employee_id,
      total_rows: acceptedItems.length + rejectedItems.length,
      accepted_rows: acceptedItems.length,
      rejected_rows: rejectedItems.length,
    }, client);

    for (const item of acceptedItems) {
      const fixtureData = item.data;
      const fixtureObj = {
        project_id: project.project_id,
        scope_id: scope.scope_id,
        batch_id: batchId,
        fixture_no: fixtureData.fixture_no,
        op_no: fixtureData.op_no,
        part_name: fixtureData.part_name,
        fixture_type: fixtureData.fixture_type,
        qty: fixtureData.qty,
        image_1_url: fixtureData.image_1_url || null,
        image_2_url: fixtureData.image_2_url || null,
      };

      await upsertFixture(fixtureObj, client);
      acceptedCount++;
    }

    if (rejectedItems.length > 0) {
      const errorsPayload = rejectedItems.map((r) => ({
        row_number: r.row_number,
        error_message: r.error_message,
      }));
      await createUploadErrors(batchId, errorsPayload, client);
    }

    await client.query("COMMIT");
    return { success: true, batch_id: batchId, accepted_count: acceptedCount };
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("UPLOAD_CONFIRM_ERROR", err);
    if (err instanceof AppError) {
      throw err;
    }

    throw new AppError(500, "Failed to confirm upload");
  } finally {
    client.release();
  }
}

module.exports = instrumentModuleExports("service.designExcelService", {
  parseAndPreviewUpload,
  parseAndPreviewUploadedWorkbook,
  confirmUpload
});
