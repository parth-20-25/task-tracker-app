const { PROJECT_STATUSES } = require("../../config/constants");
const { COMPLETION_TRUTH_STATUSES } = require("../../config/designCompletionWeights");
const { normalizeDesignStageName } = require("../../lib/designWorkflowStages");
const { buildWeightMapForStageKeys, resolveStageKeysFromProgress } = require("./stageWeightModel");
const { computeStageCompletionTruth, normalizeProgressStatus } = require("./stageCompletionCalculator");

function indexProgressByStageKey(progressRows = []) {
  const map = new Map();

  for (const row of progressRows) {
    const key = normalizeDesignStageName(row.stage_name);
    if (!key || map.has(key)) {
      continue;
    }
    map.set(key, row);
  }

  return map;
}

function detectActiveRework({ progressRows = [], revisionNo = 0, isWorkflowComplete = false }) {
  if (isWorkflowComplete) {
    return false;
  }

  const hasReopenedStage = progressRows.some(
    (row) => Number(row.stage_version || 0) > 0 && normalizeProgressStatus(row.status) !== "APPROVED",
  );

  return Number(revisionNo) > 0 || hasReopenedStage;
}

function buildSourceCounts(fixtureBundle) {
  return {
    fixture_workflow_progress: Array.isArray(fixtureBundle.progress_rows) ? fixtureBundle.progress_rows.length : 0,
    tasks: Array.isArray(fixtureBundle.task_rows) ? fixtureBundle.task_rows.length : 0,
    task_attachments: Array.isArray(fixtureBundle.task_attachment_rows) ? fixtureBundle.task_attachment_rows.length : 0,
    fixture_workflow_stage_attempts: Array.isArray(fixtureBundle.stage_attempt_rows) ? fixtureBundle.stage_attempt_rows.length : 0,
    contributions: Array.isArray(fixtureBundle.contribution_rows) ? fixtureBundle.contribution_rows.length : 0,
  };
}

