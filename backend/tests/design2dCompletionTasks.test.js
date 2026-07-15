const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://user:pass@localhost:5432/tasktracker_test";

const {
  DESIGN_2D_COMPLETION_TASKS,
  FIXTURE_TASK_CODES,
  PROJECT_TASK_CODES,
  buildDesign2DCompletionState,
  formatDesign2DCompletionTaskName,
} = require("../lib/design2dCompletionTasks");
const { nextRevisionFor } = require("../services/design2dCompletionTaskService");
const { activeTaskLateral } = require("../services/operationalStateResolver");

const { shouldAdvanceFixtureWorkflow } = require("../services/taskStateRules");
function fixture(id, twoDComplete = true, workflowComplete = true) {
  return {
    fixture_id: id,
    fixture_no: id.toUpperCase(),
    part_name: `${id} part`,
    two_d_complete: twoDComplete,
    workflow_complete: workflowComplete,
  };
}

function completionTask(code, revision = 0, fixtureId = "fixture-1", overrides = {}) {
  return {
    id: `${fixtureId}-${code}-${revision}`,
    title: formatDesign2DCompletionTaskName(code, revision),
    task_type: "design_2d_completion",
    scope_type: "fixture",
    fixture_id: fixtureId,
    completion_task_code: code,
    completion_task_revision: revision,
    status: "closed",
    verification_status: "approved",
    ...overrides,
  };
}

test("the completion catalog exposes every configured activity independently at fixture scope", () => {
  assert.deepEqual(FIXTURE_TASK_CODES, [
    "FIXTURE_DRAFTING_CHECKING",
    "FIXTURE_DRAWING_CORRECTION",
    "FIXTURE_AUTOCAD_PDF",
    "FIXTURE_IGES",
    "PROJECT_CMM_DATA",
    "PROJECT_LINE_LAYOUT",
    "PROJECT_MIMIC",
    "PROJECT_WEAR_OUT_DATA",
  ]);
  assert.deepEqual(PROJECT_TASK_CODES, []);
  assert.equal(formatDesign2DCompletionTaskName("FIXTURE_DRAFTING_CHECKING", 0), "Drafting Checking 00");
  assert.equal(formatDesign2DCompletionTaskName("PROJECT_CMM_DATA", 1), "CMM Data 01");
  assert.equal(DESIGN_2D_COMPLETION_TASKS.PROJECT_CMM_DATA.scope, "fixture");
  assert.equal(FIXTURE_TASK_CODES.every((code) => DESIGN_2D_COMPLETION_TASKS[code].required === false), true);
});

test("only fixtures with a completed original 2D stage are exposed on the completion board", () => {
  const state = buildDesign2DCompletionState({
    fixtures: [fixture("fixture-1", true), fixture("fixture-2", false)],
    tasks: [],
  });

  assert.deepEqual(state.eligibleFixtures.map((item) => item.fixture_id), ["fixture-1"]);
  assert.equal(state.allFixtures2DComplete, false);
});

test("uncreated activities remain optional and do not reopen or block a completed original workflow", () => {
  const state = buildDesign2DCompletionState({ fixtures: [fixture("fixture-1")], tasks: [] });

  assert.equal(state.allOriginalWorkflowsComplete, true);
  assert.equal(state.fixtureRequirementsComplete, true);
  assert.equal(state.projectCompletionReady, true);
  assert.deepEqual(state.missingRequirements, []);
});

test("an independently created IGES revision is tracked without requiring Drafting Checking", () => {
  const iges = completionTask("FIXTURE_IGES", 0, "fixture-1", {
    status: "in_progress",
    verification_status: "pending",
  });
  const state = buildDesign2DCompletionState({ fixtures: [fixture("fixture-1")], tasks: [iges] });

  assert.equal(state.latestTasks.get("fixture-1:FIXTURE_IGES"), iges);
  assert.equal(state.latestTasks.has("fixture-1:FIXTURE_DRAFTING_CHECKING"), false);
  assert.equal(state.projectCompletionReady, false);
  assert.match(state.missingRequirements.join(" | "), /IGES 00 is incomplete/);
});

test("revision rules preserve history, increment per fixture and activity, and block active duplicates", () => {
  const completed00 = completionTask("FIXTURE_DRAWING_CORRECTION", 0);
  const active01 = completionTask("FIXTURE_DRAWING_CORRECTION", 1, "fixture-1", {
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

test("completed 00 remains in history while active 01 becomes the selected latest revision", () => {
  const completed00 = completionTask("FIXTURE_DRAFTING_CHECKING", 0);
  const active01 = completionTask("FIXTURE_DRAFTING_CHECKING", 1, "fixture-1", {
    status: "assigned",
    verification_status: "pending",
  });
  const tasks = [completed00, active01];
  const state = buildDesign2DCompletionState({ fixtures: [fixture("fixture-1")], tasks });

  assert.equal(tasks.length, 2);
  assert.equal(state.latestTasks.get("fixture-1:FIXTURE_DRAFTING_CHECKING"), active01);
  assert.equal(completed00.status, "closed");
});

test("main fixture operational SQL ignores completion activities at the backend boundary", () => {
  const sql = activeTaskLateral("fixture", "operational_task");
  assert.match(sql, /t\.task_type = 'department_workflow'/);
  assert.doesNotMatch(sql, /task_type = 'design_2d_completion'/);
});

test("completion approval, rejection, transfer, and cancellation stay off fixture workflow mutations", () => {
  const completion = completionTask("FIXTURE_DRAFTING_CHECKING", 0, "fixture-1", {
    workflow_id: "workflow-1",
    current_stage_id: "stage-1",
  });
  const taskService = fs.readFileSync(path.join(__dirname, "..", "services", "taskService.js"), "utf8");

  assert.equal(shouldAdvanceFixtureWorkflow(completion, "closed"), false);
  assert.match(taskService, /task\.task_type === TASK_TYPES\.DESIGN_2D_COMPLETION[\s\S]*transferDesign2DCompletionTaskForUser/);
  assert.match(
    taskService,
    /lockedTask\.task_type !== TASK_TYPES\.DESIGN_2D_COMPLETION[\s\S]*releaseFixtureStageAssignment/,
  );
  assert.match(taskService, /if \(!isWorkflowManagedTask\(task\)\) \{[\s\S]*return null;/);
});

test("the idempotent schema keeps the category discriminator and allows legacy activity codes at fixture scope", () => {
  const migration = fs.readFileSync(path.join(__dirname, "..", "migrations.js"), "utf8");
  const bootstrap = fs.readFileSync(path.join(__dirname, "..", "repositories", "bootstrapRepository.js"), "utf8");

  for (const source of [migration, bootstrap]) {
    assert.match(source, /task_type = 'design_2d_completion'/);
    assert.match(source, /uniq_design_2d_completion_fixture_revision/);
    assert.match(source, /scope_type = 'fixture'[\s\S]*'PROJECT_CMM_DATA'[\s\S]*'PROJECT_WEAR_OUT_DATA'/);
    assert.match(source, /completion_task_revision IS NULL/);
    assert.match(source, /ROW_NUMBER\(\) OVER/);
  }
});
test("shared task insert and list queries do not force completion or additional tasks through fixture workflow rules", () => {
  const repository = fs.readFileSync(path.join(__dirname, "..", "repositories", "tasksRepository.js"), "utf8");

  assert.doesNotMatch(repository, /ON CONFLICT \(fixture_id, stage\)/);
  assert.match(repository, /t\.task_type = 'additional_design' OR COALESCE\(project\.status, 'active'\) = 'active'/);
});
