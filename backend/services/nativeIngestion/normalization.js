const FIXTURE_NO_PATTERN = /^PARC\d{3,}$/i;
const UPLOAD_MODES = new Set(["full_project_update", "fixture_delta"]);
const { hasOrgWideVisibility } = require("../visibilityResolutionService");

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

function stripLegacyWbsPrefix(value) {
  return collapseWhitespace(value).replace(/^WBS\s*[-_]?\s*/i, "");
}

function normalizeFixtureNo(value) {
  return collapseWhitespace(value)
    .replace(/\s+/g, "")
    .replace(/_+$/g, "")
    .replace(/^[-_]+|[-_]+$/g, "")
    .toUpperCase();
}

function normalizeProjectCode(value) {
  return stripLegacyWbsPrefix(value)
    .replace(/\s+/g, "")
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

function splitOnLastProjectSeparator(value) {
  const spacedMatches = [...String(value || "").matchAll(/\s+[-_]\s+/g)];
  const spaced = spacedMatches[spacedMatches.length - 1];
  if (spaced?.index !== undefined) {
    return [
      value.slice(0, spaced.index),
      value.slice(spaced.index + spaced[0].length),
    ];
  }

  const spaceMatches = [...String(value || "").matchAll(/\s{2,}/g)];
  const multiSpace = spaceMatches[spaceMatches.length - 1];
  if (multiSpace?.index !== undefined) {
    return [
      value.slice(0, multiSpace.index),
      value.slice(multiSpace.index + multiSpace[0].length),
    ];
  }

  const index = Math.max(String(value).lastIndexOf("-"), String(value).lastIndexOf("_"));
  if (index > 0) {
    return [value.slice(0, index), value.slice(index + 1)];
  }

  return [value, ""];
}

function parseProjectIdentity(value) {
  const rawIdentity = String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\n+/g, " ")
    .replace(/^WBS\s*[-_]?\s*/i, "")
    .trim();
  if (!collapseWhitespace(rawIdentity)) {
    return { project_code: "", project_name: "", customer_name: "" };
  }

  const identity = collapseWhitespace(rawIdentity);
  const firstSplit = rawIdentity.match(/^([^\s\-_]+)(?:\s*[-_]\s*|\s{2,})(.+)$/);
  if (!firstSplit) {
    return {
      project_code: normalizeProjectCode(identity),
      project_name: "",
      customer_name: "",
    };
  }

  const [projectName, customerName] = splitOnLastProjectSeparator(firstSplit[2])
    .map(collapseWhitespace);

  return {
    project_code: normalizeProjectCode(firstSplit[1]),
    project_name: projectName,
    customer_name: customerName,
  };
}

function formatProjectIdentity(context) {
  return [
    normalizeProjectCode(context.project_code),
    context.project_name,
    context.customer_name,
  ].map(collapseWhitespace).filter(Boolean).join(" - ");
}

function normalizeUploadMode(value) {
  const normalized = collapseWhitespace(value).toLowerCase();
  return UPLOAD_MODES.has(normalized) ? normalized : "full_project_update";
}

function normalizeNativeContext(context = {}, user = {}) {
  const parsedIdentity = parseProjectIdentity(context.project_identity || context.projectIdentity || "");
  const projectId = collapseWhitespace(context.project_id || context.projectId);
  const projectCode = normalizeProjectCode(
    context.project_code
    || context.project_no
    || context.projectNo
    || parsedIdentity.project_code,
  );
  const projectName = collapseWhitespace(context.project_name || parsedIdentity.project_name);
  const customerName = collapseWhitespace(
    context.customer_name
    || context.customer
    || context.company_name
    || parsedIdentity.customer_name,
  );
  const departmentId = collapseWhitespace(context.department_id || (hasOrgWideVisibility(user) ? "" : user.department_id));
  const departmentName = collapseWhitespace(context.department_name || user.department?.name || departmentId);
  const normalized = {
    project_code: projectCode,
    project_name: projectName,
    customer_name: customerName,
  };

  return {
    project_id: projectId || null,
    project_identity: stripLegacyWbsPrefix(context.project_identity || context.projectIdentity) || formatProjectIdentity(normalized),
    project_code: projectCode,
    project_name: projectName,
    customer_name: customerName,
    department_id: departmentId,
    department_name: departmentName,
    upload_mode: normalizeUploadMode(context.upload_mode || context.uploadMode),
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
    row.reference_image_url,
    row.image_1_url,
  ].every((value) => !collapseWhitespace(value)) && normalizeBoolean(row.is_outsourced ?? row.outsourced) === false;
}

function normalizeNativeRow(row = {}, index = 0) {
  const qty = normalizeQty(row.qty);
  const isOutsourced = normalizeBoolean(row.is_outsourced ?? row.outsourced);
  const vendor = normalizeVendor(row.vendor_name ?? row.vendor);
  const fixtureNo = normalizeFixtureNo(row.fixture_no);
  const referenceImageUrl = normalizeImageUrl(row.reference_image_url ?? row.image_1_url);

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
    reference_image_url: referenceImageUrl,
    image_1_url: referenceImageUrl,
    image_2_url: null,
    image_storage: row.image_storage && typeof row.image_storage === "object" ? row.image_storage : {},
    raw: {
      ...row,
      fixture_no: collapseWhitespace(row.fixture_no),
      part_name: collapseWhitespace(row.part_name),
      fixture_type: collapseWhitespace(row.fixture_type),
      remark: collapseWhitespace(row.remark),
      qty: collapseWhitespace(row.qty),
      vendor_name: collapseWhitespace(row.vendor_name ?? row.vendor),
      reference_image_url: collapseWhitespace(row.reference_image_url ?? row.image_1_url),
    },
  };
}

module.exports = {
  FIXTURE_NO_PATTERN,
  collapseWhitespace,
  formatProjectIdentity,
  isEmptyNativeRow,
  normalizeBoolean,
  normalizeComparable,
  normalizeFixtureNo,
  normalizeFixtureType,
  normalizeImageUrl,
  normalizeNativeContext,
  normalizeNativeRow,
  normalizePartName,
  normalizeProjectCode,
  normalizeQty,
  normalizeRemark,
  normalizeUploadMode,
  normalizeVendor,
  parseProjectIdentity,
};
