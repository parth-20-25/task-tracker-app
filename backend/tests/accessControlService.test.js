const assert = require("node:assert/strict");
const test = require("node:test");

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://user:pass@localhost:5432/tasktracker_test";

const { PERMISSIONS } = require("../config/constants");
const {
  buildTaskAccessPredicate,
  canAccessTask,
  canAccessDepartment,
  hasPermission,
  isOperationalControllerRole,
  isProjectAuthorityRole,
} = require("../services/accessControlService");

function makeUser(overrides = {}) {
  return {
    employee_id: "EMP100",
    department_id: "d1",
    permissions: [],
    role: {
      id: "r-worker",
      hierarchy_level: 6,
      permissions: {},
    },
    visible_user_ids: ["EMP100"],
    ...overrides,
  };
}

function makeTask(overrides = {}) {
  const base = {
    id: 10,
    department_id: "d9",
    assigned_to: "EMP200",
    assigned_user_id: "EMP200",
    assignee_ids: ["EMP200"],
    assigned_by: "EMP900",
    created_by: "EMP900",
    project_id: "2c0df497-c59f-4239-a9d6-3ee2c2f47140",
    project_uploaded_by: "EMP900",
    fixture_uploaded_by: null,
  };

  const merged = { ...base, ...overrides };

  // Tests historically used `project_uploaded_by` as the creator; ensure
  // `project_created_by_user_id` is present for visibility checks.
  if (!merged.project_created_by_user_id) {
    merged.project_created_by_user_id = merged.project_uploaded_by || null;
  }

  return merged;
}

test("View Self Tasks Only allows direct assignee across project hierarchy", () => {
  const user = makeUser({ permissions: [PERMISSIONS.VIEW_SELF_TASKS] });
  const task = makeTask({
    assigned_to: "EMP100",
    assigned_user_id: "EMP100",
    assignee_ids: ["EMP100"],
    department_id: "another-department",
    project_uploaded_by: "EMP999",
  });

  assert.equal(canAccessTask(user, task), true);
});

test("View Self Tasks Only denies unrelated tasks", () => {
  const user = makeUser({ permissions: [PERMISSIONS.VIEW_SELF_TASKS] });

  assert.equal(canAccessTask(user, makeTask()), false);
});

test("View Self Tasks Only allows tasks created by self", () => {
  const user = makeUser({ permissions: [PERMISSIONS.VIEW_SELF_TASKS] });
  const task = makeTask({
    created_by: "EMP100",
    assigned_by: "EMP100",
    project_uploaded_by: "EMP999",
  });

  assert.equal(canAccessTask(user, task), true);
});

test("no task visibility permission denies unrelated and assigned tasks", () => {
  const user = makeUser();
  const assignedTask = makeTask({
    assigned_to: "EMP100",
    assigned_user_id: "EMP100",
    assignee_ids: ["EMP100"],
  });

  assert.equal(canAccessTask(user, assignedTask), false);
});

test("legacy upload permission alone does not satisfy native upload access", () => {
  const legacyOnlyUser = makeUser({
    permissions: [PERMISSIONS.UPLOAD_LEGACY_DESIGN_DATA],
  });

  assert.equal(hasPermission(legacyOnlyUser, PERMISSIONS.UPLOAD_LEGACY_DESIGN_DATA), true);
  assert.equal(hasPermission(legacyOnlyUser, PERMISSIONS.UPLOAD_NATIVE_DESIGN_DATA), false);
});

test("migrated legacy upload holder can access native upload after sync", () => {
  const migratedUser = makeUser({
    permissions: [
      PERMISSIONS.UPLOAD_LEGACY_DESIGN_DATA,
      PERMISSIONS.UPLOAD_NATIVE_DESIGN_DATA,
    ],
  });
  const noUploadUser = makeUser();

  assert.equal(hasPermission(migratedUser, PERMISSIONS.UPLOAD_NATIVE_DESIGN_DATA), true);
  assert.equal(hasPermission(noUploadUser, PERMISSIONS.UPLOAD_NATIVE_DESIGN_DATA), false);
});

