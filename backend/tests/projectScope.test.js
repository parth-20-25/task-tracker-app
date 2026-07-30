const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://user:pass@localhost:5432/tasktracker_test";
const { PERMISSIONS } = require("../config/constants");
const {
  buildScopeRows,
  classifyProjectScopeFixture,
  editableStagesForTeam,
  hasMissingEditablePlanningStage,
  normalizePlannedTimeValue,
} = require("../lib/projectScope");
const { assertPlanningIdentity, assertProjectScopeAccess } = require("../services/projectScopeService");

function user(role, permissions = []) {
  return { employee_id: `${role}-1`, permissions, role: { id: role, name: role, permissions: {} } };
}

for (const role of ["CEO", "Director"]) {
  test(`${role} can access Project Scope with the explicit permission`, () => {
    assert.doesNotThrow(() => assertProjectScopeAccess(user(role, [PERMISSIONS.VIEW_PROJECT_SCOPE])));
  });
}

test("Admin can access the Project Scope API without missing role permission configuration", () => {
  assert.doesNotThrow(() => assertProjectScopeAccess(user("Admin")));
});

test("CEO without the explicit permission cannot access Project Scope", () => {
  assert.throws(() => assertProjectScopeAccess(user("CEO")), (error) => error.statusCode === 403 || error.status === 403);
});

for (const role of ["Team Leader", "Co-Leader", "Employee"]) {
  test(`${role} cannot access Project Scope`, () => {
    assert.throws(() => assertProjectScopeAccess(user(role, [PERMISSIONS.VIEW_PROJECT_SCOPE])), (error) => error.statusCode === 403 || error.status === 403);
  });
}

test("scope classification is deterministic, quantity based, and excludes inactive fixture rows", () => {
  const project = { project_id: "project-1", project_no: "25-119", project_name: "Fixture Project" };
  const rows = [
    { ...project, fixture_id: "1", fixture_type: "Front Frame Robotic Welding Fixture", qty: 4 },
    { ...project, fixture_id: "2", part_name: "Manual welding fixture", quantity: 2 },
    { ...project, fixture_id: "3", fixture_type: "Welding Cell Shuttle", qty: 3 },
    { ...project, fixture_id: "4", fixture_type: "Pumatic Gantry", qty: 5 },
    { ...project, fixture_id: "5", fixture_type: "Auto Inspection Fixture", qty: 6 },
    { ...project, fixture_id: "6", fixture_type: "Hand Gauge", qty: 7 },
    { ...project, fixture_id: "7", fixture_type: "SPMS", qty: 8 },
    { ...project, fixture_id: "8", fixture_type: "Robotic Welding Fixture", qty: 99, status: "cancelled" },
    { ...project, fixture_id: "9", fixture_type: "Robotic Welding Fixture", qty: 99, is_deleted: true },
    { ...project, fixture_id: "10", fixture_type: "Unknown Device", qty: 12 },
  ];
  const [result] = buildScopeRows(rows);
  assert.equal(result.robotic_welding_fix, 4);
  assert.equal(result.manual_welding_fix, 2);
  assert.equal(result.robotic_cell_shuttle, 3);
  assert.equal(result.servo_pumatic_gantry, 5);
  assert.equal(result.manual_auto_inspection, 6);
  assert.equal(result.hand_gauge, 7);
  assert.equal(result.spms, 8);
  assert.equal(result.total_scope, 35);
  assert.equal(result.unclassified_fixture_count, 1);
  assert.equal(classifyProjectScopeFixture({ fixture_type: "Welding Cell Robotic Welding Fixture" }), "ROBOTIC_CELL_SHUTTLE");
  assert.equal(classifyProjectScopeFixture({ fixture_type: "Unknown Device" }), null);
});

test("common fixture spelling variations classify once", () => {
  const cases = [
    ["Pneumatic Gantry", "SERVO_PNEUMATIC_GANTRY"],
    ["Pumatic Gantry", "SERVO_PNEUMATIC_GANTRY"],
    ["Manual Inspection", "INSPECTION_FIXTURE"],
    ["Gauge", "HAND_GAUGE"],
    ["Robotic Cell", "ROBOTIC_CELL_SHUTTLE"],
    ["Manual Welding Fixture", "MANUAL_WELDING_FIXTURE"],
    ["Robotic Welding Fixture", "ROBOTIC_WELDING_FIXTURE"],
    ["SPM", "SPM"],
  ];
  for (const [fixture_type, expected] of cases) assert.equal(classifyProjectScopeFixture({ fixture_type }), expected);
});

