const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { OPERATIONAL_STATES, resolveFixtureOperationalState } = require("../services/operationalStateResolver");
const { THREE_D_PROJECT_PROOF_OPTIONAL_KINDS } = require("../lib/taskProofPolicy");
const {
  canCancelAssignedTask,
  canCancelOperationalTask,
  shouldAutoStartTask,
  shouldAdvanceFixtureWorkflow,
  shouldSubmitForVerification,
} = require("../services/taskStateRules");

function task(overrides = {}) {
  return {
    id: 1,
    status: "assigned",
    verification_status: "pending",
    completion_percent: 0,
    proof_url: [],
    assigned_to: "EMP1",
    ...overrides,
  };
}

test("case 1: 0% assigned stays in Assigned section", () => {
  const assignedTask = task();

  assert.equal(shouldAutoStartTask(assignedTask, 0), false);
  assert.equal(
    resolveFixtureOperationalState({ task: assignedTask }),
    OPERATIONAL_STATES.ASSIGNED,
  );
});

test("case 2: progress changed to 1% auto-starts and resolves In Progress", () => {
  const assignedTask = task();

  assert.equal(shouldAutoStartTask(assignedTask, 1), true);
  assert.equal(
    resolveFixtureOperationalState({ task: task({ status: "in_progress", completion_percent: 1 }) }),
    OPERATIONAL_STATES.IN_PROGRESS,
  );
});

test("case 3: historical assigned/pending tasks above 0% are backfill candidates", () => {
  assert.equal(shouldAutoStartTask(task({ status: "assigned", completion_percent: 35 }), 35), true);
  assert.equal(shouldAutoStartTask(task({ status: "pending", completion_percent: 35 }), 35), true);
});

test("case 4: 100% without proof remains In Progress and does not enter Verification for proof-required stages", () => {
  for (const stageName of ["Concept", "3D Finish", "2D Finish"]) {
    const inProgressTask = task({
      status: "in_progress",
      completion_percent: 100,
      proof_url: [],
      workflow_stage: stageName,
    });

    assert.equal(shouldSubmitForVerification(inProgressTask, 100), false);
    assert.equal(
      resolveFixtureOperationalState({ task: inProgressTask, progress: { status: "IN_PROGRESS" } }),
      OPERATIONAL_STATES.IN_PROGRESS,
    );
  }
});

test("case 4b: DAP can submit for verification at 100% without proof", () => {
  const inProgressTask = task({
    status: "in_progress",
    completion_percent: 100,
    proof_url: [],
    workflow_stage: "DAP",
  });

  assert.equal(shouldSubmitForVerification(inProgressTask, 100), true);
});

test("case 4c: design 2D completion tasks can submit at 100% without proof", () => {
  const inProgressTask = task({
    task_type: "design_2d_completion",
    status: "in_progress",
    completion_percent: 100,
    proof_url: [],
    workflow_stage: "2D Finish",
  });

  assert.equal(shouldSubmitForVerification(inProgressTask, 100), true);
});

test("case 4d: 3D project additional tasks can submit at 100% without proof", () => {
  for (const additionalTaskKind of THREE_D_PROJECT_PROOF_OPTIONAL_KINDS) {
    assert.equal(shouldSubmitForVerification(task({
      task_type: "additional_design",
      additional_task_kind: additionalTaskKind,
      design_team: "3D",
      scope_type: "project",
      fixture_id: null,
      proof_required: true,
      status: "in_progress",
      completion_percent: 100,
      proof_url: [],
    }), 100), true, additionalTaskKind);
  }
});

test("case 4e: main 3D fixture workflow tasks still require proof", () => {
  assert.equal(shouldSubmitForVerification(task({
    task_type: "department_workflow",
    workflow_stage: "3D Finish",
    proof_required: true,
    status: "in_progress",
    completion_percent: 100,
    proof_url: [],
  }), 100), false);
});

test("case 5: 100% with proof is eligible for Verification", () => {
  const inProgressTask = task({ status: "in_progress", completion_percent: 100, proof_url: ["/proof.png"] });

  assert.equal(shouldSubmitForVerification(inProgressTask, 100), true);
  assert.equal(
    resolveFixtureOperationalState({
      task: task({ status: "under_review", completion_percent: 100, proof_url: ["/proof.png"] }),
      progress: { status: "SUBMITTED_FOR_VERIFICATION" },
    }),
    OPERATIONAL_STATES.VERIFICATION,
  );
});

test("case 6: explicit submit after proof enters Verification", () => {
  assert.equal(shouldSubmitForVerification(task({ status: "in_progress", proof_url: ["/proof.png"] }), 100), true);
  assert.equal(
    resolveFixtureOperationalState({
      task: task({ status: "under_review", proof_url: ["/proof.png"] }),
      progress: { status: "SUBMITTED_FOR_VERIFICATION" },
    }),
    OPERATIONAL_STATES.VERIFICATION,
  );
});

test("case 7: cancel before work is allowed and released fixture resolves Unassigned", () => {
  assert.equal(canCancelAssignedTask(task({ status: "assigned", completion_percent: 0 })), true);
  assert.equal(canCancelOperationalTask(task({ status: "assigned", completion_percent: 0 })), true);
  assert.equal(
    resolveFixtureOperationalState({ task: null, progress: { status: "PENDING", assigned_to: null } }),
    OPERATIONAL_STATES.UNASSIGNED,
  );
});

test("case 8: operational cancellation after start is allowed before verification", () => {
  assert.equal(canCancelAssignedTask(task({ status: "assigned", completion_percent: 1 })), false);
  assert.equal(canCancelOperationalTask(task({ status: "assigned", completion_percent: 1 })), true);
  assert.equal(canCancelOperationalTask(task({ status: "in_progress", completion_percent: 1 })), true);
});

test("case 9: operational cancellation is blocked for verification and approved work", () => {
  assert.equal(canCancelOperationalTask(task({ status: "under_review", completion_percent: 100 })), false);
  assert.equal(canCancelOperationalTask(task({ status: "closed", verification_status: "approved", approved_at: new Date() })), false);
});

test("additional design task approval never advances fixture workflow", () => {
  const fixtureContext = { fixture_id: "fixture-1", workflow_id: "workflow-1", current_stage_id: "stage-1" };

  assert.equal(shouldAdvanceFixtureWorkflow({ ...fixtureContext, task_type: "additional_design" }, "closed"), false);
  assert.equal(shouldAdvanceFixtureWorkflow({ ...fixtureContext, task_type: "department_workflow" }, "closed"), true);
  assert.equal(shouldAdvanceFixtureWorkflow({ ...fixtureContext, task_type: "department_workflow" }, "rework"), false);
});
test("low priority completion uses system auto-approval metadata instead of approval queue ownership", () => {
  const taskService = fs.readFileSync(path.join(__dirname, "..", "services", "taskService.js"), "utf8");

  assert.match(taskService, /approvalSource: "LOW_PRIORITY_POLICY"/);
  assert.match(taskService, /approvedByType: "SYSTEM"/);
  assert.match(taskService, /actionType: autoApproved[\s\S]*"task_auto_approved"/);
  assert.match(taskService, /approved_by: nextStatus === TASK_STATUSES\.CLOSED \? \(autoApproved \? null : user\.employee_id\) : task\.approved_by/);
  assert.match(taskService, /autoApprovedFromCompletion[\s\S]*approved_by: null/);
});