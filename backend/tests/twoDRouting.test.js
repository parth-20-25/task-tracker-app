const assert = require("node:assert/strict");
const test = require("node:test");

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://user:pass@localhost:5432/tasktracker_test";

const { normalizeDesignStageName } = require("../lib/designWorkflowStages");
const {
  current2DWorkflowStageFixtureSql,
  twoDStageNameSql,
} = require("../repositories/projectSubdivisionRoutingRepository");
const { visibleFixturePredicate } = require("../repositories/projectVisibility");
const { buildTaskAccessPredicate } = require("../services/accessControlService");

function make2DUser(overrides = {}) {
  return {
    employee_id: "EMP2D1",
    department_id: "design",
    permissions: [],
    role: {
      id: "team_leader",
      name: "Team Leader",
      hierarchy_level: 4,
      permissions: {},
    },
    subdivision: {
      subdivision_name: "2D",
    },
    ...overrides,
  };
}

test("2D stage normalization accepts workflow display names and compact names", () => {
  assert.equal(normalizeDesignStageName("2D"), "2d_finish");
  assert.equal(normalizeDesignStageName("2d"), "2d_finish");
  assert.equal(normalizeDesignStageName("2D Finish"), "2d_finish");
  assert.equal(normalizeDesignStageName("two d finish"), "2d_finish");
});

test("2D routing SQL matches both 2D and 2D Finish stage spellings", () => {
  const stagePredicate = twoDStageNameSql("progress.stage_name");
  const currentStagePredicate = current2DWorkflowStageFixtureSql("fixture", "project");

  assert.match(stagePredicate, /'2d'/);
  assert.match(stagePredicate, /'2d_finish'/);
  assert.match(currentStagePredicate, /'2d_finish'/);
});

test("2D task access predicate uses current 2D Finish stage routing", () => {
  const params = [];
  const sql = buildTaskAccessPredicate(make2DUser(), params, {
    taskAlias: "task",
    projectAlias: "project",
    fixtureAlias: "fixture",
  });

  assert.deepEqual(params, ["EMP2D1", "design"]);
  assert.match(sql, /project_subdivision_assignments/);
  assert.match(sql, /'2d_finish'/);
  assert.match(sql, /task\.task_type = 'additional_design'/);
  assert.match(sql, /task\.department_id = \$2/);
});

test("2D assignees can see their additional tasks without fixture stage coupling", () => {
  const params = [];
  const sql = buildTaskAccessPredicate(make2DUser({
    role: { id: "r6", name: "Designer", hierarchy_level: 5, permissions: {} },
  }), params, {
    taskAlias: "task",
    projectAlias: "project",
    fixtureAlias: "fixture",
  });

  assert.deepEqual(params, ["EMP2D1"]);
  assert.match(sql, /task\.task_type = 'additional_design'/);
  assert.match(sql, /task\.design_team = '2D'/);
  assert.match(sql, /task\.assigned_to = \$1/);
});

test("fixture visibility predicate includes 2D Finish for subdivision-routed users", () => {
  const sql = visibleFixturePredicate("fixture", "project");

  assert.match(sql, /'2d_finish'/);
  assert.match(sql, /current_assignee_progress\.assigned_to = root\.employee_id/);
});
