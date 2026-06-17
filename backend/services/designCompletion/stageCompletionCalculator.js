const { normalizeDesignStageName } = require("../../lib/designWorkflowStages");
const SUPPORTED_PROGRESS_STATUSES = new Set([
  "PENDING",
  "IN_PROGRESS",
  "SUBMITTED_FOR_VERIFICATION",
  "COMPLETED",
  "REJECTED",
  "APPROVED",
]);

function normalizeProgressStatus(status) {
  return String(status || "").trim().toUpperCase();
}

function normalizeTrackedProgress(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const percent = Number(value);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    return null;
  }

  return Math.round(percent * 100) / 100;
}

function computeStageCompletionTruth(progressRow, weightPercent, options = {}) {
  const stageKey = normalizeDesignStageName(progressRow?.stage_name);
  const status = normalizeProgressStatus(progressRow?.status);
  const trackedProgressPercent = normalizeTrackedProgress(options.trackedProgressPercent);

  if (!SUPPORTED_PROGRESS_STATUSES.has(status)) {
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

  let stageProgressPercent = null;
  let approvalState = "pending";

  if (status === "APPROVED") {
    approvalState = "approved";
    stageProgressPercent = 100;
  } else if (status === "REJECTED") {
    approvalState = "rejected";
    stageProgressPercent = 0;
  } else if (status === "IN_PROGRESS") {
    approvalState = "in_progress";
    stageProgressPercent = trackedProgressPercent;
  } else if (status === "COMPLETED" || status === "SUBMITTED_FOR_VERIFICATION") {
    approvalState = "submitted";
    stageProgressPercent = trackedProgressPercent;
  } else if (status === "PENDING") {
    approvalState = "pending";
    stageProgressPercent = 0;
  }

  if (stageProgressPercent === null) {
    return {
      stage_key: stageKey,
      stage_name: progressRow?.stage_name || null,
      stage_order: progressRow?.stage_order ?? null,
      stage_version: Number(progressRow?.stage_version || 0),
      status,
      weight_percent: weightPercent,
      stage_completion_percent: null,
      earned_weight_percent: null,
      approval_state: approvalState,
      is_truth_complete: false,
      truth_error: `missing_tracked_progress:${stageKey || "unknown"}`,
    };
  }

  const earned = Math.round(weightPercent * (stageProgressPercent / 100) * 100) / 100;

  return {
    stage_key: stageKey,
    stage_name: progressRow?.stage_name || null,
    stage_order: progressRow?.stage_order ?? null,
    stage_version: Number(progressRow?.stage_version || 0),
    status,
    weight_percent: weightPercent,
    stage_completion_percent: stageProgressPercent,
    earned_weight_percent: earned,
    approval_state: approvalState,
    is_truth_complete: status === "APPROVED",
    truth_error: null,
  };
}

module.exports = {
  computeStageCompletionTruth,
  normalizeTrackedProgress,
  normalizeProgressStatus,
};
