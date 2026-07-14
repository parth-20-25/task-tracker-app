const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  DESIGN_2D_COMPLETION_TASKS,
  FIXTURE_TASK_CODES,
  PROJECT_TASK_CODES,
  buildDesign2DCompletionState,
  formatDesign2DCompletionTaskName,
} = require("../lib/design2dCompletionTasks");
const {
  canMarkMimicNotRequired,
  nextRevisionFor,
} = require("../services/design2dCompletionTaskService");

function fixture(id, twoDComplete = true, workflowComplete = true) {
  return {
    fixture_id: id,
    fixture_no: id.toUpperCase(),
    part_name: `${id} part`,
    two_d_complete: twoDComplete,
    workflow_complete: workflowComplete,
  };
}

function approvedTask(code, revision = 0, fixtureId = null, overrides = {}) {
  const definition = DESIGN_2D_COMPLETION_TASKS[code];
  return {
    id: `${fixtureId || "project"}-${code}-${revision}`,
    task_type: "design_2d_completion",
    scope_type: definition.scope,
    fixture_id: definition.scope === "fixture" ? fixtureId : null,
    completion_task_code: code,
    completion_task_revision: revision,
    status: "closed",
    verification_status: "approved",
    ...overrides,
  };
}

function completeTasks(fixtures) {
  return [
    ...fixtures.flatMap((item) => FIXTURE_TASK_CODES.map((code) => approvedTask(code, 0, item.fixture_id))),
    ...PROJECT_TASK_CODES.map((code) => approvedTask(code)),
  ];
}

test("2D completion task catalog uses centralized codes, scopes and two-digit revision names", () => {
  assert.deepEqual(FIXTURE_TASK_CODES, [
    "FIXTURE_DRAFTING_CHECKING",
    "FIXTURE_DRAWING_CORRECTION",
    "FIXTURE_AUTOCAD_PDF",
    "FIXTURE_IGES",
  ]);
  assert.deepEqual(PROJECT_TASK_CODES, [
    "PROJECT_CMM_DATA",
    "PROJECT_LINE_LAYOUT",
    "PROJECT_MIMIC",
    "PROJECT_WEAR_OUT_DATA",
  ]);
  assert.equal(formatDesign2DCompletionTaskName("FIXTURE_DRAFTING_CHECKING", 0), "Drafting Checking 00");
  assert.equal(formatDesign2DCompletionTaskName("PROJECT_CMM_DATA", 1), "CMM Data 01");
  assert.equal(DESIGN_2D_COMPLETION_TASKS.PROJECT_CMM_DATA.scope, "project");
});

test("a project is eligible after one original 2D stage completes and only completed fixtures are exposed", () => {
  const fixtures = [fixture("fixture-1", true), fixture("fixture-2", false)];
  const state = buildDesign2DCompletionState({ fixtures, tasks: [] });

  assert.deepEqual(state.eligibleFixtures.map((item) => item.fixture_id), ["fixture-1"]);
  assert.equal(state.allFixtures2DComplete, false);
  assert.equal(state.projectTasksUnlocked, false);
});

test("fixture tasks retain their fixture scope while project tasks remain fixture-free", () => {
  const fixtures = [fixture("fixture-1")];
  const tasks = completeTasks(fixtures);
  const state = buildDesign2DCompletionState({ fixtures, tasks });

  assert.equal(tasks.find((task) => task.completion_task_code === "FIXTURE_IGES").fixture_id, "fixture-1");
  assert.equal(tasks.find((task) => task.completion_task_code === "PROJECT_LINE_LAYOUT").fixture_id, null);
  assert.equal(state.projectTasksUnlocked, true);
  assert.equal(state.projectCompletionReady, true);
});

test("project tasks remain locked until every fixture-level requirement is approved", () => {
  const fixtures = [fixture("fixture-1"), fixture("fixture-2")];
  const tasks = completeTasks(fixtures).filter(
    (task) => !(task.fixture_id === "fixture-2" && task.completion_task_code === "FIXTURE_IGES"),
  );
  const state = buildDesign2DCompletionState({ fixtures, tasks });

  assert.equal(state.fixtureRequirementsComplete, false);
  assert.equal(state.projectTasksUnlocked, false);
  assert.match(state.missingRequirements.join(" | "), /FIXTURE-2: IGES/);
});

