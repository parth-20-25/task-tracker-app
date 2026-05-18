function normalizeStageVersion(value) {
  const version = Number(value);
  return Number.isInteger(version) && version > 0 ? version : 0;
}

function normalizeStageName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function getStageRevisionPrefix(stageName) {
  const normalized = normalizeStageName(stageName);

  if (["concept", "concept_stage"].includes(normalized)) {
    return "CON";
  }

  if (["dap", "d_a_p"].includes(normalized)) {
    return "DAP";
  }

  if (["3d", "3d_finish", "three_d", "three_d_finish"].includes(normalized)) {
    return "3D";
  }

  if (["2d", "2d_finish", "two_d", "two_d_finish", "detailing", "detail"].includes(normalized)) {
    return "DET";
  }

  const fallback = String(stageName || "")
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 3)
    .toUpperCase();

  return fallback || "REV";
}

function formatStageRevisionCode(stageName, stageVersion = 0) {
  const prefix = getStageRevisionPrefix(stageName);
  const version = String(normalizeStageVersion(stageVersion)).padStart(2, "0");
  return `${prefix} ${version}`;
}

function formatStageVersionLabel(stageName, stageVersion = 0) {
  return String(stageName || "").trim();
}

function getStageVersionFromCompletedCount(completedCount) {
  const count = Number(completedCount);
  return Number.isInteger(count) && count > 0 ? count : 0;
}

module.exports = {
  formatStageVersionLabel,
  formatStageRevisionCode,
  getStageRevisionPrefix,
  getStageVersionFromCompletedCount,
  normalizeStageVersion,
};
