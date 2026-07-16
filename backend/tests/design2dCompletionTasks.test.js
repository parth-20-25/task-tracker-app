const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://user:pass@localhost:5432/tasktracker_test";

const {
  DESIGN_2D_COMPLETION_TASKS,
  FIXTURE_TASK_CODES,
  PROJECT_TASK_CODES,
  aggregateCompletionState,
  buildDesign2DCompletionState,
  buildFixtureCompletionAggregate,
  formatDesign2DCompletionTaskName,
} = require("../lib/design2dCompletionTasks");
const { nextRevisionFor } = require("../services/design2dCompletionTaskService");
const { activeTaskLateral } = require("../services/operationalStateResolver");
const { mapTaskRow } = require("../repositories/mappers");
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
  const definition = DESIGN_2D_COMPLETION_TASKS[code];
  const scopeType = overrides.scope_type || definition.scope;
  const scopedFixtureId = scopeType === "fixture" ? fixtureId : null;
  const owner = scopedFixtureId || "project";
  return {
    id: `${owner}-${code}-${revision}`,
    title: formatDesign2DCompletionTaskName(code, revision),
    task_type: "design_2d_completion",
    scope_type: scopeType,
    fixture_id: scopedFixtureId,
    completion_task_code: code,
    completion_task_revision: revision,
    status: "closed",
    verification_status: "approved",
    ...overrides,
  };
}

function approvedMandatoryTasks(fixtureId = "fixture-1") {
  return [
    ...FIXTURE_TASK_CODES.map((code) => completionTask(code, 0, fixtureId)),
    ...PROJECT_TASK_CODES
      .filter((code) => DESIGN_2D_COMPLETION_TASKS[code].isMandatory)
      .map((code) => completionTask(code, 0, null, { scope_type: "project", fixture_id: null })),
  ];
}

test("the completion catalog separates mandatory fixture tasks from project tasks", () => {
  assert.deepEqual(FIXTURE_TASK_CODES, [
    "FIXTURE_DRAFTING_CHECKING",
    "FIXTURE_DRAWING_CORRECTION",
    "FIXTURE_AUTOCAD_PDF",
    "FIXTURE_IGES",
  ]);
  assert.deepEqual(PROJECT_TASK_CODES, [
    "PROJECT_CMM_DATA",
    "PROJECT_LINE_LAYOUT",
    "PROJECT_WEAR_OUT_DATA",
    "PROJECT_MIMIC",
  ]);
  assert.equal(formatDesign2DCompletionTaskName("FIXTURE_DRAFTING_CHECKING", 0), "Drafting Checking 00");
  assert.equal(formatDesign2DCompletionTaskName("PROJECT_CMM_DATA", 1), "CMM Data 01");
  assert.equal(DESIGN_2D_COMPLETION_TASKS.PROJECT_CMM_DATA.scope, "project");
  assert.equal(DESIGN_2D_COMPLETION_TASKS.PROJECT_MIMIC.isMandatory, false);
  assert.equal(FIXTURE_TASK_CODES.every((code) => DESIGN_2D_COMPLETION_TASKS[code].isMandatory === true), true);
});

test("only fixtures with a completed original 2D stage are exposed on the completion board", () => {
  const state = buildDesign2DCompletionState({
    fixtures: [fixture("fixture-1", true), fixture("fixture-2", false)],
    tasks: [],
  });

  assert.deepEqual(state.eligibleFixtures.map((item) => item.fixture_id), ["fixture-1"]);
  assert.equal(state.allFixtures2DComplete, false);
});

test("uncreated mandatory completion activities block final project completion", () => {
  const state = buildDesign2DCompletionState({ fixtures: [fixture("fixture-1")], tasks: [] });

  assert.equal(state.allOriginalWorkflowsComplete, true);
  assert.equal(state.fixtureRequirementsComplete, false);
  assert.equal(state.projectRequirementsComplete, false);
  assert.equal(state.projectCompletionReady, false);
  assert.match(state.missingRequirements.join(" | "), /Drafting Checking 00 is incomplete/);
  assert.match(state.missingRequirements.join(" | "), /CMM Data 00 is incomplete/);
});