function computeFixtureCompletionTruth(fixtureBundle, options = {}) {
  const {
    progress_rows: progressRows = [],
    workflow_stages: workflowStages = [],
    weight_rows: weightRows = [],
    project_status: projectStatus = PROJECT_STATUSES.ACTIVE,
  } = fixtureBundle;

  const stageKeys = resolveStageKeysFromProgress(progressRows, workflowStages);
  const weightMap = buildWeightMapForStageKeys(stageKeys, weightRows);
  const progressByKey = indexProgressByStageKey(progressRows);

  const missingStages = stageKeys.filter((key) => !progressByKey.has(key));
  if (missingStages.length > 0) {
    return {
      fixture_id: fixtureBundle.fixture_id,
      fixture_no: fixtureBundle.fixture_no,
      project_id: fixtureBundle.project_id,
      completion_percent: null,
      truth_status: COMPLETION_TRUTH_STATUSES.INCOMPLETE_TRUTH,
      strict_complete: false,
      is_required_for_project_kpi: fixtureBundle.is_required_for_project_kpi !== false,
      is_outsourced: Boolean(fixtureBundle.is_outsourced),
      has_active_rework: false,
      has_unresolved_reject: false,
      has_blocking_hold: projectStatus === PROJECT_STATUSES.ON_HOLD,
      all_required_stages_approved: false,
      current_stage_key: null,
      current_approval_state: null,
      stages: [],
      truth_errors: [`missing_progress:${missingStages.join(",")}`],
      source_counts: buildSourceCounts(fixtureBundle),
    };
  }

  const stageTruths = [];
  const truthErrors = [];
  let earnedTotal = 0;
  let hasUnresolvedReject = false;
  let hasUnknownStatus = false;
  let allApproved = true;

  for (const stageKey of stageKeys) {
    const progressRow = progressByKey.get(stageKey);
    const weight = weightMap.get(stageKey) || 0;
    const stageTruth = computeStageCompletionTruth(progressRow, weight);

    if (stageTruth.truth_error) {
      hasUnknownStatus = true;
      truthErrors.push(`${stageKey}:${stageTruth.truth_error}`);
    }

    if (stageTruth.approval_state === "rejected") {
      hasUnresolvedReject = true;
    }

    if (!stageTruth.is_truth_complete) {
      allApproved = false;
    }

    if (stageTruth.earned_weight_percent !== null) {
      earnedTotal += stageTruth.earned_weight_percent;
    }

    stageTruths.push(stageTruth);
  }

  const currentStage = stageTruths.find((stage) => !stage.is_truth_complete) || null;
  const hasActiveRework = detectActiveRework({
    progressRows,
    revisionNo: fixtureBundle.revision_no,
    isWorkflowComplete: fixtureBundle.is_workflow_complete,
  });

  if (hasUnknownStatus) {
    return {
      fixture_id: fixtureBundle.fixture_id,
      fixture_no: fixtureBundle.fixture_no,
      project_id: fixtureBundle.project_id,
      completion_percent: null,
      truth_status: COMPLETION_TRUTH_STATUSES.INCOMPLETE_TRUTH,
      strict_complete: false,
      is_required_for_project_kpi: fixtureBundle.is_required_for_project_kpi !== false,
      is_outsourced: Boolean(fixtureBundle.is_outsourced),
      has_active_rework: hasActiveRework,
      has_unresolved_reject: hasUnresolvedReject,
      has_blocking_hold: projectStatus === PROJECT_STATUSES.ON_HOLD,
      all_required_stages_approved: false,
      current_stage_key: currentStage?.stage_key || null,
      current_approval_state: currentStage?.approval_state || null,
      stages: stageTruths,
      truth_errors: truthErrors,
      source_counts: buildSourceCounts(fixtureBundle),
    };
  }

  const roundedPercent = Math.round(earnedTotal * 100) / 100;
  const strictComplete = allApproved
    && !hasUnresolvedReject
    && !hasActiveRework
    && projectStatus !== PROJECT_STATUSES.ON_HOLD
    && (fixtureBundle.is_workflow_complete === true || roundedPercent >= 100);

  let completionPercent = roundedPercent;
  if (strictComplete) {
    completionPercent = 100;
  } else if (hasActiveRework || hasUnresolvedReject) {
    completionPercent = Math.min(completionPercent, 99.99);
  }

  let truthStatus = COMPLETION_TRUTH_STATUSES.COMPLETE;
  if (projectStatus === PROJECT_STATUSES.ON_HOLD) {
    truthStatus = COMPLETION_TRUTH_STATUSES.DEGRADED;
  } else if (!strictComplete) {
    truthStatus = hasActiveRework || hasUnresolvedReject
      ? COMPLETION_TRUTH_STATUSES.DEGRADED
      : COMPLETION_TRUTH_STATUSES.COMPLETE;
  }

  return {
    fixture_id: fixtureBundle.fixture_id,
    fixture_no: fixtureBundle.fixture_no,
    project_id: fixtureBundle.project_id,
    completion_percent: completionPercent,
    truth_status: truthStatus,
    strict_complete: strictComplete,
    is_required_for_project_kpi: fixtureBundle.is_required_for_project_kpi !== false,
    is_outsourced: Boolean(fixtureBundle.is_outsourced),
    has_active_rework: hasActiveRework,
    has_unresolved_reject: hasUnresolvedReject,
    has_blocking_hold: projectStatus === PROJECT_STATUSES.ON_HOLD,
    all_required_stages_approved: allApproved,
    current_stage_key: currentStage?.stage_key || null,
    current_approval_state: currentStage?.approval_state || null,
    stages: stageTruths,
    truth_errors: truthErrors,
    source_counts: buildSourceCounts(fixtureBundle),
  };
}

module.exports = {
  computeFixtureCompletionTruth,
  detectActiveRework,
};
