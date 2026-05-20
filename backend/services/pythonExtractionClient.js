// DEPRECATED: External Python extraction client removed.
// Native Node-based Excel ingestion is authoritative. This file is retained as a deprecated stub
// to make accidental references fail fast and to provide rollback safety.

const { AppError } = require("../lib/AppError");

async function extractDesignWorkbook() {
  throw new AppError(500, "DEPRECATED: pythonExtractionClient is removed. Use native Excel ingestion.");
}

module.exports = {
  extractDesignWorkbook,
};
const RETRYABLE_EXTRACTION_STATUS_CODES = new Set([502, 503, 504]);
const EXTRACTION_MAX_ATTEMPTS = 2;

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

function normalizeOptionalString(value) {
  const normalized = normalizeString(value);
  return normalized || null;
}

function normalizeImageUploadPayload(value, rowIndex, fieldName) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    throw new AppError(502, "Failed to process file", `Python row ${rowIndex + 1} returned an invalid ${fieldName} payload`, "DESIGN_EXTRACTION_INVALID_RESPONSE");
  }

  const contentBase64 = normalizeString(value.content_base64);
  const mimeType = normalizeString(value.mime_type);
  const extension = normalizeString(value.extension);

  if (!contentBase64 || !mimeType || !extension) {
    throw new AppError(502, "Failed to process file", `Python row ${rowIndex + 1} returned an incomplete ${fieldName} payload`, "DESIGN_EXTRACTION_INVALID_RESPONSE");
  }

  return {
    content_base64: contentBase64,
    mime_type: mimeType,
    extension,
    anchor: value.anchor && typeof value.anchor === "object" ? value.anchor : {},
  };
}

function normalizeParserConfidence(value) {
  const normalized = normalizeString(value).toUpperCase();
  return normalized || "HIGH";
}

function normalizeRowReferenceSource(value) {
  const normalized = normalizeString(value).toLowerCase();
  return normalized === "business_serial" ? "business_serial" : "excel_row";
}

function derivePrimaryRowNumber(rowReference, excelRow) {
  if (/^\d+$/.test(rowReference)) {
    return Number(rowReference);
  }

  return excelRow;
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
  const project_name = normalizeString(fileInfo.project_name || fileInfo.project_name_display);
  const company_name = normalizeString(fileInfo.company_name);

  if (!project_code || !project_name || !company_name) {
    throw new AppError(502, "Failed to process file", "Python service returned incomplete file metadata", "DESIGN_EXTRACTION_INVALID_RESPONSE");
  }

  return {
    project_code,
    project_name,
    project_name_display: project_name,
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
      row_number: derivePrimaryRowNumber(normalizeString(row.row_reference || row.business_row_reference || row.row_number), excel_row),
      row_reference: normalizeString(row.row_reference || row.business_row_reference || row.row_number || excel_row),
      row_reference_source: normalizeRowReferenceSource(row.row_reference_source),
      business_row_reference: normalizeOptionalString(row.business_row_reference),
      fixture_no: normalizeString(row.fixture_no),
      op_no: normalizeString(row.op_no),
      part_name: normalizeString(row.part_name),
      fixture_type: normalizeString(row.fixture_type),
      remark: null,
      qty: row.qty,
      image_1_url: normalizeOptionalImageUrl(row.image_1_url),
      image_2_url: normalizeOptionalImageUrl(row.image_2_url),
      image_1_upload: normalizeImageUploadPayload(row.image_1_upload, index, "image_1_upload"),
      image_2_upload: normalizeImageUploadPayload(row.image_2_upload, index, "image_2_upload"),
      parser_confidence: normalizeParserConfidence(row.parser_confidence),
      raw_data: row.raw_data && typeof row.raw_data === "object" ? row.raw_data : {},
    };
  });
}

function extractPythonErrorDetails(payload) {
  return payload?.errors || payload?.message || payload?.detail || null;
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
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

  const forwardedName = sanitizeOriginalFileName(file.originalname);
  const fileBlob = new Blob([file.buffer], { type: file.mimetype });

  for (let attempt = 1; attempt <= EXTRACTION_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), env.designExtraction.timeoutMs);

    try {
      const formData = new FormData();
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
        const errorDetails = extractPythonErrorDetails(payload);

        if (
          response.status >= 500
          && RETRYABLE_EXTRACTION_STATUS_CODES.has(response.status)
          && attempt < EXTRACTION_MAX_ATTEMPTS
        ) {
          await wait(1000);
          continue;
        }

        throw new AppError(
          response.status === 504 ? 504 : 502,
          "Failed to process file",
          errorDetails,
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

      const isAbortError = error?.name === "AbortError";

      if (attempt < EXTRACTION_MAX_ATTEMPTS) {
        await wait(1000);
        continue;
      }

      if (isAbortError) {
        throw new AppError(504, "Failed to process file", "Python extraction service timed out", "DESIGN_EXTRACTION_TIMEOUT");
      }

      throw new AppError(502, "Failed to process file", error?.message || null, "DESIGN_EXTRACTION_UNAVAILABLE");
    } finally {
      clearTimeout(timeoutHandle);
    }
  }
}

module.exports = {
  extractDesignWorkbook,
};