test("one approved fixture activity gives 25 percent and stays unassigned", () => {
  const completed = completionTask("FIXTURE_AUTOCAD_PDF", 0, "fixture-1");
  const state = buildDesign2DCompletionState({ fixtures: [fixture("fixture-1")], tasks: [completed] });
  const aggregate = buildFixtureCompletionAggregate(state.latestTasks, fixture("fixture-1"));

  assert.equal(aggregate.completedMandatoryCount, 1);
  assert.equal(aggregate.totalMandatoryCount, 4);
  assert.equal(aggregate.progressPercentage, 25);
  assert.equal(aggregate.aggregateSection, "UNASSIGNED");
  assert.equal(state.fixtureRequirementsComplete, false);
  assert.equal(state.projectCompletionReady, false);
});
test("all mandatory latest revisions complete the aggregate while optional Mimic is ignored", () => {
  const tasks = [
    ...approvedMandatoryTasks(),
    completionTask("PROJECT_MIMIC", 0, null, {
      scope_type: "project",
      fixture_id: null,
      status: "in_progress",
      verification_status: "pending",
    }),
  ];
  const state = buildDesign2DCompletionState({ fixtures: [fixture("fixture-1")], tasks });

  assert.equal(state.fixtureRequirementsComplete, true);
  assert.equal(state.projectRequirementsComplete, true);
  assert.equal(state.projectCompletionReady, true);
  assert.equal(aggregateCompletionState(state.latestTasks, { scope: "fixture", fixtureId: "fixture-1" }), "WORKFLOW_COMPLETE");
  assert.equal(aggregateCompletionState(state.latestTasks, { scope: "project" }), "WORKFLOW_COMPLETE");
});

test("all four approved fixture activities give 100 percent and workflow complete", () => {
  const state = buildDesign2DCompletionState({ fixtures: [fixture("fixture-1")], tasks: approvedMandatoryTasks() });
  const aggregate = buildFixtureCompletionAggregate(state.latestTasks, fixture("fixture-1"));

  assert.equal(aggregate.completedMandatoryCount, 4);
  assert.equal(aggregate.totalMandatoryCount, 4);
  assert.equal(aggregate.progressPercentage, 100);
  assert.equal(aggregate.aggregateSection, "WORKFLOW_COMPLETE");
  assert.equal(state.fixtureRequirementsComplete, true);
});
test("latest mandatory revision controls aggregate status even when an older revision is approved", () => {
  const tasks = [
    ...approvedMandatoryTasks().filter((task) => task.completion_task_code !== "FIXTURE_DRAFTING_CHECKING"),
    completionTask("FIXTURE_DRAFTING_CHECKING", 0),
    completionTask("FIXTURE_DRAFTING_CHECKING", 1, "fixture-1", {
      status: "assigned",
      verification_status: "pending",
    }),
  ];
  const state = buildDesign2DCompletionState({ fixtures: [fixture("fixture-1")], tasks });

  assert.equal(state.latestTasks.get("fixture-1:FIXTURE_DRAFTING_CHECKING").completion_task_revision, 1);
  assert.equal(state.fixtureRequirementsComplete, false);
  assert.equal(aggregateCompletionState(state.latestTasks, { scope: "fixture", fixtureId: "fixture-1" }), "ASSIGNED");
});

test("newer assigned activity revision replaces the completed revision until it is approved", () => {
  const tasks = [
    ...approvedMandatoryTasks().filter((task) => task.completion_task_code !== "FIXTURE_AUTOCAD_PDF"),
    completionTask("FIXTURE_AUTOCAD_PDF", 0),
    completionTask("FIXTURE_AUTOCAD_PDF", 1, "fixture-1", {
      status: "assigned",
      verification_status: "pending",
    }),
  ];
  const state = buildDesign2DCompletionState({ fixtures: [fixture("fixture-1")], tasks });
  const aggregate = buildFixtureCompletionAggregate(state.latestTasks, fixture("fixture-1"));

  assert.equal(state.latestTasks.get("fixture-1:FIXTURE_AUTOCAD_PDF").completion_task_revision, 1);
  assert.equal(aggregate.progressPercentage, 75);
  assert.equal(aggregate.aggregateSection, "ASSIGNED");
  assert.equal(state.fixtureRequirementsComplete, false);
});

test("cancelled latest activity revision falls back to the latest non-cancelled approved revision", () => {
  const tasks = [
    ...approvedMandatoryTasks().filter((task) => task.completion_task_code !== "FIXTURE_AUTOCAD_PDF"),
    completionTask("FIXTURE_AUTOCAD_PDF", 0),
    completionTask("FIXTURE_AUTOCAD_PDF", 1, "fixture-1", {
      status: "cancelled",
      verification_status: "rejected",
    }),
  ];
  const state = buildDesign2DCompletionState({ fixtures: [fixture("fixture-1")], tasks });
  const aggregate = buildFixtureCompletionAggregate(state.latestTasks, fixture("fixture-1"));

  assert.equal(state.latestTasks.get("fixture-1:FIXTURE_AUTOCAD_PDF").completion_task_revision, 0);
  assert.equal(aggregate.progressPercentage, 100);
  assert.equal(aggregate.aggregateSection, "WORKFLOW_COMPLETE");
  assert.equal(state.fixtureRequirementsComplete, true);
});
test("cancelled mandatory latest revisions do not satisfy completion", () => {
  const tasks = [
    ...approvedMandatoryTasks().filter((task) => task.completion_task_code !== "FIXTURE_IGES"),
    completionTask("FIXTURE_IGES", 0, "fixture-1", {
      status: "cancelled",
      verification_status: "pending",
    }),
  ];
  const state = buildDesign2DCompletionState({ fixtures: [fixture("fixture-1")], tasks });

  assert.equal(state.fixtureRequirementsComplete, false);
  assert.equal(aggregateCompletionState(state.latestTasks, { scope: "fixture", fixtureId: "fixture-1" }), "UNASSIGNED");
  assert.match(state.missingRequirements.join(" | "), /IGES 00 is incomplete/);
});

