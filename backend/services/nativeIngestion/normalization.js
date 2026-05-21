const FIXTURE_NO_PATTERN = /^PARC\d{3,}$/i;

function collapseWhitespace(value) {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value)
    .replace(/\r\n/g, "\n")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeFixtureNo(value) {
  return collapseWhitespace(value)
    .replace(/\s+/g, "")
    .replace(/_+$/g, "")
    .replace(/^[-_]+|[-_]+$/g, "")
    .toUpperCase();
}

function normalizeComparable(value) {
  return collapseWhitespace(value).toLowerCase();
}

function normalizeFixtureType(value) {
  return collapseWhitespace(value);
}

function normalizePartName(value) {
  return collapseWhitespace(value);
}

function normalizeRemark(value) {
  const normalized = collapseWhitespace(value);
  return normalized || null;
}

function normalizeVendor(value) {
  const normalized = collapseWhitespace(value);
  return normalized || null;
}

function normalizeImageUrl(value) {
  const normalized = collapseWhitespace(value);
  return normalized || null;
}

function normalizeBoolean(value) {
  if (typeof value === "boolean") {
    return value;
  }

  const text = collapseWhitespace(value).toLowerCase();
  if (!text) {
    return false;
  }

  return ["1", "true", "yes", "y", "x", "checked", "outsourced"].includes(text);
}

function normalizeQty(value) {
  const text = collapseWhitespace(value);
  if (!text) {
    return { raw: "", value: null };
  }

  if (/^\d+$/.test(text)) {
    const parsed = Number.parseInt(text, 10);
    return { raw: text, value: parsed > 0 ? parsed : null };
  }

  if (/^\d+\.0+$/.test(text)) {
    const parsed = Number.parseInt(text.split(".", 1)[0], 10);
    return { raw: text, value: parsed > 0 ? parsed : null };
  }

  return { raw: text, value: null };
}

function parseRevisionNumber(value) {
  const text = collapseWhitespace(value);
  if (!text) {
    return null;
  }

  const match = text.match(/\d+/);
  if (!match) {
    return null;
  }

  const parsed = Number.parseInt(match[0], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeNativeContext(context = {}, user = {}) {
  const projectNo = normalizeFixtureNo(context.project_no || context.projectNo || context.project_code);
  const customer = collapseWhitespace(context.customer || context.customer_name || context.company_name);
  const departmentId = collapseWhitespace(context.department_id || user.department_id);
  const departmentName = collapseWhitespace(context.department_name || user.department?.name || departmentId);

  return {
    project_no: projectNo,
    customer,
    department_id: departmentId,
    department_name: departmentName,
    vendor: collapseWhitespace(context.vendor),
    operational_batch: collapseWhitespace(context.operational_batch),
    revision: collapseWhitespace(context.revision),
    revision_no: parseRevisionNumber(context.revision),
    upload_source: collapseWhitespace(context.upload_source) || "native_workspace",
  };
}

function makeNativeRowId(index) {
  return `native-row-${index + 1}`;
}

function isEmptyNativeRow(row = {}) {
  return [
    row.fixture_no,
    row.part_name,
    row.fixture_type,
    row.remark,
    row.qty,
    row.vendor_name,
    row.vendor,
    row.image_1_url,
    row.image_2_url,
  ].every((value) => !collapseWhitespace(value)) && normalizeBoolean(row.is_outsourced ?? row.outsourced) === false;
}

function normalizeNativeRow(row = {}, index = 0) {
  const qty = normalizeQty(row.qty);
  const isOutsourced = normalizeBoolean(row.is_outsourced ?? row.outsourced);
  const vendor = normalizeVendor(row.vendor_name ?? row.vendor);
  const fixtureNo = normalizeFixtureNo(row.fixture_no);

  return {
    row_id: collapseWhitespace(row.row_id || row.id) || makeNativeRowId(index),
    row_number: Number.isFinite(Number(row.row_number)) ? Number(row.row_number) : index + 1,
    fixture_no: fixtureNo,
    part_name: normalizePartName(row.part_name),
    fixture_type: normalizeFixtureType(row.fixture_type),
    remark: normalizeRemark(row.remark),
    qty: qty.value,
    qty_raw: qty.raw,
    is_outsourced: isOutsourced,
    vendor_name: isOutsourced ? vendor : vendor,
    image_1_url: normalizeImageUrl(row.image_1_url),
    image_2_url: normalizeImageUrl(row.image_2_url),
    image_storage: row.image_storage && typeof row.image_storage === "object" ? row.image_storage : {},
    raw: {
      ...row,
      fixture_no: collapseWhitespace(row.fixture_no),
      part_name: collapseWhitespace(row.part_name),
      fixture_type: collapseWhitespace(row.fixture_type),
      remark: collapseWhitespace(row.remark),
      qty: collapseWhitespace(row.qty),
      vendor_name: collapseWhitespace(row.vendor_name ?? row.vendor),
      image_1_url: collapseWhitespace(row.image_1_url),
      image_2_url: collapseWhitespace(row.image_2_url),
    },
  };
}

module.exports = {
  FIXTURE_NO_PATTERN,
  collapseWhitespace,
  isEmptyNativeRow,
  normalizeBoolean,
  normalizeComparable,
  normalizeFixtureNo,
  normalizeFixtureType,
  normalizeImageUrl,
  normalizeNativeContext,
  normalizeNativeRow,
  normalizePartName,
  normalizeQty,
  normalizeRemark,
  normalizeVendor,
  parseRevisionNumber,
};
