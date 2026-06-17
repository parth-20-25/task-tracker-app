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
    revisions: Array.isArray(fixtureBundle.revision_rows) ? fixtureBundle.revision_rows.length : 0,
    transitions: Array.isArray(fixtureBundle.transition_rows) ? fixtureBundle.transition_rows.length : 0,
    outsourcing: Array.isArray(fixtureBundle.outsource_rows) ? fixtureBundle.outsource_rows.length : 0,
  };
}

function stageKeyFromRow(row) {
  return normalizeDesignStageName(row?.stage_name || row?.stage || row?.name);
}

function hasSubstantiveProgress(row) {
  const status = normalizeProgressStatus(row?.status);
  return status !== "PENDING"
    || Boolean(row?.assigned_to || row?.assigned_at || row?.started_at || row?.completed_at);
}

function collectEvidenceStageKeys(fixtureBundle) {
  const keys = new Set();
  const sources = [
    fixtureBundle.task_rows,
    fixtureBundle.stage_attempt_rows,
    fixtureBundle.contribution_rows,
    fixtureBundle.revision_rows,
    fixtureBundle.transition_rows,
    fixtureBundle.outsource_rows,
  ];

  for (const rows of sources) {
    for (const row of Array.isArray(rows) ? rows : []) {
      const key = stageKeyFromRow(row)
        || normalizeDesignStageName(row?.from_stage_name)
        || normalizeDesignStageName(row?.to_stage_name);
      if (key) {
        keys.add(key);
      }
    }
  }

  for (const row of fixtureBundle.progress_rows || []) {
    if (hasSubstantiveProgress(row)) {
      const key = stageKeyFromRow(row);
      if (key) {
        keys.add(key);
      }
    }
  }

  return keys;
}

function resolveApplicableStageKeys(fixtureBundle) {
  const progressRows = fixtureBundle.progress_rows || [];
  const configuredKeys = resolveStageKeysFromProgress(progressRows, fixtureBundle.workflow_stages || []);
  const evidenceKeys = collectEvidenceStageKeys(fixtureBundle);
  const progressKeys = new Set(progressRows.map(stageKeyFromRow).filter(Boolean));
  const orderedKeys = [...new Set([...configuredKeys, ...evidenceKeys])];
  const lastEvidenceIndex = orderedKeys.reduce(
    (latest, key, index) => (evidenceKeys.has(key) ? index : latest),
    -1,
  );
  const skippedStageKeys = [];

  const applicableStageKeys = orderedKeys.filter((key, index) => {
    if (key === "release" && !progressKeys.has(key) && !evidenceKeys.has(key)) {
      return false;
    }

    if (index < lastEvidenceIndex && !evidenceKeys.has(key)) {
      skippedStageKeys.push(key);
      return false;
    }

    return true;
  });

  return {
    applicableStageKeys,
    skippedStageKeys,
    evidenceStageKeys: [...evidenceKeys],
  };
}

function resolveTrackedStageProgress(stageKey, taskRows = []) {
  const matching = taskRows.filter((row) => stageKeyFromRow(row) === stageKey);
  const recorded = matching
    .map((row) => row.completion_percent)
    .filter((value) => value !== null && value !== undefined && value !== "")
    .map(Number)
    .filter((value) => Number.isFinite(value) && value >= 0 && value <= 100);

  if (!recorded.length) {
    return { percent: null, error: `missing_task_progress:${stageKey}` };
  }

  const unique = [...new Set(recorded.map((value) => Math.round(value * 100) / 100))];
  if (unique.length > 1 && matching.filter((row) => normalizeProgressStatus(row.status) === "IN_PROGRESS").length > 1) {
    return { percent: null, error: `ambiguous_task_progress:${stageKey}` };
  }

  return { percent: unique[unique.length - 1], error: null };
}