test("fixture quantity changes immediately change Project Scope totals", () => {
  const base = { project_id: "p", project_no: "P", project_name: "Project", fixture_id: "f", fixture_type: "SPM" };
  assert.equal(buildScopeRows([{ ...base, qty: 1 }])[0].total_scope, 1);
  assert.equal(buildScopeRows([{ ...base, qty: 9 }])[0].total_scope, 9);
});

test("planned-time backend identity rejects unauthorized updates", () => {
  const planner = (role, team, permissions = [PERMISSIONS.EDIT_PROJECT_PLANNED_TIME]) => ({
    ...user(role, permissions),
    subdivision: { subdivision_name: team },
  });
  assert.equal(assertPlanningIdentity(planner("Team Leader", "3D")), "3D");
  assert.equal(assertPlanningIdentity(planner("Co-Leader", "2D")), "2D");
  assert.throws(() => assertPlanningIdentity(planner("Employee", "3D")), (error) => error.statusCode === 403 || error.status === 403);
  assert.throws(() => assertPlanningIdentity(planner("Team Leader", "3D", [])), (error) => error.statusCode === 403 || error.status === 403);
});

test("planned time permissions and hour normalization follow subdivision scope", () => {
  assert.deepEqual(editableStagesForTeam("3D"), ["CONCEPT", "DAP", "THREE_D_FINISH", "TWO_D_FINISH"]);
  assert.deepEqual(editableStagesForTeam("2D"), ["TWO_D_FINISH"]);
  assert.deepEqual(normalizePlannedTimeValue(2.5, "HOURS", 8), { enteredValue: 2.5, normalizedHours: 2.5 });
  assert.deepEqual(normalizePlannedTimeValue(2.5, "DAYS", 8), { enteredValue: 2.5, normalizedHours: 20 });
  assert.deepEqual(normalizePlannedTimeValue(null, "HOURS", 8), { enteredValue: null, normalizedHours: null });
  for (const invalid of [-1, "bad", Number.NaN, Number.POSITIVE_INFINITY]) assert.throws(() => normalizePlannedTimeValue(invalid, "HOURS", 8));
});

test("planned totals tolerate blanks and use configured hours per day", () => {
  const planned = new Map([["p", { CONCEPT: 8, DAP: null, THREE_D_FINISH: 4, TWO_D_FINISH: 4 }]]);
  const [row] = buildScopeRows([{ project_id: "p", project_no: "P", project_name: "Project", fixture_id: null }], planned, 8);
  assert.equal(row.dap_hours, null);
  assert.equal(row.total_hours, 16);
  assert.equal(row.days, 2);
});

test("pending planning detects only missing editable stages", () => {
  const stages = {
    CONCEPT: { normalized_hours: null },
    DAP: { normalized_hours: 2 },
    THREE_D_FINISH: { normalized_hours: 3 },
    TWO_D_FINISH: { normalized_hours: 4 },
  };
  assert.equal(hasMissingEditablePlanningStage(stages, editableStagesForTeam("3D")), true);
  assert.equal(hasMissingEditablePlanningStage(stages, editableStagesForTeam("2D")), false);
  stages.CONCEPT.normalized_hours = 1;
  assert.equal(hasMissingEditablePlanningStage(stages, editableStagesForTeam("3D")), false);
});

test("planned-time schema is reversible and updates are optimistic", () => {
  const schema = fs.readFileSync(path.join(__dirname, "../repositories/projectPlanningSchemaRepository.js"), "utf8");
  const repository = fs.readFileSync(path.join(__dirname, "../repositories/projectScopeRepository.js"), "utf8");
  assert.match(schema, /async function dropProjectScopePlanningSchema/);
  assert.match(schema, /DROP TABLE IF EXISTS design\.project_planned_time/);
  assert.match(repository, /AND version = \$7/);
  assert.match(repository, /ON CONFLICT \(project_id, stage\) DO NOTHING/);
});