test("View All Tasks keeps manager scope but includes directly assigned outside scope", () => {
  const user = makeUser({
    permissions: [PERMISSIONS.VIEW_ALL_TASKS],
    department_id: "d1",
    visible_user_ids: ["EMP100", "EMP101"],
  });

  assert.equal(canAccessTask(user, makeTask({ department_id: "d1", project_uploaded_by: "EMP101" })), true);
  assert.equal(canAccessTask(user, makeTask({ department_id: "d1", project_uploaded_by: "EMP999" })), false);
  assert.equal(canAccessTask(user, makeTask({
    department_id: "d9",
    assigned_to: "EMP100",
    assigned_user_id: "EMP100",
    assignee_ids: ["EMP100"],
    project_uploaded_by: "EMP999",
  })), true);
});

test("Director/CEO-style project authority roles inherit org-wide task and department visibility", () => {
  const directorCeo = makeUser({
    employee_id: "CEO001",
    department_id: null,
    permissions: [PERMISSIONS.VIEW_ALL_TASKS],
    role: {
      id: "director_ceo",
      name: "Director/CEO",
      hierarchy_level: 2,
      permissions: {},
    },
    visible_user_ids: ["CEO001"],
  });

  assert.equal(isProjectAuthorityRole(directorCeo), true);
  assert.equal(canAccessDepartment(directorCeo, "design"), true);
  assert.equal(canAccessTask(directorCeo, makeTask({
    department_id: "design",
    project_uploaded_by: "EMP999",
  })), true);

  const params = [];
  assert.equal(buildTaskAccessPredicate(directorCeo, params).trim(), "1 = 1");
  assert.deepEqual(params, []);
});

test("lower hierarchy roles do not receive org-wide project authority", () => {
  const lineManager = makeUser({
    permissions: [PERMISSIONS.VIEW_ALL_TASKS],
    role: {
      id: "r3",
      name: "Line Manager",
      hierarchy_level: 3,
      permissions: {},
    },
    visible_user_ids: ["EMP100", "EMP101"],
  });

  assert.equal(isProjectAuthorityRole(lineManager), false);
  assert.equal(canAccessDepartment(lineManager, "d2"), false);
  assert.equal(canAccessTask(lineManager, makeTask({
    department_id: "d1",
    project_uploaded_by: "EMP999",
  })), false);
});

test("department leaders can review additional design tasks without fixture workflow visibility", () => {
  const leader = makeUser({
    department_id: "design",
    permissions: [PERMISSIONS.VIEW_ALL_TASKS, PERMISSIONS.APPROVE_COMPLETED_TASK],
    role: { id: "team_leader", name: "Team Leader", hierarchy_level: 4, permissions: {} },
  });
  const unrelatedProjectTask = makeTask({
    department_id: "design",
    project_uploaded_by: "EMP999",
  });

  assert.equal(canAccessTask(leader, { ...unrelatedProjectTask, task_type: "additional_design" }), true);
  assert.equal(canAccessTask(leader, { ...unrelatedProjectTask, task_type: "department_workflow" }), false);
});

test("operational controller roles include General Manager, Team Leader, and Co-Leader but exclude lower workers", () => {
  assert.equal(isOperationalControllerRole(makeUser({
    role: { id: "general_manager", name: "General Manager", hierarchy_level: 3, permissions: {} },
  })), true);
  assert.equal(isOperationalControllerRole(makeUser({
    role: { id: "team_leader", name: "Team Leader", hierarchy_level: 4, permissions: {} },
  })), true);
  assert.equal(isOperationalControllerRole(makeUser({
    role: { id: "co_leader", name: "Co-Leader", hierarchy_level: 4, permissions: {} },
  })), true);
  assert.equal(isOperationalControllerRole(makeUser({
    role: { id: "employee", name: "Employee", hierarchy_level: 6, permissions: {} },
  })), false);
});

test("SQL access predicate separates self and all task scopes", () => {
  const selfParams = [];
  const selfPredicate = buildTaskAccessPredicate(
    makeUser({ permissions: [PERMISSIONS.VIEW_SELF_TASKS] }),
    selfParams,
  );

  assert.match(selfPredicate, /assigned_user_id/);
  assert.match(selfPredicate, /created_by/);
  assert.doesNotMatch(selfPredicate, /department_id =/);
  assert.deepEqual(selfParams, ["EMP100"]);

  const allParams = [];
  const allPredicate = buildTaskAccessPredicate(
    makeUser({ permissions: [PERMISSIONS.VIEW_ALL_TASKS] }),
    allParams,
  );

  assert.match(allPredicate, /department_id = \$2/);
  assert.match(allPredicate, /visible_users/);
  assert.deepEqual(allParams, ["EMP100", "d1", "EMP100"]);
});
