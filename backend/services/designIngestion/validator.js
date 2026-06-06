const { FIXTURE_NO_REGEX, normalizePastedCell } = require("./parser");
const { canonicalFixtureNo, normalizeComparableText } = require("./normalize");

const FIELD_LABELS = {
  fixture_no: "Fixture No",
  op_no: "OP.NO",
  part_name: "Part Name",
  fixture_type: "Fixture Type",
  qty: "QTY",
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
  return canonicalFixtureNo(value);
}

function isStandaloneVendorFixtureTypeLabel(normalizedHumanReadableType) {
  const t = normalizeComparableText(normalizedHumanReadableType);
  if (!t) {
    return false;
  }
  // Reject vague vendor labels without a concrete process/fixture description
  return /^(vendor|outsourced|outsourcing|o\/s|sub[- ]?con(?:trac(?:tor|ting)?)?|subcon|scm vendor)$/.test(t);
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
  if (normalized === "op_no" || normalized === "opno" || normalized === "operation" || normalized === "operation_no") return "op_no";
  if (normalized === "part_name") return "part_name";
  if (normalized === "fixture_type") return "fixture_type";
  if (normalized === "qty") return "qty";
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

  if (reason === "op_no_missing" || reason === "op_no_invalid") {
    derived.add("op_no");
  }

  if (reason === "qty_invalid") {
    derived.add("qty");
  }

  if (reason === "vendor_fixture_type_vague") {
    derived.add("fixture_type");
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
    },
    normalized: {
      fixture_no: fields.fixture_no ?? null,
      op_no: fields.op_no ?? null,
      part_name: fields.part_name ?? null,
      fixture_type: fields.fixture_type ?? null,
      qty: fields.qty || null,
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
    qty: item?.qty,
    image_1_url: item?.image_1_url || null,
    image_2_url: item?.image_2_url || null,
    parser_confidence: normalizeTextCell(item?.parser_confidence || "HIGH").toUpperCase(),
    raw_data: rawData || {
      fixture_no: item?.fixture_no ?? null,
      op_no: item?.op_no ?? null,
      part_name: item?.part_name ?? null,
      fixture_type: item?.fixture_type ?? null,
      qty: item?.qty ?? null,
      excel_row: getExcelRow(item),
      row_reference: getRowReference(item),
      row_reference_source: getRowReferenceSource(item),
      business_row_reference: getBusinessRowReference(item),
    },
  };
}

function normalizeOpNo(value) {
  const raw = normalizeNormalizedText(value);
  if (!raw) {
    return { raw, normalized: null };
  }

  const withoutPrefix = raw
    .replace(/^op(?:\s*[\.-]?\s*no\.?)?[\.\-\s]*/i, "")
    .trim();
  const candidate = withoutPrefix || raw;
  const match = candidate.match(/^(\d+)(?:\.0+)?([a-z]*)$/i);

  if (!match) {
    return { raw, normalized: null };
  }

  const number = String(parseInt(match[1], 10));
  const suffix = String(match[2] || "").toUpperCase();

  return {
    raw,
    normalized: `OP ${number}${suffix}`,
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
    const opNoInfo = normalizeOpNo(op_no);
    const normalizedPartName = normalizeNormalizedText(part_name);
    const normalizedFixtureType = normalizeNormalizedText(fixture_type);
    const qtyInfo = normalizeQty(qtyRaw);
    const diagnostics = buildFieldDiagnostics({
      sheet_name: raw_data?.sheet_name || null,
      excel_row,
      row_reference,
      row_reference_source,
      business_row_reference,
      fixture_no_raw: fixture_no,
      op_no_raw: opNoInfo.raw,
      part_name_raw: part_name,
      fixture_type_raw: fixture_type,
      qty_raw: qtyInfo.raw,
      fixture_no: normalizedFixtureNo,
      op_no: opNoInfo.normalized,
      part_name: normalizedPartName || null,
      fixture_type: normalizedFixtureType || null,
      qty: qtyInfo.normalized,
      inherited: raw_data?.inherited_hints || {},
    });

    if (!normalizedFixtureNo) {
      rejectedRows.push(buildRejectedRow(rowMeta, "Fixture No is mandatory for import.", raw_data, diagnostics, {
        reason: "fixture_no_missing",
        expected: "A PARC fixture number such as PARC25119001",
        rejected_field: "Fixture No",
        detected_value: fixture_no || "",
        missing_fields: [toFieldLabel("fixture_no")],
      }));
      continue;
    }

    if (!FIXTURE_NO_REGEX.test(normalizedFixtureNo)) {
      rejectedRows.push(buildRejectedRow(rowMeta, "Fixture No must match the PARC fixture format.", raw_data, diagnostics, {
        reason: "fixture_no_invalid",
        expected: "A PARC fixture number such as PARC25119001",
        rejected_field: "Fixture No",
        detected_value: fixture_no || "",
      }));
      continue;
    }

    if (!opNoInfo.normalized) {
      const missingFields = opNoInfo.raw ? [] : [toFieldLabel("op_no")];
      rejectedRows.push(buildRejectedRow(rowMeta, opNoInfo.raw ? "Invalid OP.NO format." : "OP.NO is mandatory for import.", raw_data, diagnostics, {
        reason: opNoInfo.raw ? "op_no_invalid" : "op_no_missing",
        expected: "OP format such as OP 10 or OP 10A",
        rejected_field: "OP.NO",
        detected_value: op_no || "",
        missing_fields: missingFields,
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
          rejected_field: missing[0] || "Required Field",
          detected_value: "",
          expected: "All required fields must be present: Fixture No, Part Name, Fixture Type, QTY",
        },
      ));
      continue;
    }

    if (isStandaloneVendorFixtureTypeLabel(normalizedFixtureType)) {
      rejectedRows.push(buildRejectedRow(
        rowMeta,
        "Fixture Type cannot be a bare vendor/outsourced label. Add the concrete fixture or process description.",
        raw_data,
        diagnostics,
        {
          reason: "vendor_fixture_type_vague",
          rejected_field: "Fixture Type",
          missing_fields: [],
          problem_fields: buildProblemFields("vendor_fixture_type_vague", [], "Fixture Type"),
        },
      ));
      continue;
    }

    if (qtyInfo.normalized === null) {
      rejectedRows.push(buildRejectedRow(rowMeta, "QTY must be a valid numeric value.", raw_data, diagnostics, {
        reason: "qty_invalid",
        expected: "A positive number such as 1, 2, or 2.0",
        rejected_field: "QTY",
        detected_value: qtyRaw || "",
      }));
      continue;
    }

    const qty = qtyInfo.normalized;
    const fixtureNoKey = canonicalFixtureNo(normalizedFixtureNo).toLowerCase();
    if (seenFixtureNumbers.has(fixtureNoKey)) {
      rejectedRows.push(buildRejectedRow(rowMeta, "Duplicate fixture number found in uploaded file.", raw_data, diagnostics, {
        reason: "duplicate_fixture_no",
        rejected_field: "Fixture No",
        detected_value: normalizedFixtureNo,
        expected: "Fixture No must be unique within the uploaded file",
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
      op_no: opNoInfo.normalized,
      part_name: normalizedPartName,
      fixture_type: normalizedFixtureType,
      qty,
      image_1_url,
      image_2_url,
      parser_confidence,
      raw_data,
    });
  }

  return { validRows, rejectedRows, skippedRows };
}

module.exports = {
  validateParsedData
};
