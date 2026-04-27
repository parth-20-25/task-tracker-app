const { AppError } = require("../../lib/AppError");

function normalize(str) {
  return String(str || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z]/g, "")
    .replace(/\s+/g, "");
}

function detectDelimiter(rows) {
  const sampleRows = rows.slice(0, 5);
  for (const row of sampleRows) {
    if (row.includes('\t')) {
      return '\t';
    }
  }

  // Check for consistent multiple spaces
  for (const row of sampleRows) {
    if (/\s{2,}/.test(row)) {
      return /\s{2,}/;
    }
  }

  throw new AppError(400, "Unable to detect valid delimiter in table data. Please paste directly from Excel.");
}

function parsePasteData(text) {
  if (!text) throw new AppError(400, "No paste data provided");

  const normalizedText = text.replace(/\r\n/g, '\n').trim();
  const rawRows = normalizedText.split('\n').filter(r => r.trim() !== '');

  if (rawRows.length < 2) {
    throw new AppError(400, "Paste data must contain a header line and at least one table header/data line.");
  }

  // 1. Header Parsing (STRICT LOGIC)
  const headerLine = rawRows[0].trim();
  
  if (!headerLine.startsWith("WBS-")) {
    throw new AppError(400, "Invalid header format: Missing 'WBS-' prefix.");
  }

  const withoutWbs = headerLine.substring(4);
  const firstDashIndex = withoutWbs.indexOf('-');

  if (firstDashIndex === -1) {
    throw new AppError(400, "Invalid header format: Missing '-' separator after project code.");
  }

  const project_code = withoutWbs.substring(0, firstDashIndex).trim();
  const remaining = withoutWbs.substring(firstDashIndex + 1).trim();

  // Step 4: Split at first "_" — company name may itself contain underscores
  const wbsParts = remaining.split('_');

  if (wbsParts.length < 2) {
    throw new AppError(400, "Invalid format: missing '_' separator");
  }

  const scope_name = wbsParts[0].trim();
  const company_name = wbsParts.slice(1).join('_').trim();

  if (!project_code || !scope_name || !company_name) {
    throw new AppError(400, "Invalid header format: One or more fields (project code, scope name, company name) are empty.");
  }

  // Table Data Processing
  const tableRows = rawRows.slice(1);
  const delimiter = detectDelimiter(tableRows);

  const expectedHeaders = ["s. no", "fixture no", "op.no", "part name", "fixture type", "qty", "designer"];
  
  const headerRowStr = tableRows[0];
  const headerCols = headerRowStr.split(delimiter).map(c => String(c).trim().toLowerCase());

  if (headerCols.length < expectedHeaders.length) {
    throw new AppError(400, `Table header mismatch. Expected columns: ${expectedHeaders.join(', ')}`);
  }

  for (let i = 0; i < expectedHeaders.length; i++) {
    // Designer can be ignored functionally but header should still be roughly matching
    // For safety we only enforce the first 6 columns strictly if designer is missing, but user says "designer column ignored" for data, header still has to match? 
    // Usually it's better to just ensure the exact header at least matches for structure.
    if (expectedHeaders[i] !== "designer" && headerCols[i] !== expectedHeaders[i]) {
      throw new AppError(400, `Table header mismatch at column ${i + 1}. Expected: "${expectedHeaders[i]}", Found: "${headerCols[i]}"`);
    }
  }

  const parsedRows = [];
  // Skip table header
  for (let i = 1; i < tableRows.length; i++) {
    const cols = tableRows[i].split(delimiter).map(c => String(c).trim());
    parsedRows.push({
      row_number: i + 2, // offset by 2 (1 for main header, 1 for table header)
      cols
    });
  }

  return {
    file_info: {
      project_code,
      scope_name,
      company_name
    },
    parsedRows
  };
}

module.exports = {
  normalize,
  parsePasteData
};
