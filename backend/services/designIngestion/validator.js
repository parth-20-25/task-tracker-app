const { SCOPE_STATUSES, classifyScopeOwnership } = require("./scope");
const { FIXTURE_NO_REGEX, normalizePastedCell } = require("./parser");

const FIELD_LABELS = {
  fixture_no: "Fixture No",
  op_no: "OP.NO",
  part_name: "Part Name",
  fixture_type: "Fixture Type",
  qty: "QTY",
  remark: "Remark",
};

function normalizeTextCell(value) {
  if (value === undefined || value === null) {
    return "";
  }

  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : String(value);
  }

  return normalizePastedCell(value);
}

function normalizeNormalizedText(value) {
  return normalizeTextCell(value)
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeFixtureNo(value) {
  return normalizeNormalizedText(value)
    .replace(/\s+/g, "")
    .toUpperCase();
}

function normalizeOpNo(value) {
  const text = normalizeNormalizedText(value);
  if (!text) {
    return "";
  }

  if (/^OP[\s._/-]*\d+[A-Z0-9._/-]*$/i.test(text)) {
    return text
      .replace(/[\s._/-]+/g, " ")
      .replace(/^OP\s*/i, "OP ")
      .trim()
      .toUpperCase();
  }

  if (/^\d+(?:\.0+)?$/.test(text)) {
    return `OP ${text.split(".", 1)[0]}`;
  }

  return text;
}

function normalizeQty(value) {
  const text = normalizeNormalizedText(value);
  if (!text) {
    return { raw: text, normalized: null };
  }

  if (/^\d+$/.test(text)) {
    const qty = parseInt(text, 10);
    return { raw: text, normalized: qty > 0 ? qty : null };
  }

  if (/^\d+(?:\.0+)?$/.test(text)) {
    const qty = parseInt(text.split(".", 1)[0], 10);
    return { raw: text, normalized: qty > 0 ? qty : null };
  }

  return { raw: text, normalized: null };
}

function normalizeRowReferenceValue(value) {
  const normalized = normalizeTextCell(value);
  return normalized || null;
}

function normalizeRowReferenceSource(value) {
  return value === "business_serial" ? "business_serial" : "excel_row";
}

function getRowNumber(item) {
  const rowNumber = item?.row_number ?? item?.excel_row;
  return Number(rowNumber);
}

function getExcelRow(item) {
  const excelRow = item?.excel_row ?? item?.raw_data?.excel_row ?? null;
  return Number.isFinite(Number(excelRow)) ? Number(excelRow) : null;
}

function getBusinessRowReference(item) {
  const value = item?.business_row_reference ?? item?.raw_data?.business_row_reference ?? null;
  return normalizeRowReferenceValue(value);
}

function getRowReferenceSource(item) {
  return normalizeRowReferenceSource(item?.row_reference_source ?? item?.raw_data?.row_reference_source);
}

function getRowReference(item) {
  const explicitReference = normalizeRowReferenceValue(item?.row_reference ?? item?.raw_data?.row_reference);
  if (explicitReference) {
    return explicitReference;
  }

  const businessRowReference = getBusinessRowReference(item);
  if (businessRowReference) {
    return businessRowReference;
  }

  const excelRow = getExcelRow(item);
  const rowNumber = getRowNumber(item);
  const fallback = Number.isFinite(excelRow) && excelRow > 0 ? excelRow : rowNumber;
  return Number.isFinite(fallback) && fallback > 0 ? String(fallback) : "General";
}

function toFieldLabel(fieldName) {
  return FIELD_LABELS[fieldName] || fieldName;
}

function toFieldKey(label) {
  const normalized = String(label || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (normalized === "fixture_no") return "fixture_no";
  if (normalized === "op_no" || normalized === "op_no_") return "op_no";
  if (normalized === "part_name") return "part_name";
  if (normalized === "fixture_type") return "fixture_type";
  if (normalized === "qty") return "qty";
  if (normalized === "remark" || normalized === "remarks") return "remark";
  return null;
}

function buildProblemFields(reason, missingFields = [], candidateField) {
  const derived = new Set();

  missingFields.forEach((label) => {
    const key = toFieldKey(label);
    if (key) {
      derived.add(key);
    }
  });

  const candidateKey = toFieldKey(candidateField);
  if (candidateKey) {
    derived.add(candidateKey);
  }

  if (reason === "fixture_no_missing" || reason === "fixture_no_invalid" || reason === "duplicate_fixture_no") {
    derived.add("fixture_no");
  }

  if (reason === "qty_invalid") {
    derived.add("qty");
  }

  return Array.from(derived);
}

function buildFieldDiagnostics(fields) {
  return {
    sheet_name: fields?.sheet_name || null,
    excel_row: fields?.excel_row ?? null,
    row_reference: fields?.row_reference || null,
    row_reference_source: fields?.row_reference_source || "excel_row",
    business_row_reference: fields?.business_row_reference || null,
    raw: {
      fixture_no: fields.fixture_no_raw ?? null,
      op_no: fields.op_no_raw ?? null,
      part_name: fields.part_name_raw ?? null,
      fixture_type: fields.fixture_type_raw ?? null,
      qty: fields.qty_raw ?? null,
      remark: fields.remark_raw ?? null,
    },
    normalized: {
      fixture_no: fields.fixture_no ?? null,
      op_no: fields.op_no ?? null,
      part_name: fields.part_name ?? null,
      fixture_type: fields.fixture_type ?? null,
      qty: fields.qty ?? null,
      remark: fields.remark ?? null,
    },
    inherited: fields?.inherited || {},
  };
}

function buildRejectedRow(rowMeta, error_message, raw_data, diagnostics, extra = {}) {
  const row_reference = rowMeta?.row_reference || diagnostics?.row_reference || null;
  const row_reference_source = rowMeta?.row_reference_source || diagnostics?.row_reference_source || "excel_row";
  const business_row_reference = rowMeta?.business_row_reference ?? diagnostics?.business_row_reference ?? null;
  const excel_row = rowMeta?.excel_row ?? diagnostics?.excel_row ?? null;
  const row_number = Number.isFinite(Number(rowMeta?.row_number)) ? Number(rowMeta.row_number) : Number(rowMeta?.excel_row || 0);
  const missing_fields = Array.isArray(extra?.missing_fields) ? extra.missing_fields : [];
  const problem_fields = buildProblemFields(extra?.reason, missing_fields, extra?.candidate_field);

  return {
    row_number,
    excel_row,
    row_reference,
    row_reference_source,
    business_row_reference,
    error_message,
    raw_data: {
      ...(raw_data && typeof raw_data === "object" ? raw_data : {}),
      validation: {
        ...(diagnostics || {}),
        missing_fields,
        problem_fields,
        ...extra,
      },
    },
  };
}

function extractRowFields(item) {
  const rawData = item?.raw_data && typeof item.raw_data === "object"
    ? item.raw_data
    : null;

  if (Array.isArray(item?.cols)) {
    const cols = item.cols.map(normalizeTextCell);

    return {
      row_number: getRowNumber(item),
      excel_row: getExcelRow(item),
      row_reference: getRowReference(item),
      row_reference_source: getRowReferenceSource(item),
      business_row_reference: getBusinessRowReference(item),
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
      raw_data: {
        cols,
        excel_row: getExcelRow(item),
        row_reference: getRowReference(item),
        row_reference_source: getRowReferenceSource(item),
        business_row_reference: getBusinessRowReference(item),
      },
    };
  }

  return {
    row_number: getRowNumber(item),
    excel_row: getExcelRow(item),
    row_reference: getRowReference(item),
    row_reference_source: getRowReferenceSource(item),
    business_row_reference: getBusinessRowReference(item),
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
      excel_row: getExcelRow(item),
      row_reference: getRowReference(item),
      row_reference_source: getRowReferenceSource(item),
      business_row_reference: getBusinessRowReference(item),
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
      excel_row,
      row_reference,
      row_reference_source,
      business_row_reference,
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
    const rowMeta = {
      row_number,
      excel_row,
      row_reference,
      row_reference_source,
      business_row_reference,
    };

    const normalizedFixtureNo = normalizeFixtureNo(fixture_no);
    const normalizedOpNo = normalizeOpNo(op_no);
    const normalizedPartName = normalizeNormalizedText(part_name);
    const normalizedFixtureType = normalizeNormalizedText(fixture_type);
    const normalizedRemark = normalizeNormalizedText(remark);
    const normalizedDesigner = normalizeNormalizedText(designer);
    const qtyInfo = normalizeQty(qtyRaw);
    const diagnostics = buildFieldDiagnostics({
      sheet_name: raw_data?.sheet_name || null,
      excel_row,
      row_reference,
      row_reference_source,
      business_row_reference,
      fixture_no_raw: fixture_no,
      op_no_raw: op_no,
      part_name_raw: part_name,
      fixture_type_raw: fixture_type,
      qty_raw: qtyInfo.raw,
      remark_raw: remark,
      fixture_no: normalizedFixtureNo,
      op_no: normalizedOpNo || null,
      part_name: normalizedPartName || null,
      fixture_type: normalizedFixtureType || null,
      qty: qtyInfo.normalized,
      remark: normalizedRemark || null,
      inherited: raw_data?.inherited_hints || {},
    });

    if (!normalizedFixtureNo) {
      rejectedRows.push(buildRejectedRow(rowMeta, "Fixture No is mandatory for import.", raw_data, diagnostics, {
        reason: "fixture_no_missing",
        expected: "A PARC fixture number such as PARC25119001",
        missing_fields: [toFieldLabel("fixture_no")],
      }));
      continue;
    }

    if (!FIXTURE_NO_REGEX.test(normalizedFixtureNo)) {
      rejectedRows.push(buildRejectedRow(rowMeta, "Fixture No must match the PARC fixture format.", raw_data, diagnostics, {
        reason: "fixture_no_invalid",
        expected: "A PARC fixture number such as PARC25119001",
      }));
      continue;
    }

    if (!normalizedPartName || !normalizedFixtureType || qtyInfo.normalized === null) {
      const missing = [];
      if (!normalizedPartName) missing.push("Part Name");
      if (!normalizedFixtureType) missing.push("Fixture Type");
      if (qtyInfo.normalized === null) missing.push("QTY");
      
      rejectedRows.push(buildRejectedRow(
        rowMeta,
        `Missing fields: ${missing.join(", ")}`,
        raw_data,
        diagnostics,
        {
          reason: "required_field_missing",
          missing_fields: missing,
        },
      ));
      continue;
    }

    if (qtyInfo.normalized === null) {
      rejectedRows.push(buildRejectedRow(rowMeta, "QTY must be a valid numeric value.", raw_data, diagnostics, {
        reason: "qty_invalid",
        expected: "A positive number such as 1, 2, or 2.0",
      }));
      continue;
    }

    const qty = qtyInfo.normalized;
    const scopeAssessment = classifyScopeOwnership(normalizedRemark);
    if (scopeAssessment.status === SCOPE_STATUSES.CUSTOMER) {
      skippedRows.push({
        row_number,
        excel_row,
        row_reference,
        row_reference_source,
        business_row_reference,
        fixture_no: normalizedFixtureNo,
        op_no: normalizedOpNo,
        part_name: normalizedPartName,
        fixture_type: normalizedFixtureType,
        remark: normalizedRemark || null,
        designer: normalizedDesigner || null,
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
      rejectedRows.push(buildRejectedRow(rowMeta, "Duplicate fixture number found in uploaded file.", raw_data, diagnostics, {
        reason: "duplicate_fixture_no",
      }));
      continue;
    }

    seenFixtureNumbers.add(fixtureNoKey);

    validRows.push({
      row_number,
      excel_row,
      row_reference,
      row_reference_source,
      business_row_reference,
      fixture_no: normalizedFixtureNo,
      op_no: normalizedOpNo,
      part_name: normalizedPartName,
      fixture_type: normalizedFixtureType,
      remark: normalizedRemark || null,
      designer: normalizedDesigner || null,
      qty,
      image_1_url,
      image_2_url,
      scope_status: scopeAssessment.status,
      scope_reason: scopeAssessment.reason,
      parser_confidence,
      raw_data,
    });
  }

  return { validRows, rejectedRows, skippedRows };
}

module.exports = {
  validateParsedData
};
