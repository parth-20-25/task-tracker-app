const { COMPLETION_TRUTH_STATUSES } = require("../../config/designCompletionWeights");

const STATUS_LABELS = {
  CLOSED: "Closed",
  ON_HOLD: "On Hold",
  OVERDUE: "Overdue",
  REWORK: "Rework",
  ASSIGNED: "Assigned",
  IN_PROGRESS: "In Progress",
  REVIEW: "Review",
};

function resolveFixtureGlobalStatus(fixtureTruth, fixtureRow) {
  if (fixtureTruth?.strict_complete) {
    return STATUS_LABELS.CLOSED;
  }

  if (fixtureTruth?.has_blocking_hold || fixtureRow?.task_status === "on_hold") {
    return STATUS_LABELS.ON_HOLD;
  }

  if (fixtureTruth?.has_unresolved_reject || fixtureTruth?.has_active_rework) {
    return STATUS_LABELS.REWORK;
  }

  if (fixtureRow?.task_deadline) {
    const deadlineDate = new Date(fixtureRow.task_deadline);
    if (!Number.isNaN(deadlineDate.getTime()) && deadlineDate.getTime() < Date.now()) {
      return STATUS_LABELS.OVERDUE;
    }
  }

  if (fixtureRow?.task_status === "under_review") {
    return STATUS_LABELS.REVIEW;
  }

  if (fixtureRow?.task_status === "in_progress" || fixtureTruth?.current_approval_state === "in_progress") {
    return STATUS_LABELS.IN_PROGRESS;
  }

  return STATUS_LABELS.ASSIGNED;
}

/**
 * Project KPI header values for the execution report template.
 * Uses designCompletionEngine project truth only — no report-layer math.
 */
function resolveReportKpisFromCompletionTruth(projectTruth, fixtureRows = []) {
  if (!projectTruth) {
    return {
      ok: false,
      error: "project completion truth is unavailable",
    };
  }

  if (projectTruth.truth_status === COMPLETION_TRUTH_STATUSES.INCOMPLETE_TRUTH
    || projectTruth.completion_percent === null) {
    return {
      ok: false,
      error: "project completion truth is incomplete",
      truth_errors: projectTruth.truth_errors || [],
    };
  }

  const fixtureTruthById = new Map(
    (projectTruth.fixtures || []).map((truth) => [String(truth.fixture_id), truth]),
  );

  const statusCounts = {
    completed: 0,
    pending: 0,
    overdue: 0,
    onHold: 0,
    rejected: 0,
  };

  fixtureRows.forEach((row) => {
    const truth = fixtureTruthById.get(String(row.fixture_id));
    const globalStatus = resolveFixtureGlobalStatus(truth, row);

    if (globalStatus === STATUS_LABELS.CLOSED) {
      statusCounts.completed += 1;
    } else if ([STATUS_LABELS.ASSIGNED, STATUS_LABELS.IN_PROGRESS, STATUS_LABELS.REVIEW].includes(globalStatus)) {
      statusCounts.pending += 1;
    } else if (globalStatus === STATUS_LABELS.OVERDUE) {
      statusCounts.overdue += 1;
    } else if (globalStatus === STATUS_LABELS.ON_HOLD) {
      statusCounts.onHold += 1;
    } else if (globalStatus === STATUS_LABELS.REWORK) {
      statusCounts.rejected += 1;
    }
  });

  const totalFixtures = fixtureRows.length;
  const overallPercent = projectTruth.strict_complete
    ? 100
    : Number(projectTruth.completion_percent || 0);

  return {
    ok: true,
    kpis: {
      overallProgress: `${Math.round(overallPercent)}%`,
      totalFixtures,
      completed: statusCounts.completed,
      pending: statusCounts.pending,
      overdue: statusCounts.overdue,
      onHold: statusCounts.onHold,
      rejected: statusCounts.rejected,
    },
  };
}

module.exports = {
  STATUS_LABELS,
  resolveFixtureGlobalStatus,
  resolveReportKpisFromCompletionTruth,
};
