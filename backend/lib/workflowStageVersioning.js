function normalizeStageVersion(value) {
  const version = Number(value);
  return Number.isInteger(version) && version > 0 ? version : 0;
}

function formatStageVersionLabel(stageName, stageVersion = 0) {
  const baseName = String(stageName || "").trim();
  const version = normalizeStageVersion(stageVersion);

  if (!baseName || version === 0) {
    return baseName;
  }

  return `${baseName}${String(version).padStart(2, "0")}`;
}

function getStageVersionFromCompletedCount(completedCount) {
  const count = Number(completedCount);
  return Number.isInteger(count) && count > 0 ? count : 0;
}

module.exports = {
  formatStageVersionLabel,
  getStageVersionFromCompletedCount,
  normalizeStageVersion,
};
