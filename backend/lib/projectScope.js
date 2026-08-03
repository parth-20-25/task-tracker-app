const DEFAULT_WORKING_HOURS_PER_DAY = 8;
const { normalizeDesignStageName } = require("./designWorkflowStages");

const PLANNING_STAGES = Object.freeze([
  "CONCEPT",
  "DAP",
  "THREE_D_FINISH",
  "TWO_D_FINISH",
]);

const SCOPE_CATEGORIES = Object.freeze([
  "ROBOTIC_WELDING_FIXTURE",
  "MANUAL_WELDING_FIXTURE",
  "SPM",
  "INSPECTION_FIXTURE",
  "HAND_GAUGE",
  "ROBOTIC_CELL_SHUTTLE",
  "SERVO_PNEUMATIC_GANTRY",
]);

const CATEGORY_RESPONSE_KEYS = Object.freeze({
  ROBOTIC_WELDING_FIXTURE: "robotic_welding_fix",
  MANUAL_WELDING_FIXTURE: "manual_welding_fix",
  SPM: "spms",
  INSPECTION_FIXTURE: "manual_auto_inspection",
  HAND_GAUGE: "hand_gauge",
  ROBOTIC_CELL_SHUTTLE: "robotic_cell_shuttle",
  SERVO_PNEUMATIC_GANTRY: "servo_pumatic_gantry",
});

function fixtureText(fixture = {}) {
  return [fixture.fixture_name, fixture.fixture_description, fixture.fixture_type, fixture.part_name, fixture.remark]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function classifyProjectScopeFixture(fixture) {
  const text = fixtureText(fixture);
  if (!text) return null;

  const rules = [
    ["ROBOTIC_CELL_SHUTTLE", /\b(?:robotic|welding)\s+cell\b|\bshuttle\b/],
    ["SERVO_PNEUMATIC_GANTRY", /\b(?:servo|pneumatic|pumatic)\b.*\bgantry\b|\bgantry\b.*\b(?:servo|pneumatic|pumatic)\b/],
    ["INSPECTION_FIXTURE", /\b(?:manual|auto|automatic)\s+inspection\b|\binspection(?:\s+fixture)?\b/],
    ["HAND_GAUGE", /\bhand\s+gauge\b|\b(?:gauge|gage)\b/],
    ["MANUAL_WELDING_FIXTURE", /\bmanual\b.*\bweld(?:ing)?\b.*\bfixture\b|\bmanual\s+weld(?:ing)?\s+fixture\b/],
    ["ROBOTIC_WELDING_FIXTURE", /\brobotic\b.*\bweld(?:ing)?\b.*\bfixture\b|\brobotic\s+weld(?:ing)?\s+fixture\b/],
    ["SPM", /\bspms?\b|\bspecial\s+purpose\s+machines?\b/],
  ];

  return rules.find(([, pattern]) => pattern.test(text))?.[0] || null;
}

function normalizeQuantity(value) {
  const quantity = Number(value);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
}

function buildScopeRows(rows, plannedTimeByProject = new Map(), workingHoursPerDay = DEFAULT_WORKING_HOURS_PER_DAY) {
  const projects = new Map();

  for (const row of rows) {
    let project = projects.get(row.project_id);
    if (!project) {
      project = {
        project_id: row.project_id,
        priority: row.priority || null,
        project_no: row.project_no,
        project_description: row.project_description || row.project_name || "",
        robotic_welding_fix: 0,
        manual_welding_fix: 0,
        spms: 0,
        manual_auto_inspection: 0,
        hand_gauge: 0,
        robotic_cell_shuttle: 0,
        servo_pumatic_gantry: 0,
        unclassified_fixture_count: 0,
        fixtures: new Map(),
      };
      projects.set(row.project_id, project);
    }

    if (!row.fixture_id || row.is_deleted === true || row.is_active === false || String(row.fixture_status || row.status || "").trim().toLowerCase() === "cancelled") continue;
    if (!project.fixtures.has(row.fixture_id)) {
      project.fixtures.set(row.fixture_id, {
        fixture_no: row.fixture_no || "—",
        fixture_name: row.fixture_description || row.fixture_name || "—",
        stage_progress: Array.isArray(row.stage_progress) ? row.stage_progress : [],
      });
    }
    const category = classifyProjectScopeFixture(row);
    if (!category) {
      project.unclassified_fixture_count += 1;
      continue;
    }
    project[CATEGORY_RESPONSE_KEYS[category]] += normalizeQuantity(row.quantity ?? row.qty);
  }

  return [...projects.values()].map((project, index) => {
    const planned = plannedTimeByProject.get(project.project_id) || {};
    const concept = planned.CONCEPT ?? null;
    const dap = planned.DAP ?? null;
    const threeD = planned.THREE_D_FINISH ?? null;
    const twoD = planned.TWO_D_FINISH ?? null;
    const totalScope = SCOPE_CATEGORIES.reduce((sum, category) => sum + project[CATEGORY_RESPONSE_KEYS[category]], 0);
    const totalHours = [concept, dap, threeD, twoD].reduce((sum, value) => sum + Number(value || 0), 0);
    const stage_details = Object.fromEntries([
      ["concept", "CONCEPT"],
      ["dap", "DAP"],
      ["3d_finish", "3D Finish"],
      ["2d_finish", "2D Finish"],
    ].map(([key, label]) => {
      const fixtures = [...project.fixtures.values()];
      const pending = [];
      const in_progress = [];
      for (const fixture of fixtures) {
        const progress = fixture.stage_progress.find((item) => normalizeDesignStageName(item?.stage_name) === key);
        if (String(progress?.status || "").toUpperCase() === "APPROVED") continue;
        const item = {
          fixture_no: fixture.fixture_no,
          fixture_name: fixture.fixture_name,
          assignee: progress?.assignee_name || progress?.assigned_to || "Unassigned",
        };
        if (["IN_PROGRESS", "SUBMITTED_FOR_VERIFICATION"].includes(String(progress?.status || "").toUpperCase())) in_progress.push(item);
        else pending.push(item);
      }
      return [key, {
        label,
        complete: fixtures.length > 0 && pending.length === 0 && in_progress.length === 0,
        pending,
        in_progress,
      }];
    }));

    const { fixtures, ...scopeProject } = project;
    return {
      ...scopeProject,
      sr_no: index + 1,
      total_scope: totalScope,
      concept_hours: concept,
      dap_hours: dap,
      three_d_finish_hours: threeD,
      two_d_finish_hours: twoD,
      total_hours: totalHours,
      days: totalHours / workingHoursPerDay,
      stage_details,
    };
  });
}

function normalizePlannedTimeValue(value, unit, workingHoursPerDay) {
  if (value === null || value === undefined || value === "") {
    return { enteredValue: null, normalizedHours: null };
  }

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    throw new TypeError("Planned time must be a finite non-negative number or blank");
  }

  return {
    enteredValue: numericValue,
    normalizedHours: unit === "DAYS" ? numericValue * workingHoursPerDay : numericValue,
  };
}

