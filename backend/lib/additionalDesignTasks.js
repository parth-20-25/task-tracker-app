const DESIGN_3D_ADDITIONAL_DAP_POINTS = "DESIGN_3D_ADDITIONAL_DAP_POINTS";

const ADDITIONAL_DESIGN_2D_TASK_KINDS = Object.freeze([
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

const ADDITIONAL_DESIGN_3D_TASK_KINDS = Object.freeze([
  DESIGN_3D_ADDITIONAL_DAP_POINTS,
  "Project Process",
  "Pin Matrix",
  "PPT",
  "CBO",
  "Line Layout",
  "CDRM",
  "Print",
  "Drafting Checking",
]);

const ADDITIONAL_DESIGN_TASK_CATALOG = Object.freeze({
  "2D": ADDITIONAL_DESIGN_2D_TASK_KINDS,
  "3D": ADDITIONAL_DESIGN_3D_TASK_KINDS,
});

const ADDITIONAL_DESIGN_TASK_KINDS = Object.freeze([
  ...new Set([...ADDITIONAL_DESIGN_2D_TASK_KINDS, ...ADDITIONAL_DESIGN_3D_TASK_KINDS]),
]);

const ADDITIONAL_DESIGN_TEAMS = Object.freeze(["2D", "3D"]);

function normalizeAdditionalDesignTaskKind(value, team = null) {
  const normalized = String(value || "").trim().toLowerCase();
  const canonicalValue = normalized === "dap points" ? DESIGN_3D_ADDITIONAL_DAP_POINTS.toLowerCase() : normalized;
  const catalog = team ? ADDITIONAL_DESIGN_TASK_CATALOG[normalizeAdditionalDesignTeam(team)] || [] : ADDITIONAL_DESIGN_TASK_KINDS;
  return catalog.find((kind) => kind.toLowerCase() === canonicalValue) || null;
}

function getAdditionalDesignTaskLabel(kind) {
  return kind === DESIGN_3D_ADDITIONAL_DAP_POINTS ? "DAP Points" : kind;
}
function normalizeAdditionalDesignTeam(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return ADDITIONAL_DESIGN_TEAMS.includes(normalized) ? normalized : null;
}

function resolveAdditionalDesignTeamForUser(user) {
  if (String(user?.department?.name || user?.department_id || "").trim().toLowerCase() !== "design") {
    return null;
  }

  return normalizeAdditionalDesignTeam(user?.subdivision?.subdivision_name || user?.subdivision_id);
}

function getAdditionalDesignTaskKindsForTeam(team) {
  return [...(ADDITIONAL_DESIGN_TASK_CATALOG[normalizeAdditionalDesignTeam(team)] || [])];
}

function userBelongsToAdditionalDesignTeam(user, team) {
  const normalizedTeam = normalizeAdditionalDesignTeam(team);
  const subdivisionName = String(user?.subdivision?.subdivision_name || "").trim().toUpperCase();
  return Boolean(
    normalizedTeam
    && user?.is_active !== false
    && String(user?.department?.name || user?.department_id || "").trim().toLowerCase() === "design"
    && subdivisionName === normalizedTeam,
  );
}

module.exports = {
  ADDITIONAL_DESIGN_2D_TASK_KINDS,
  ADDITIONAL_DESIGN_3D_TASK_KINDS,
  ADDITIONAL_DESIGN_TASK_CATALOG,
  ADDITIONAL_DESIGN_TASK_KINDS,
  ADDITIONAL_DESIGN_TEAMS,
  DESIGN_3D_ADDITIONAL_DAP_POINTS,
  getAdditionalDesignTaskKindsForTeam,
  getAdditionalDesignTaskLabel,
  normalizeAdditionalDesignTaskKind,
  normalizeAdditionalDesignTeam,
  resolveAdditionalDesignTeamForUser,
  userBelongsToAdditionalDesignTeam,
};
