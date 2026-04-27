const { AppError } = require("../lib/AppError");
const { sanitizeOriginalFileName } = require("../lib/designExcelUpload");
const { env } = require("../config/env");

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function normalizeString(value) {
  return String(value || "").trim();
}

function normalizeOptionalImageUrl(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const normalized = String(value).trim();

  if (
    normalized.startsWith("/uploads/")
    || normalized.startsWith("http://")
    || normalized.startsWith("https://")
  ) {
    return normalized;
  }

  throw new AppError(502, "Failed to process file", "Python service returned an invalid image URL", "DESIGN_EXTRACTION_INVALID_URL");
}

function parseJsonResponse(text) {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (_error) {
    return null;
  }
}

function validatePythonFileInfo(fileInfo) {
  if (!fileInfo || typeof fileInfo !== "object") {
    throw new AppError(502, "Failed to process file", "Python service did not return file metadata", "DESIGN_EXTRACTION_INVALID_RESPONSE");
  }

  const project_code = normalizeString(fileInfo.project_code);
  const scope_name = normalizeString(fileInfo.scope_name || fileInfo.scope_name_display);
  const company_name = normalizeString(fileInfo.company_name);

  if (!project_code || !scope_name || !company_name) {
    throw new AppError(502, "Failed to process file", "Python service returned incomplete file metadata", "DESIGN_EXTRACTION_INVALID_RESPONSE");
  }

  return {
    project_code,
    scope_name,
    company_name,
  };
}

function validatePythonRows(rows) {
  if (!Array.isArray(rows)) {
    throw new AppError(502, "Failed to process file", "Python service did not return rows", "DESIGN_EXTRACTION_INVALID_RESPONSE");
  }

  return rows.map((row, index) => {
    if (!row || typeof row !== "object") {
      throw new AppError(502, "Failed to process file", `Python row ${index + 1} is malformed`, "DESIGN_EXTRACTION_INVALID_RESPONSE");
    }

    const excel_row = Number(row.excel_row);

    if (!isPositiveInteger(excel_row)) {
      throw new AppError(502, "Failed to process file", `Python row ${index + 1} is missing a valid excel_row`, "DESIGN_EXTRACTION_INVALID_RESPONSE");
    }

    return {
      excel_row,
      fixture_no: normalizeString(row.fixture_no),
      op_no: normalizeString(row.op_no),
      part_name: normalizeString(row.part_name),
      fixture_type: normalizeString(row.fixture_type),
      qty: row.qty,
      image_1_url: normalizeOptionalImageUrl(row.image_1_url),
      image_2_url: normalizeOptionalImageUrl(row.image_2_url),
    };
  });
}

function validatePythonErrors(errors) {
  if (!Array.isArray(errors)) {
    throw new AppError(502, "Failed to process file", "Python service did not return a valid errors list", "DESIGN_EXTRACTION_INVALID_RESPONSE");
  }

  return errors.map((error, index) => {
    if (!error || typeof error !== "object") {
      throw new AppError(502, "Failed to process file", `Python error ${index + 1} is malformed`, "DESIGN_EXTRACTION_INVALID_RESPONSE");
    }

    const excel_row = error.excel_row === null || error.excel_row === undefined
      ? null
      : Number(error.excel_row);

    if (excel_row !== null && !isPositiveInteger(excel_row)) {
      throw new AppError(502, "Failed to process file", `Python error ${index + 1} has an invalid excel_row`, "DESIGN_EXTRACTION_INVALID_RESPONSE");
    }

    const error_message = normalizeString(error.error_message || error.message);

    if (!error_message) {
      throw new AppError(502, "Failed to process file", `Python error ${index + 1} is missing a message`, "DESIGN_EXTRACTION_INVALID_RESPONSE");
    }

    return {
      excel_row,
      error_message,
      raw_data: error.raw_data && typeof error.raw_data === "object" ? error.raw_data : {},
    };
  });
}

async function extractDesignWorkbook(file) {
  if (!file?.buffer?.length) {
    throw new AppError(400, "No Excel file uploaded");
  }

  if (!env.designExtraction.serviceUrl) {
    throw new AppError(
      500,
      "Failed to process file",
      "DESIGN_EXTRACTION_SERVICE_URL is not configured",
      "DESIGN_EXTRACTION_NOT_CONFIGURED",
    );
  }

  if (!env.designExtraction.token) {
    throw new AppError(
      500,
      "Failed to process file",
      "DESIGN_EXTRACTION_SERVICE_TOKEN is not configured",
      "DESIGN_EXTRACTION_NOT_CONFIGURED",
    );
  }

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), env.designExtraction.timeoutMs);

  try {
    const formData = new FormData();
    const forwardedName = sanitizeOriginalFileName(file.originalname);
    const fileBlob = new Blob([file.buffer], { type: file.mimetype });

    formData.append("file", fileBlob, forwardedName);

    const response = await fetch(`${env.designExtraction.serviceUrl}/extract`, {
      method: "POST",
      body: formData,
      headers: {
        "x-extraction-token": env.designExtraction.token,
      },
      signal: controller.signal,
    });

    const text = await response.text();
    const payload = parseJsonResponse(text);

    if (!response.ok) {
      throw new AppError(
        502,
        "Failed to process file",
        payload?.errors || payload?.message || payload?.detail || null,
        "DESIGN_EXTRACTION_FAILED",
      );
    }

    return {
      file_info: validatePythonFileInfo(payload?.file_info),
      rows: validatePythonRows(payload?.rows),
      errors: validatePythonErrors(payload?.errors),
    };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    if (error?.name === "AbortError") {
      throw new AppError(504, "Failed to process file", "Python extraction service timed out", "DESIGN_EXTRACTION_TIMEOUT");
    }

    throw new AppError(502, "Failed to process file", error?.message || null, "DESIGN_EXTRACTION_UNAVAILABLE");
  } finally {
    clearTimeout(timeoutHandle);
  }
}

module.exports = {
  extractDesignWorkbook,
};
