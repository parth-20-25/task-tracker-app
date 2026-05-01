const { SCOPE_STATUSES, classifyScopeOwnership } = require("./scope");
const { FIXTURE_NO_REGEX, normalizePastedCell } = require("./parser");

function normalizeTextCell(value) {
  if (value === undefined || value === null) {
    return "";
  }

  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : String(value);
  }

  return normalizePastedCell(value);
}

function normalizeFixtureNo(value) {
  return normalizeTextCell(value)
    .replace(/\s+/g, "")
    .toUpperCase();
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
      designer: cols[6] || "",
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
    designer: normalizeTextCell(item?.designer),
    qty: item?.qty,
    image_1_url: null,
    image_2_url: null,
    parser_confidence: normalizeTextCell(item?.parser_confidence || "HIGH").toUpperCase(),
    raw_data: rawData || {
      fixture_no: item?.fixture_no ?? null,
      op_no: item?.op_no ?? null,
      part_name: item?.part_name ?? null,
      fixture_type: item?.fixture_type ?? null,
      remark: item?.remark ?? null,
      designer: item?.designer ?? null,
      qty: item?.qty ?? null,
      image_1_url: null,
      image_2_url: null,
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
      designer,
      qty: qtyRaw,
      image_1_url,
      image_2_url,
      parser_confidence,
      raw_data,
    } = extractRowFields(item);

    const normalizedFixtureNo = normalizeFixtureNo(fixture_no);

    if (!normalizedFixtureNo) {
      rejectedRows.push({
        row_number,
        error_message: "Fixture No is mandatory for import.",
        raw_data,
      });
      continue;
    }

    if (!FIXTURE_NO_REGEX.test(normalizedFixtureNo)) {
      rejectedRows.push({
        row_number,
        error_message: "Fixture No must match the PARC fixture format.",
        raw_data,
      });
      continue;
    }

    if (!op_no || !part_name || !fixture_type || !qtyRaw) {
      const missing = [];
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
    if (isNaN(qty) || !/^\d+$/.test(qtyText) || qty <= 0) {
      rejectedRows.push({
        row_number,
        error_message: "QTY must be a valid numeric value.",
        raw_data,
      });
      continue;
    }

    if (parser_confidence && parser_confidence !== "HIGH") {
      rejectedRows.push({
        row_number,
        error_message: "Row confidence is too low for controlled fixture import.",
        raw_data,
      });
      continue;
    }

    const scopeAssessment = classifyScopeOwnership(remark);
    if (scopeAssessment.status === SCOPE_STATUSES.CUSTOMER) {
      skippedRows.push({
        row_number,
        fixture_no: normalizedFixtureNo,
        op_no,
        part_name,
        fixture_type,
        remark: remark || null,
        designer: designer || null,
        qty,
        image_1_url,
        image_2_url,
        scope_status: scopeAssessment.status,
        skip_reason: scopeAssessment.reason,
        raw_data,
      });
      continue;
    }

    const fixtureNoKey = normalizedFixtureNo.toLowerCase();
    if (seenFixtureNumbers.has(fixtureNoKey)) {
      rejectedRows.push({
        row_number,
        error_message: "Duplicate fixture number found in uploaded file.",
        raw_data,
      });
      continue;
    }

    seenFixtureNumbers.add(fixtureNoKey);

    validRows.push({
      row_number,
      fixture_no: normalizedFixtureNo,
      op_no,
      part_name,
      fixture_type,
      remark: remark || null,
      designer: designer || null,
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
