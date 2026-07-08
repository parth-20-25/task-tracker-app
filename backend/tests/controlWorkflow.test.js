const assert = require("node:assert/strict");
const test = require("node:test");

const {
  CONTROL_DESIGN_STAGES,
  CONTROL_SUB_DEPARTMENTS,
  REVISION_REASONS,
  STAGE_STATUSES,
  assertOtherReasonHasManualRemarks,
  calculateWorkflowProgress,
  canStartStage,
  canSubmitStage,
  createInitialStageRows,
  isApprovedForProgress,
  isTerminalStageStatus,
  nextUnlockedStage,
  normalizeControlKey,
  normalizeRevisionReason,
} = require("../lib/controlWorkflow");

function templateStages() {
  return CONTROL_DESIGN_STAGES.map((stageName, index) => ({
    id: `template-stage-${index + 1}`,
    stage_name: stageName,
    sequence_order: index + 1,
    is_required: true,
  }));
}

test("control department seed data includes Control Design and the configured stage order", () => {
  assert.deepEqual(CONTROL_SUB_DEPARTMENTS, [
    "Elec. Purchase",
    "Control Design",
    "PLC Programming",
    "Robo Programming",
    "Elec. Installation",
  ]);

  assert.deepEqual(CONTROL_DESIGN_STAGES, [
    "CO Creation",
    "ERP Budget Approval",
    "CO Release",
    "WBS Addition",
    "I/O List Preparation",
    "E-Plan Drawing Release",
    "Panel Material Issue",
    "Field Material Preparation",
    "Manual Preparation",
  ]);

  assert.equal(normalizeControlKey("E-Plan Drawing Release"), "e_plan_drawing_release");
});

test("new project workflow instances unlock only the first stage", () => {
  const rows = createInitialStageRows(templateStages());

  assert.equal(rows.length, 9);
  assert.equal(rows[0].stage_name, "CO Creation");
  assert.equal(rows[0].status, STAGE_STATUSES.NOT_STARTED);
  assert.equal(rows[1].status, STAGE_STATUSES.LOCKED);
  assert.equal(rows[8].stage_name, "Manual Preparation");
  assert.equal(rows[8].status, STAGE_STATUSES.LOCKED);
});

test("stage action helpers enforce sequential start and submit states", () => {
  assert.equal(canStartStage({ status: STAGE_STATUSES.NOT_STARTED }), true);
  assert.equal(canStartStage({ status: STAGE_STATUSES.REVISION_REQUIRED }), true);
  assert.equal(canStartStage({ status: STAGE_STATUSES.LOCKED }), false);
  assert.equal(canStartStage({ status: STAGE_STATUSES.SUBMITTED_FOR_APPROVAL }), false);

  assert.equal(canSubmitStage({ status: STAGE_STATUSES.IN_PROGRESS }), true);
  assert.equal(canSubmitStage({ status: STAGE_STATUSES.REVISION_REQUIRED }), true);
  assert.equal(canSubmitStage({ status: STAGE_STATUSES.NOT_STARTED }), false);
  assert.equal(canSubmitStage({ status: STAGE_STATUSES.APPROVED }), false);
});

test("workflow progress counts approved and pre-completed but not override-skipped stages", () => {
  const rows = createInitialStageRows(templateStages());
  rows[0].status = STAGE_STATUSES.APPROVED;
  rows[1].status = STAGE_STATUSES.PRE_COMPLETED;
  rows[2].status = STAGE_STATUSES.SKIPPED_BY_OVERRIDE;
  rows[3].status = STAGE_STATUSES.LOCKED;

  assert.equal(isApprovedForProgress(STAGE_STATUSES.PRE_COMPLETED), true);
  assert.equal(isApprovedForProgress(STAGE_STATUSES.SKIPPED_BY_OVERRIDE), false);
  assert.equal(isTerminalStageStatus(STAGE_STATUSES.SKIPPED_BY_OVERRIDE), true);
  assert.equal(nextUnlockedStage(rows).stage_name, "WBS Addition");

  assert.deepEqual(calculateWorkflowProgress(rows), {
    approved_or_pre_completed_stages: 2,
    skipped_by_override_stages: 1,
    total_required_stages: 9,
    percent: 22,
  });
});

test("revision reasons are constrained and Other requires manual remarks", () => {
  assert.equal(REVISION_REASONS.includes("Other"), true);
  assert.equal(normalizeRevisionReason("customer change"), "Customer Change");
  assert.equal(normalizeRevisionReason("unsupported reason"), null);

  assert.doesNotThrow(() => assertOtherReasonHasManualRemarks("Other", "legacy customer note"));
  assert.throws(
    () => assertOtherReasonHasManualRemarks("Other", ""),
    /manual_reason is required/,
  );
});