const DESIGN_STAGE_REVISION_PREFIXES: Record<string, string> = {
  concept: "CON",
  dap: "DAP",
  "3d_finish": "3D",
  "2d_finish": "2D",
  detailing: "DET",
  release: "REL",
};

function normalizeStageKey(stageName: string | null | undefined) {
  const sanitized = String(stageName || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (["concept", "concept_stage"].includes(sanitized)) return "concept";
  if (["dap", "d_a_p"].includes(sanitized)) return "dap";
  if (["3d", "3d_finish", "three_d", "three_d_finish"].includes(sanitized)) return "3d_finish";
  if (["2d", "2d_finish", "two_d", "two_d_finish"].includes(sanitized)) return "2d_finish";
  if (["detailing", "detail", "det"].includes(sanitized)) return "detailing";
  if (["release", "released"].includes(sanitized)) return "release";
  return null;
}

export function formatDesignRevisionCode(stageName: string | null | undefined, stageVersion = 0) {
  const stageKey = normalizeStageKey(stageName);
  const prefix = (stageKey && DESIGN_STAGE_REVISION_PREFIXES[stageKey])
    || String(stageName || "").replace(/[^a-z0-9]/gi, "").slice(0, 3).toUpperCase()
    || "REV";
  const version = Math.max(0, Math.floor(Number(stageVersion) || 0));
  return `${prefix} ${String(version).padStart(2, "0")}`;
}

export function formatDesignRevisionReasonLabel(reasonType: string | null | undefined) {
  switch (String(reasonType || "").trim().toUpperCase()) {
    case "CUSTOMER_CHANGE":
      return "Customer Change";
    case "INTERNAL_DESIGN_CHANGE":
      return "Internal Design Change";
    case "MANUFACTURING_ISSUE":
      return "Manufacturing Issue";
    case "QUALITY_CORRECTION":
      return "Quality Correction";
    case "COST_OPTIMIZATION":
      return "Cost Optimization";
    case "APPROVAL_REJECTION":
      return "Approval Rejection";
    case "PROCUREMENT_CONSTRAINT":
      return "Procurement Constraint";
    case "MANUAL_OVERRIDE":
      return "Manual Override";
    default:
      return reasonType || "Other";
  }
}