function resolveEffectiveProgressRow(stageKey, progressRow, fixtureBundle) {
  const attempts = (fixtureBundle.stage_attempt_rows || []).filter(
    (row) => stageKeyFromRow(row) === stageKey,
  );
  const latestAttempt = attempts[attempts.length - 1] || null;
  const taskApproved = (fixtureBundle.task_rows || []).some((row) => (
    stageKeyFromRow(row) === stageKey
    && (row.approved_at || row.closed_at || String(row.status || "").toLowerCase() === "closed")
  ));
  const outsourceCompleted = (fixtureBundle.outsource_rows || []).some((row) => (
    stageKeyFromRow(row) === stageKey && row.outsource_status === "completed"
  ));
  const attemptStatus = normalizeProgressStatus(latestAttempt?.status);

  if (outsourceCompleted || taskApproved || attemptStatus === "APPROVED") {
    return { ...progressRow, status: "APPROVED" };
  }
  if (attemptStatus === "REJECTED") {
    return { ...progressRow, status: "REJECTED" };
  }
  return progressRow;
}

function computeFixtureCompletionTruth(fixtureBundle, options = {}) {
  const {
    progress_rows: progressRows = [],
    workflow_stages: workflowStages = [],
    weight_rows: weightRows = [],
    project_status: projectStatus = PROJECT_STATUSES.ACTIVE,
  } = fixtureBundle;

  const applicability = resolveApplicableStageKeys(fixtureBundle);
  const stageKeys = applicability.applicableStageKeys;
  const weightMap = buildWeightMapForStageKeys(stageKeys, weightRows);
  const progressByKey = indexProgressByStageKey(progressRows);

  const missingStages = stageKeys.filter((key) => !progressByKey.has(key));
  if (fixtureBundle.is_workflow_complete === true) {
    return {
      fixture_id: fixtureBundle.fixture_id,
      fixture_no: fixtureBundle.fixture_no,
      project_id: fixtureBundle.project_id,
      completion_percent: 100,
      truth_status: COMPLETION_TRUTH_STATUSES.COMPLETE,
      strict_complete: true,
      is_required_for_project_kpi: fixtureBundle.is_required_for_project_kpi !== false,
      is_outsourced: Boolean(fixtureBundle.is_outsourced),
      has_active_rework: false,
      has_unresolved_reject: false,
      has_blocking_hold: false,
      all_required_stages_approved: true,
      current_stage_key: null,
      current_approval_state: "approved",
      stages: [],
      truth_errors: [],
      diagnostic_warnings: missingStages.map(
        (stageKey) => `completed_fixture_missing_progress:${stageKey}`,
      ),
      applicable_stage_keys: stageKeys,
      skipped_stage_keys: applicability.skippedStageKeys,
      source_counts: buildSourceCounts(fixtureBundle),
    };
  }

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
      truth_errors: missingStages.map((stageKey) => `missing_progress:${stageKey}:evidence_exists_without_progress_row`),
      applicable_stage_keys: stageKeys,
      skipped_stage_keys: applicability.skippedStageKeys,
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
    const progressRow = resolveEffectiveProgressRow(
      stageKey,
      progressByKey.get(stageKey),
      fixtureBundle,
    );
    const weight = weightMap.get(stageKey) || 0;
    const tracked = resolveTrackedStageProgress(stageKey, fixtureBundle.task_rows || []);
    const stageTruth = computeStageCompletionTruth(progressRow, weight, {
      trackedProgressPercent: tracked.percent,
    });

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
      applicable_stage_keys: stageKeys,
      skipped_stage_keys: applicability.skippedStageKeys,
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
    applicable_stage_keys: stageKeys,
    skipped_stage_keys: applicability.skippedStageKeys,
    source_counts: buildSourceCounts(fixtureBundle),
  };
}

module.exports = {
  collectEvidenceStageKeys,
  computeFixtureCompletionTruth,
  detectActiveRework,
  resolveApplicableStageKeys,
  resolveEffectiveProgressRow,
  resolveTrackedStageProgress,
};
