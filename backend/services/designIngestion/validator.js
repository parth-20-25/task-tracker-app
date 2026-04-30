const { SCOPE_STATUSES, classifyScopeOwnership } = require("./scope");

function normalizeTextCell(value) {
  if (value === undefined || value === null) {
    return "";
  }

  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : String(value);
  }

  return String(value).trim();
}

function getRowNumber(item) {
  const rowNumber = item?.excel_row ?? item?.row_number;
  return Number(rowNumber);
}

function extractRowFields(item) {
  const rawData = item?.raw_data && typeof item.raw_data === "object"
    ? item.raw_data
    : null;

  if (Array.isArray(item?.cols)) {
    const cols = item.cols.map(normalizeTextCell);

    return {
      row_number: getRowNumber(item),
      fixture_no: cols[1],
      op_no: cols[2],
      part_name: cols[3],
      fixture_type: cols[4],
      remark: "",
      qty: cols[5],
      image_1_url: null,
      image_2_url: null,
      parser_confidence: "HIGH",
      raw_data: { cols },
    };
  }

  return {
    row_number: getRowNumber(item),
    fixture_no: normalizeTextCell(item?.fixture_no),
    op_no: normalizeTextCell(item?.op_no),
    part_name: normalizeTextCell(item?.part_name),
    fixture_type: normalizeTextCell(item?.fixture_type),
    remark: normalizeTextCell(item?.remark),
    qty: item?.qty,
    image_1_url: item?.image_1_url ? normalizeTextCell(item.image_1_url) : null,
    image_2_url: item?.image_2_url ? normalizeTextCell(item.image_2_url) : null,
    parser_confidence: normalizeTextCell(item?.parser_confidence || "HIGH").toUpperCase(),
    raw_data: rawData || {
      fixture_no: item?.fixture_no ?? null,
      op_no: item?.op_no ?? null,
      part_name: item?.part_name ?? null,
      fixture_type: item?.fixture_type ?? null,
      remark: item?.remark ?? null,
      qty: item?.qty ?? null,
      image_1_url: item?.image_1_url ?? null,
      image_2_url: item?.image_2_url ?? null,
    },
  };
}

function validateParsedData(parsedRows) {
  const validRows = [];
  const rejectedRows = [];
  const skippedRows = [];
  const seenFixtureNumbers = new Set();

  for (const item of parsedRows) {
    const {
      row_number,
      fixture_no,
      op_no,
      part_name,
      fixture_type,
      remark,
      qty: qtyRaw,
      image_1_url,
      image_2_url,
      parser_confidence,
      raw_data,
    } = extractRowFields(item);

    if (parser_confidence && parser_confidence !== "HIGH") {
      rejectedRows.push({
        row_number,
        error_message: "Row confidence is too low for controlled fixture import.",
        raw_data,
      });
      continue;
    }

    if (!fixture_no || !op_no || !part_name || !fixture_type || !qtyRaw) {
      const missing = [];
      if (!fixture_no) missing.push("FIXTURE NO");
      if (!op_no) missing.push("OP.NO");
      if (!part_name) missing.push("Part Name");
      if (!fixture_type) missing.push("Fixture Type");
      if (!qtyRaw) missing.push("QTY");
      
      rejectedRows.push({
        row_number,
        error_message: `Missing fields: ${missing.join(', ')}`,
        raw_data,
      });
      continue;
    }

    const qtyText = normalizeTextCell(qtyRaw);
    const qty = parseInt(qtyText, 10);
    // User requested "QTY must be numeric".
    if (isNaN(qty) || (String(qty) !== qtyText && !/^\d+$/.test(qtyText))) {
      rejectedRows.push({
        row_number,
        error_message: "QTY must be a valid numeric value.",
        raw_data,
      });
      continue;
    }

    const scopeAssessment = classifyScopeOwnership(remark);
    if (scopeAssessment.status === SCOPE_STATUSES.CUSTOMER) {
      skippedRows.push({
        row_number,
        fixture_no,
        op_no,
        part_name,
        fixture_type,
        remark: remark || null,
        qty,
        image_1_url,
        image_2_url,
        scope_status: scopeAssessment.status,
        skip_reason: scopeAssessment.reason,
        raw_data,
      });
      continue;
    }

    const normalizedFixtureNo = fixture_no.toLowerCase();
    if (seenFixtureNumbers.has(normalizedFixtureNo)) {
      rejectedRows.push({
        row_number,
        error_message: "Duplicate fixture number found in uploaded file.",
        raw_data,
      });
      continue;
    }

    seenFixtureNumbers.add(normalizedFixtureNo);

    validRows.push({
      row_number,
      fixture_no,
      op_no,
      part_name,
      fixture_type,
      remark: remark || null,
      qty,
      image_1_url,
      image_2_url,
      scope_status: scopeAssessment.status,
      scope_reason: scopeAssessment.reason,
    });
  }

  return { validRows, rejectedRows, skippedRows };
}

module.exports = {
  validateParsedData
};
