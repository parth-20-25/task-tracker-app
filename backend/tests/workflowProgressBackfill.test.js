const assert = require("node:assert/strict");
const test = require("node:test");

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://user:pass@localhost:5432/tasktracker_test";

const {
  resolveBackfillCandidate,
} = require("../services/designCompletion/workflowProgressBackfillService");

test("backfill reconstructs a missing row from an approved task", () => {
  const candidate = resolveBackfillCandidate({
    progress_rows: [],
    task_rows: [{
      task_id: 10,
      stage_name: "DAP",
      status: "closed",
      approved_at: "2026-05-01T10:00:00Z",
      assigned_to: "501",
    }],
  }, { name: "DAP", order: 2 });

  assert.equal(candidate.action, "insert");
  assert.equal(candidate.status, "APPROVED");
  assert.deepEqual(candidate.evidence.tasks, [10]);
});

test("backfill returns a precise unresolved reason without evidence", () => {
  const candidate = resolveBackfillCandidate({
    progress_rows: [],
    task_rows: [],
    stage_attempt_rows: [],
    revision_rows: [],
    transition_rows: [],
    outsource_rows: [],
  }, { name: "3D Finish", order: 3 });

  assert.equal(candidate.action, "unresolved");
  assert.equal(candidate.reason, "no_real_evidence:3d_finish");
});

test("backfill refuses conflicting approval and rejection evidence", () => {
  const candidate = resolveBackfillCandidate({
    progress_rows: [],
    task_rows: [{
      task_id: 11,
      stage_name: "Concept",
      status: "closed",
      approved_at: "2026-05-01T10:00:00Z",
    }],
    stage_attempt_rows: [{
      id: "attempt-1",
      stage_name: "Concept",
      status: "REJECTED",
    }],
  }, { name: "Concept", order: 1 });

  assert.equal(candidate.action, "unresolved");
  assert.match(candidate.reason, /^conflicting_terminal_evidence:concept:/);
});
