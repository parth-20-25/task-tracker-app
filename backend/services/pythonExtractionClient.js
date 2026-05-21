const XLSX = require("xlsx");
const { AppError } = require("../lib/AppError");
const { parseTabularRows } = require("./designIngestion/parser");

function normalizeCellValue(value) {
  if (value === null || value === undefined) {
    return "";
  }

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  return String(value)
    .replace(/\r\n/g, " ")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function rowToText(row = []) {
  return row.map(normalizeCellValue).join("\t").trim();
}

function workbookRowsToTabularEntries(workbook) {
  const entries = [];

  for (const sheetName of workbook.SheetNames || []) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
      continue;
    }

    const rows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      blankrows: false,
      defval: "",
      raw: false,
    });

    rows.forEach((row, index) => {
      const text = rowToText(row);
      if (!text) {
        return;
      }

      entries.push({
        text,
        row_number: entries.length + 1,
        excel_row: index + 1,
        sheet_name: sheetName,
      });
    });
  }

  return entries;
}

async function extractDesignWorkbook(file) {
  if (!file?.buffer?.length) {
    throw new AppError(400, "No Excel file uploaded");
  }

  let workbook;
  try {
    workbook = XLSX.read(file.buffer, {
      type: "buffer",
      cellDates: true,
      cellNF: false,
      cellHTML: false,
    });
  } catch (error) {
    throw new AppError(400, "Workbook could not be parsed as a valid .xlsx file", {
      reason: error?.message || "xlsx_parse_failed",
    });
  }

  const entries = workbookRowsToTabularEntries(workbook);
  if (entries.length === 0) {
    throw new AppError(400, "Workbook does not contain any readable rows");
  }

  const parsed = parseTabularRows(entries, "Workbook does not contain any readable rows");

  return {
    file_info: {
      ...parsed.file_info,
      metadata_source: "native_excel_upload",
      original_file_name: file.originalname || null,
    },
    rows: parsed.parsedRows.map((row) => ({
      ...row,
      image_1_url: row.image_1_url || null,
      image_2_url: row.image_2_url || null,
      raw_data: {
        ...(row.raw_data || {}),
        original_file_name: file.originalname || null,
        extraction_source: "native_xlsx",
      },
    })),
    errors: [],
  };
}

module.exports = {
  extractDesignWorkbook,
};
