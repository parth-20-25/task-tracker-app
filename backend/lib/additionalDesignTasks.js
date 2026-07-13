const ADDITIONAL_DESIGN_TASK_KINDS = Object.freeze([
  "Drafting",
  "Print & Drafting Checking",
  "BOM Checking",
  "Drawing Correction",
  "AutoCAD PDF",
  "IGES Data",
  "CMM Data",
  "Line Layout",
  "Mimic Display",
  "Wear-Out Data",
]);

const ADDITIONAL_DESIGN_TEAMS = Object.freeze(["2D", "3D"]);

function normalizeAdditionalDesignTaskKind(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ADDITIONAL_DESIGN_TASK_KINDS.find((kind) => kind.toLowerCase() === normalized) || null;
}

function normalizeAdditionalDesignTeam(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return ADDITIONAL_DESIGN_TEAMS.includes(normalized) ? normalized : null;
}

function userBelongsToAdditionalDesignTeam(user, team) {
  const normalizedTeam = normalizeAdditionalDesignTeam(team);
  const subdivisionName = String(user?.subdivision?.subdivision_name || "").trim().toUpperCase();
  return Boolean(normalizedTeam && subdivisionName === normalizedTeam);
}

module.exports = {
  ADDITIONAL_DESIGN_TASK_KINDS,
  ADDITIONAL_DESIGN_TEAMS,
  normalizeAdditionalDesignTaskKind,
  normalizeAdditionalDesignTeam,
  userBelongsToAdditionalDesignTeam,
};
