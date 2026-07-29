const assert = require("node:assert/strict");
const test = require("node:test");

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://user:pass@localhost:5432/tasktracker_test";

const { PERMISSIONS } = require("../config/constants");
const {
  canUpdateTaskProof,
  ensureTaskProofUpdateAllowed,
} = require("../services/taskService");

function user(overrides = {}) {
  return { id: "user-primary", employee_id: "EMP-PRIMARY", is_active: true, permissions: [PERMISSIONS.UPLOAD_PROOFS], ...overrides };
}

function task(overrides = {}) {
  return {
    id: 1,
    status: "in_progress",
    assigned_to: "EMP-PRIMARY",
    assigned_user_id: "EMP-PRIMARY",
    assignee_ids: ["EMP-PRIMARY"],
    proof_assignee_user_ids: ["user-primary"],
    ...overrides,
  };
}

test("primary assignee can upload and remove proof by canonical user id", async () => {
  const actor = user();
  const assignedTask = task();

  assert.equal(await canUpdateTaskProof(actor, assignedTask), true);
  await assert.doesNotReject(() => ensureTaskProofUpdateAllowed(actor, assignedTask));
});

test("additional assignee can upload proof by canonical user id", async () => {
  const actor = user({ id: "user-additional", employee_id: "EMP-ADDITIONAL" });
  const assignedTask = task({
    assignee_ids: ["EMP-PRIMARY", "EMP-ADDITIONAL"],
    proof_assignee_user_ids: ["user-primary", "user-additional"],
  });

  assert.equal(await canUpdateTaskProof(actor, assignedTask), true);
  await assert.doesNotReject(() => ensureTaskProofUpdateAllowed(actor, assignedTask));
});

test("unassigned users are blocked even when their employee id appears in legacy assignment data", async () => {
  const actor = user({ id: "user-unassigned", employee_id: "EMP-ADDITIONAL" });
  const assignedTask = task({
    assignee_ids: ["EMP-PRIMARY", "EMP-ADDITIONAL"],
    proof_assignee_user_ids: ["user-primary"],
  });

  assert.equal(await canUpdateTaskProof(actor, assignedTask), false);
  await assert.rejects(() => ensureTaskProofUpdateAllowed(actor, assignedTask), { statusCode: 403 });
});

test("proof authorization never compares an employee id to an internal user id", async () => {
  const actor = user({ id: "user-primary", employee_id: "EMP-PRIMARY" });

  assert.equal(await canUpdateTaskProof(actor, task({ proof_assignee_user_ids: ["EMP-PRIMARY"] })), false);
  assert.equal(await canUpdateTaskProof(actor, task({ proof_assignee_user_ids: ["user-primary"] })), true);
});

test("completed and approved tasks keep their proof lock", async () => {
  const actor = user();
  const completedTask = task({ status: "closed", verification_status: "approved", approved_at: new Date().toISOString() });

  assert.equal(await canUpdateTaskProof(actor, completedTask), false);
  await assert.rejects(() => ensureTaskProofUpdateAllowed(actor, completedTask), { statusCode: 409 });
});
test("Design 3D workflow DAP keeps proof upload authorized even though proof is not required", async () => {
  const actor = user();
  const dapTask = task({
    task_type: "department_workflow",
    workflow_stage: "DAP",
    proof_required: true,
  });
  assert.equal(await canUpdateTaskProof(actor, dapTask), true);
  await assert.doesNotReject(() => ensureTaskProofUpdateAllowed(actor, dapTask));
});