function hasMissingEditablePlanningStage(stages, editableStages) {
  return editableStages.some((stage) => stages?.[stage]?.normalized_hours === null || stages?.[stage]?.normalized_hours === undefined);
}
function normalizeRoleKey(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function isScopeExecutiveRole(user) {
  const roleName = normalizeRoleKey(user?.role?.name);
  const roleId = normalizeRoleKey(user?.role?.id || user?.role_id || user?.role);
  return [roleName, roleId].some((role) => ["ceo", "director", "director_ceo", "ceo_director"].includes(role));
}

function isPlanningLeaderRole(user) {
  const roleName = normalizeRoleKey(user?.role?.name);
  const roleId = normalizeRoleKey(user?.role?.id || user?.role_id || user?.role);
  return [roleName, roleId].some((role) => ["team_leader", "line_manager", "co_leader", "team_co_leader", "shift_incharge"].includes(role));
}

function getPlanningTeam(user) {
  const team = String(user?.subdivision?.subdivision_name || "").trim().toUpperCase();
  return team === "2D" || team === "3D" ? team : null;
}

function editableStagesForTeam(team) {
  return team === "3D" ? [...PLANNING_STAGES] : team === "2D" ? ["TWO_D_FINISH"] : [];
}

module.exports = {
  CATEGORY_RESPONSE_KEYS,
  DEFAULT_WORKING_HOURS_PER_DAY,
  PLANNING_STAGES,
  SCOPE_CATEGORIES,
  buildScopeRows,
  classifyProjectScopeFixture,
  editableStagesForTeam,
  getPlanningTeam,
  hasMissingEditablePlanningStage,
  isPlanningLeaderRole,
  isScopeExecutiveRole,
  normalizePlannedTimeValue,
  normalizeQuantity,
  normalizeRoleKey,
};