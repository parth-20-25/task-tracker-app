const assert = require("node:assert/strict");
const test = require("node:test");

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://user:pass@localhost:5432/tasktracker_test";

const { normalizeDesignStageName } = require("../lib/designWorkflowStages");
const {
  assignedTo2DTeamProjectSql,
  assignProjectTo2DLeader,
  current2DWorkflowStageFixtureSql,
  deleteProjectSubdivisionAssignment,
  isProjectAssignedTo2DTeamMember,
  twoDStageNameSql,
} = require("../repositories/projectSubdivisionRoutingRepository");
const { visibleFixturePredicate, visibleProjectPredicate } = require("../repositories/projectVisibility");
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

test("2D project and fixture visibility use assigned team membership without workflow coupling", () => {
  const teamSql = assignedTo2DTeamProjectSql("project", "requesting_root.employee_id");
  const projectSql = visibleProjectPredicate("project");
  const fixtureSql = visibleFixturePredicate("fixture", "project");

  [teamSql, projectSql, fixtureSql].forEach((sql) => {
    assert.match(sql, /project_subdivision_assignments/);
    assert.match(sql, /assigned_2d_team_members/);
    assert.match(sql, /psa_2d_team\.project_id = project\.id/);
    assert.match(sql, /assigned_2d_team_member\.employee_id = requesting_root\.employee_id/);
    assert.doesNotMatch(sql, /current_assignee_progress/);
    assert.doesNotMatch(sql, /current_2d_progress/);
    assert.doesNotMatch(sql, /stage_name/);
  });
});

test("project 2D team membership is resolved in one query for assigned and other-team users", async () => {
  const calls = [];
  const assignedEmployeeIds = new Set(["EMP2D1", "EMP2D2"]);
  const client = {
    async query(sql, params) {
      calls.push({ sql: sql.replace(/\s+/g, " ").trim(), params });
      return assignedEmployeeIds.has(params[1])
        ? { rowCount: 1, rows: [{ exists: true }] }
        : { rowCount: 0, rows: [] };
    },
  };

  assert.equal(await isProjectAssignedTo2DTeamMember("project-1", "EMP2D2", client), true);
  assert.equal(await isProjectAssignedTo2DTeamMember("project-1", "OTHER2D", client), false);
  assert.equal(calls.length, 2);
  calls.forEach((call) => {
    assert.deepEqual(call.params[0], "project-1");
    assert.match(call.sql, /WITH RECURSIVE/);
    assert.match(call.sql, /assigned_2d_team_members/);
    assert.match(call.sql, /psa_2d_team\.project_id = p\.id/);
  });
});

test("duplicate 2D leader assignment is rejected before insert", async () => {
  const calls = [];
  let insertCalled = false;
  const client = {
    async query(sql, params) {
      const compactSql = sql.replace(/\s+/g, " ").trim();
      calls.push({ sql: compactSql, params });

      if (compactSql.includes("SELECT ds.id") && compactSql.includes("JOIN department_subdivisions ds")) {
        return { rowCount: 1, rows: [{ id: "subdivision-2d", department_id: "design", subdivision_name: "2D" }] };
      }

      if (compactSql.includes("SELECT p.id, p.department_id") && compactSql.includes("FROM design.projects p")) {
        return { rowCount: 1, rows: [{ id: "project-1", department_id: "design" }] };
      }

      if (compactSql.includes("FROM users u")) {
        return {
          rowCount: 1,
          rows: [{
            employee_id: "EMP2D1",
            name: "2D Lead",
            department_id: "design",
            subdivision_id: "subdivision-2d",
            subdivision_name: "2D",
            role_id: "team_leader",
            role_name: "Team Leader",
          }],
        };
      }

      if (compactSql.includes("SELECT id FROM design.projects") && compactSql.includes("FOR UPDATE")) {
        return { rowCount: 1, rows: [{ id: "project-1" }] };
      }

      if (compactSql.includes("FROM design.project_subdivision_assignments") && compactSql.includes("LIMIT 1") && compactSql.includes("FOR UPDATE")) {
        return { rowCount: 1, rows: [{ id: "assignment-1" }] };
      }

      if (compactSql.includes("INSERT INTO design.project_subdivision_assignments")) {
        insertCalled = true;
        return { rowCount: 1, rows: [{ id: "assignment-2" }] };
      }

      throw new Error(`Unexpected SQL: ${compactSql}`);
    },
  };

  await assert.rejects(
    () => assignProjectTo2DLeader({ projectId: "project-1", assignedLeaderId: "EMP2D1", assignedBy: "LEAD" }, client),
    (error) => error.statusCode === 409 && /already assigned/.test(error.message),
  );
  assert.equal(insertCalled, false);
  assert.ok(calls.some((call) => call.sql.includes("FOR UPDATE")));
});

test("2D leader assignment deletion removes the assignment record", async () => {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql: sql.replace(/\s+/g, " ").trim(), params });
      return { rowCount: 1, rows: [{ project_id: "project-1", assigned_leader_id: "EMP2D1" }] };
    },
  };

  const deleted = await deleteProjectSubdivisionAssignment("project-1", "assignment-1", client);

  assert.deepEqual(deleted, { project_id: "project-1", assigned_leader_id: "EMP2D1" });
  assert.match(calls[0].sql, /DELETE FROM design\.project_subdivision_assignments/);
  assert.doesNotMatch(calls[0].sql, /UPDATE design\.project_subdivision_assignments/);
  assert.deepEqual(calls[0].params, ["assignment-1", "project-1"]);
});
