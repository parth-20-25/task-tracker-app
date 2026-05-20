const DESIGN_REVISION_REASON_TYPES = Object.freeze([
  "CUSTOMER_CHANGE",
  "INTERNAL_DESIGN_CHANGE",
  "MANUFACTURING_ISSUE",
  "QUALITY_CORRECTION",
  "COST_OPTIMIZATION",
  "APPROVAL_REJECTION",
  "PROCUREMENT_CONSTRAINT",
  "MANUAL_OVERRIDE",
  "OTHER",
]);

const DESIGN_REVISION_REASON_LABELS = Object.freeze({
  CUSTOMER_CHANGE: "Customer Change",
  INTERNAL_DESIGN_CHANGE: "Internal Design Change",
  MANUFACTURING_ISSUE: "Manufacturing Issue",
  QUALITY_CORRECTION: "Quality Correction",
  COST_OPTIMIZATION: "Cost Optimization",
  APPROVAL_REJECTION: "Approval Rejection",
  PROCUREMENT_CONSTRAINT: "Procurement Constraint",
  MANUAL_OVERRIDE: "Manual Override",
  OTHER: "Other",
});

function normalizeDesignRevisionReasonType(value, { required = true } = {}) {
  const normalized = String(value || "").trim().toUpperCase();
  if (!normalized) {
    if (required) {
      return { ok: false, error: "reason_type is required for Design stage rework" };
    }
    return { ok: true, value: null };
  }

  if (!DESIGN_REVISION_REASON_TYPES.includes(normalized)) {
    return { ok: false, error: `Unsupported reason_type "${value}"` };
  }

  return { ok: true, value: normalized };
}

function getDesignRevisionReasonLabel(reasonType) {
  const normalized = String(reasonType || "").trim().toUpperCase();
  return DESIGN_REVISION_REASON_LABELS[normalized] || normalized || null;
}

module.exports = {
  DESIGN_REVISION_REASON_TYPES,
  DESIGN_REVISION_REASON_LABELS,
  normalizeDesignRevisionReasonType,
  getDesignRevisionReasonLabel,
};
