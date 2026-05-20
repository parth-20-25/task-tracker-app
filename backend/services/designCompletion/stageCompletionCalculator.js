const { normalizeDesignStageName } = require("../../lib/designWorkflowStages");
const { STAGE_STATUS_CREDIT } = require("../../config/designCompletionWeights");

function normalizeProgressStatus(status) {
  return String(status || "").trim().toUpperCase();
}

function resolveStageCreditFactor(status, stageVersion = 0) {
  const normalized = normalizeProgressStatus(status);
  const base = STAGE_STATUS_CREDIT[normalized];

  if (base === undefined) {
    return null;
  }

  if (normalized === "APPROVED" && Number(stageVersion) > 0) {
    return 1;
  }

  return base;
}

function computeStageCompletionTruth(progressRow, weightPercent) {
  const stageKey = normalizeDesignStageName(progressRow?.stage_name);
  const status = normalizeProgressStatus(progressRow?.status);
  const creditFactor = resolveStageCreditFactor(status, progressRow?.stage_version);

  if (creditFactor === null) {
    return {
      stage_key: stageKey,
      stage_name: progressRow?.stage_name || null,
      stage_order: progressRow?.stage_order ?? null,
      status,
      weight_percent: weightPercent,
      stage_completion_percent: null,
      earned_weight_percent: null,
      approval_state: "unknown",
      is_truth_complete: false,
      truth_error: `unsupported_status:${status || "empty"}`,
    };
  }

  const earned = Math.round(weightPercent * creditFactor * 100) / 100;
  let approvalState = "pending";

  if (status === "APPROVED") {
    approvalState = "approved";
  } else if (status === "REJECTED") {
    approvalState = "rejected";
  } else if (status === "IN_PROGRESS") {
    approvalState = "in_progress";
  } else if (status === "COMPLETED") {
    approvalState = "submitted";
  } else if (status === "PENDING") {
    approvalState = "pending";
  }

  return {
    stage_key: stageKey,
    stage_name: progressRow?.stage_name || null,
    stage_order: progressRow?.stage_order ?? null,
    stage_version: Number(progressRow?.stage_version || 0),
    status,
    weight_percent: weightPercent,
    stage_completion_percent: earned,
    earned_weight_percent: earned,
    approval_state: approvalState,
    is_truth_complete: status === "APPROVED",
    truth_error: null,
  };
}

module.exports = {
  computeStageCompletionTruth,
  normalizeProgressStatus,
  resolveStageCreditFactor,
};
