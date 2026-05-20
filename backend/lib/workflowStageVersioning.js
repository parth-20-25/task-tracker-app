const { getDesignStageRevisionPrefix } = require("./designRevisionPrefixes");

function normalizeStageVersion(value) {
  const version = Number(value);
  return Number.isInteger(version) && version >= 0 ? version : 0;
}

function formatStageRevisionCode(stageName, stageVersion = 0) {
  const prefix = getDesignStageRevisionPrefix(stageName);
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

/**
 * Parses common revision inputs (CON2, con-02, CON 02) into canonical "CON 02".
 */
function normalizeRevisionCodeInput(value, stageName = null) {
  const raw = String(value || "").trim();
  if (!raw) {
    return null;
  }

  const match = raw.match(/^([A-Za-z0-9]{2,4})\s*[-_]?\s*(\d{1,2})$/);
  if (match) {
    const prefix = match[1].toUpperCase();
    const version = String(Number(match[2])).padStart(2, "0");
    return `${prefix} ${version}`;
  }

  if (stageName) {
    const versionMatch = raw.match(/(\d{1,2})\s*$/);
    if (versionMatch) {
      return formatStageRevisionCode(stageName, Number(versionMatch[1]));
    }
  }

  return raw.replace(/\s+/g, " ").toUpperCase();
}

module.exports = {
  formatStageVersionLabel,
  formatStageRevisionCode,
  getStageVersionFromCompletedCount,
  normalizeStageVersion,
  normalizeRevisionCodeInput,
};
