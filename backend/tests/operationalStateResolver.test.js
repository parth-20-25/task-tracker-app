const assert = require("node:assert/strict");
const test = require("node:test");

const {
  OPERATIONAL_STATES,
  resolveFixtureOperationalState,
} = require("../services/operationalStateResolver");

function task(overrides = {}) {
  return {
    id: 1,
    status: "assigned",
    verification_status: "pending",
    completion_percent: 0,
    assigned_to: "EMP1",
    ...overrides,
  };
}

function progress(overrides = {}) {
  return {
    status: "PENDING",
    assigned_to: null,
    ...overrides,
  };
}

test("case 1: no task and no workflow assignment resolves only unassigned", () => {
  assert.equal(
    resolveFixtureOperationalState({ task: null, progress: progress() }),
    OPERATIONAL_STATES.UNASSIGNED,
  );
});

test("case 2: assigned active task at zero percent resolves assigned", () => {
  assert.equal(
    resolveFixtureOperationalState({ task: task({ completion_percent: 0 }), progress: progress({ status: "IN_PROGRESS", assigned_to: "EMP1" }) }),
    OPERATIONAL_STATES.ASSIGNED,
  );
});

test("case 3: assigned active task above zero resolves in progress", () => {
  assert.equal(
    resolveFixtureOperationalState({ task: task({ status: "in_progress", completion_percent: 40 }), progress: progress({ status: "IN_PROGRESS", assigned_to: "EMP1" }) }),
    OPERATIONAL_STATES.IN_PROGRESS,
  );
});

test("case 4: submitted or under-review work resolves verification", () => {
  assert.equal(
    resolveFixtureOperationalState({ task: task({ status: "under_review", completion_percent: 100 }), progress: progress({ status: "IN_PROGRESS", assigned_to: "EMP1" }) }),
    OPERATIONAL_STATES.VERIFICATION,
  );
  assert.equal(
    resolveFixtureOperationalState({ task: null, progress: progress({ status: "SUBMITTED_FOR_VERIFICATION", assigned_to: "EMP1" }) }),
    OPERATIONAL_STATES.VERIFICATION,
  );
});

test("case 5: approved workflow with no active task resolves workflow complete", () => {
  assert.equal(
    resolveFixtureOperationalState({ task: null, progress: progress({ status: "APPROVED" }), workflowComplete: true }),
    OPERATIONAL_STATES.WORKFLOW_COMPLETE,
  );
});

test("case 6: rejected task or workflow resolves rework", () => {
  assert.equal(
    resolveFixtureOperationalState({ task: task({ status: "rework", completion_percent: 100 }), progress: progress({ status: "IN_PROGRESS", assigned_to: "EMP1" }) }),
    OPERATIONAL_STATES.REWORK,
  );
  assert.equal(
    resolveFixtureOperationalState({ task: null, progress: progress({ status: "REJECTED", assigned_to: "EMP1" }) }),
    OPERATIONAL_STATES.REWORK,
  );
});

test("case 7: manual workflow override remains consistent with workflow occupancy", () => {
  assert.equal(
    resolveFixtureOperationalState({ task: null, progress: progress({ status: "IN_PROGRESS", assigned_to: "EMP2" }) }),
    OPERATIONAL_STATES.ASSIGNED,
  );
  assert.equal(
    resolveFixtureOperationalState({ task: null, progress: progress({ status: "PENDING", assigned_to: null }) }),
    OPERATIONAL_STATES.UNASSIGNED,
  );
});

test("case 8: transferred ownership follows the active task owner state", () => {
  assert.equal(
    resolveFixtureOperationalState({ task: task({ status: "assigned", assigned_to: "EMP2", completion_percent: 0 }), progress: progress({ status: "IN_PROGRESS", assigned_to: "EMP2" }) }),
    OPERATIONAL_STATES.ASSIGNED,
  );
});

test("case 9: assign-all eligibility is exactly the unassigned unoccupied resolver state", () => {
  const cases = [
    { expectedAssignable: true, state: resolveFixtureOperationalState({ task: null, progress: progress() }) },
    { expectedAssignable: false, state: resolveFixtureOperationalState({ task: task(), progress: progress({ status: "IN_PROGRESS", assigned_to: "EMP1" }) }) },
    { expectedAssignable: false, state: resolveFixtureOperationalState({ task: null, progress: progress({ status: "IN_PROGRESS", assigned_to: "EMP1" }) }) },
  ];

  assert.deepEqual(
    cases.map((item) => item.state === OPERATIONAL_STATES.UNASSIGNED),
    cases.map((item) => item.expectedAssignable),
  );
});