test("revision rules start at 00, retain history, advance after completion or cancellation, and block active duplicates", () => {
  const completed00 = approvedTask("FIXTURE_DRAWING_CORRECTION", 0, "fixture-1");
  const active01 = approvedTask("FIXTURE_DRAWING_CORRECTION", 1, "fixture-1", {
    status: "in_progress",
    verification_status: "pending",
  });

  assert.equal(nextRevisionFor(null), 0);
  assert.equal(nextRevisionFor(completed00), 1);
  assert.equal(nextRevisionFor({ ...active01, status: "cancelled" }), 2);
  assert.throws(() => nextRevisionFor(active01), (error) => error.statusCode === 409 && /active unfinished revision/.test(error.message));
  assert.throws(
    () => nextRevisionFor({ ...completed00, status: "closed", verification_status: "rejected" }),
    (error) => error.statusCode === 409 && /approved or cancelled/.test(error.message),
  );
});

test("a new active revision is authoritative, remains alongside 00, and blocks project completion", () => {
  const fixtures = [fixture("fixture-1")];
  const tasks = completeTasks(fixtures);
  tasks.push(approvedTask("FIXTURE_DRAFTING_CHECKING", 1, "fixture-1", {
    status: "assigned",
    verification_status: "pending",
  }));
  const state = buildDesign2DCompletionState({ fixtures, tasks });

  assert.equal(tasks.filter((task) => task.completion_task_code === "FIXTURE_DRAFTING_CHECKING").length, 2);
  assert.equal(state.latestTasks.get("fixture-1:FIXTURE_DRAFTING_CHECKING").completion_task_revision, 1);
  assert.equal(state.projectTasksUnlocked, false);
  assert.equal(state.projectCompletionReady, false);
});

test("project completion also requires every original fixture workflow", () => {
  const fixtures = [fixture("fixture-1", true, true), fixture("fixture-2", true, false)];
  const state = buildDesign2DCompletionState({ fixtures, tasks: completeTasks(fixtures) });

  assert.equal(state.projectTasksUnlocked, true);
  assert.equal(state.allOriginalWorkflowsComplete, false);
  assert.equal(state.projectCompletionReady, false);
});

test("Mimic Not Required satisfies completion only with an approved audited reason and authorized leader", () => {
  const fixtures = [fixture("fixture-1")];
  const tasks = completeTasks(fixtures).filter((task) => task.completion_task_code !== "PROJECT_MIMIC");
  tasks.push(approvedTask("PROJECT_MIMIC", 0, null, {
    proof_required: false,
    completion_task_not_required_reason: "Customer layout excludes mimic output",
    completion_task_not_required_by: "LEAD-1",
    completion_task_not_required_at: "2026-07-14T00:00:00.000Z",
  }));

  assert.equal(buildDesign2DCompletionState({ fixtures, tasks }).projectCompletionReady, true);
  assert.equal(canMarkMimicNotRequired({
    role_id: "team_leader",
    role: { id: "team_leader", name: "Team Leader", permissions: { all: true } },
  }), true);
  assert.equal(canMarkMimicNotRequired({
    role_id: "engineer",
    role: { id: "engineer", name: "Engineer", permissions: { all: true } },
  }), false);
});

test("database migration prevents duplicate revisions and duplicate active scopes", () => {
  const migration = fs.readFileSync(path.join(__dirname, "..", "migrations.js"), "utf8");
  const bootstrap = fs.readFileSync(
    path.join(__dirname, "..", "repositories", "bootstrapRepository.js"),
    "utf8",
  );

  for (const schemaObject of [
    "completion_task_code",
    "completion_task_revision",
    "completion_task_not_required_reason",
    "uniq_design_2d_completion_fixture_revision",
    "uniq_design_2d_completion_project_revision",
    "uniq_design_2d_completion_fixture_active",
    "uniq_design_2d_completion_project_active",
    "tasks_design_2d_completion_fields_check",
  ]) {
    assert.match(migration, new RegExp(schemaObject));
    assert.match(bootstrap, new RegExp(schemaObject));
  }
  assert.match(migration, /scope_type = 'project'[\s\S]*fixture_id IS NULL/);
});
