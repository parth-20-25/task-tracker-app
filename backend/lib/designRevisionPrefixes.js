const { normalizeDesignStageName } = require("./designWorkflowStages");

/**
 * Canonical Design stage → revision prefix mapping.
 * Single source of truth — do not duplicate prefixes elsewhere.
 */
const DESIGN_STAGE_REVISION_PREFIXES = Object.freeze({
  concept: "CON",
  dap: "DAP",
  "3d_finish": "3D",
  "2d_finish": "2D",
  detailing: "DET",
  release: "REL",
});

function getDesignStageRevisionPrefix(stageName) {
  const stageKey = normalizeDesignStageName(stageName);
  if (stageKey && DESIGN_STAGE_REVISION_PREFIXES[stageKey]) {
    return DESIGN_STAGE_REVISION_PREFIXES[stageKey];
  }

  const normalized = String(stageName || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (["detailing", "detail", "det"].includes(normalized)) {
    return "DET";
  }

  const fallback = String(stageName || "")
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 3)
    .toUpperCase();

  return fallback || "REV";
}

module.exports = {
  DESIGN_STAGE_REVISION_PREFIXES,
  getDesignStageRevisionPrefix,
};