test("an independently created IGES revision is tracked without requiring Drafting Checking to own the state", () => {
  const iges = completionTask("FIXTURE_IGES", 0, "fixture-1", {
    status: "in_progress",
    verification_status: "pending",
  });
  const state = buildDesign2DCompletionState({ fixtures: [fixture("fixture-1")], tasks: [iges] });

  assert.equal(state.latestTasks.get("fixture-1:FIXTURE_IGES"), iges);
  assert.equal(state.latestTasks.has("fixture-1:FIXTURE_DRAFTING_CHECKING"), false);
  assert.equal(state.projectCompletionReady, false);
  assert.equal(aggregateCompletionState(state.latestTasks, { scope: "fixture", fixtureId: "fixture-1" }), "IN_PROGRESS");
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

test("completion task rows do not inherit Workflow Complete from the parent fixture", () => {
  const mapped = mapTaskRow({
    id: 99,
    title: "AutoCAD PDF 01",
    task_type: "design_2d_completion",
    status: "assigned",
    verification_status: "pending",
    completion_percent: 0,
    assignee_ids: '["EMP-1"]',
    proof_assignee_user_ids: '[]',
    dependency_ids: '[]',
    tags: '[]',
    resolved_fixture_workflow_complete: true,
  });

  assert.equal(mapped.operational_state, "ASSIGNED");
  assert.equal(mapped.completion_percent, 0);
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
  assert.match(taskService, /design2DCompletionCancellationResponse[\s\S]*fixtureAggregate/);
});

test("completion assignment validates fixture membership without active-stage visibility", () => {
  const taskService = fs.readFileSync(path.join(__dirname, "..", "services", "taskService.js"), "utf8");
  const projectLookupIndex = taskService.indexOf("completionProject = await findProjectByIdForUser");
  const branchStart = taskService.lastIndexOf("if (taskType === TASK_TYPES.DESIGN_2D_COMPLETION)", projectLookupIndex);
  const branchEnd = taskService.indexOf("if (!Object.values(TASK_STATUSES).includes(resolvedTaskStatus))", branchStart);
  const completionBranch = taskService.slice(branchStart, branchEnd);

  assert.match(completionBranch, /FROM design\.fixtures di/);
  assert.match(completionBranch, /AND di\.project_id = \$3/);
  assert.doesNotMatch(completionBranch, /findFixtureAssignmentContextByIdForUser/);
});

test("the idempotent schema keeps fixture and project completion codes separated without proof requirements", () => {
  const migration = fs.readFileSync(path.join(__dirname, "..", "migrations.js"), "utf8");
  const bootstrap = fs.readFileSync(path.join(__dirname, "..", "repositories", "bootstrapRepository.js"), "utf8");

  for (const source of [migration, bootstrap]) {
    assert.match(source, /task_type = 'design_2d_completion'/);
    assert.match(source, /uniq_design_2d_completion_fixture_revision/);
    const fixtureConstraintStart = source.indexOf("completion_task_code IN (");
    const fixtureConstraintEnd = source.indexOf("scope_type = 'project'", fixtureConstraintStart);
    const fixtureConstraint = source.slice(fixtureConstraintStart, fixtureConstraintEnd);
    assert.match(fixtureConstraint, /'FIXTURE_DRAFTING_CHECKING'[\s\S]*'FIXTURE_IGES'/);
    assert.doesNotMatch(fixtureConstraint, /'PROJECT_CMM_DATA'|'PROJECT_LINE_LAYOUT'|'PROJECT_MIMIC'|'PROJECT_WEAR_OUT_DATA'/);
    assert.match(source, /scope_type = 'project'[\s\S]*'PROJECT_CMM_DATA'[\s\S]*'PROJECT_WEAR_OUT_DATA'/);
    assert.match(source, /AND proof_required = FALSE/);
    assert.match(source, /completion_task_revision IS NULL/);
    assert.match(source, /ROW_NUMBER\(\) OVER/);
  }
});

test("shared task insert and list queries do not force completion or additional tasks through fixture workflow rules", () => {
  const repository = fs.readFileSync(path.join(__dirname, "..", "repositories", "tasksRepository.js"), "utf8");

  assert.doesNotMatch(repository, /ON CONFLICT \(fixture_id, stage\)/);
  assert.match(repository, /t\.task_type IN \('additional_design', 'design_2d_completion'\) OR COALESCE\(project\.status, 'active'\) = 'active'/);
});
