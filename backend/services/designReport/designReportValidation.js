const { AppError } = require("../../lib/AppError");
const { normalizeDesignStageName } = require("../../lib/designWorkflowStages");
const {
  formatStageRevisionCode,
  normalizeStageVersion,
} = require("../../lib/workflowStageVersioning");
const { COMPLETION_TRUTH_STATUSES } = require("../../config/designCompletionWeights");
const { resolveReportKpisFromCompletionTruth } = require("./designReportKpiContract");

const DESIGN_REPORT_TRUTH_LAYER_ERROR =
  "Design Project Execution report export is disabled until the Design truth layer is complete.";

const REPORT_STAGES = [
  { key: "concept", label: "CONCEPT" },
  { key: "dap", label: "DAP" },
  { key: "three_d_finish", label: "3D FINISH" },
  { key: "two_d_finish", label: "2D FINISH" },
];

const VALID_WORKFLOW_STATUSES = new Set(["PENDING", "IN_PROGRESS", "COMPLETED", "APPROVED", "REJECTED"]);
const ACTIVE_CONTRIBUTION_STATUSES = new Set(["IN_PROGRESS", "COMPLETED", "APPROVED"]);

function normalizeStatus(value) {
  return String(value || "").trim().toUpperCase();
}

function getStageBucket(stageName) {
  const stageKey = normalizeDesignStageName(stageName);
  if (!stageKey) {
    return null;
  }

  if (stageKey === "3d_finish") {
    return "three_d_finish";
  }

  if (stageKey === "2d_finish") {
    return "two_d_finish";
  }

  return stageKey;
}

function getProgressByStage(progressRows) {
  return progressRows.reduce((map, row) => {
    const stageKey = getStageBucket(row.stage_name);
    if (!stageKey) {
      return map;
    }

    const rows = map.get(stageKey) || [];
    rows.push(row);
    map.set(stageKey, rows);
    return map;
  }, new Map());
}

function buildProgressLookup(progressRows) {
  return progressRows.reduce((map, row) => {
    const key = String(row.fixture_id);
    const rows = map.get(key) || [];
    rows.push(row);
    map.set(key, rows);
    return map;
  }, new Map());
}

function buildAttemptLookup(attemptRows) {
  return attemptRows.reduce((map, row) => {
    const fixtureKey = String(row.fixture_id);
    const fixtureAttempts = map.get(fixtureKey) || new Map();
    const stageKey = getStageBucket(row.stage_name);

    if (!stageKey) {
      map.set(fixtureKey, fixtureAttempts);
      return map;
    }

    const attempts = fixtureAttempts.get(stageKey) || [];
    attempts.push(row);
    fixtureAttempts.set(stageKey, attempts);
    map.set(fixtureKey, fixtureAttempts);
    return map;
  }, new Map());
}

function buildContributionLookup(contributions) {
  return contributions.reduce((map, contribution) => {
    const revisionCode = contribution.revision_code
      || formatStageRevisionCode(contribution.stage_name, normalizeStageVersion(contribution.stage_revision_no));
    const key = `${contribution.fixture_id}::${contribution.stage_name}::${revisionCode}`;
    const entries = map.get(key) || [];
    entries.push(contribution);
    map.set(key, entries);
    return map;
  }, new Map());
}

function buildRevisionLookup(revisions) {
  return revisions.reduce((map, revision) => {
    const stageKey = normalizeDesignStageName(revision.stage_name);
    const version = normalizeStageVersion(revision.stage_version);
    const key = `${revision.fixture_id}::${stageKey}::${version}`;
    if (!map.has(key)) {
      map.set(key, revision);
    }
    return map;
  }, new Map());
}

function getAttemptActualEnd(attempt, progressStatus) {
  const attemptStatus = normalizeStatus(attempt.status);
  const status = attemptStatus || progressStatus;

  if (status === "APPROVED") {
    return attempt.completed_at || attempt.approved_at || null;
  }

  if (status === "COMPLETED") {
    return attempt.completed_at || null;
  }

  if (status === "REJECTED") {
    return attempt.completed_at || attempt.updated_at || null;
  }

  return null;
}

function validateFixtureWorkflow(fixture, fixtureProgressRows, progressByStage) {
  if (!fixtureProgressRows.length) {
    return "missing workflow linkage";
  }

  const duplicateStages = [];
  progressByStage.forEach((rows, stageKey) => {
    if (rows.length > 1) {
      duplicateStages.push(stageKey);
    }
  });

  if (duplicateStages.length > 0) {
    return `duplicate workflow progress rows (${duplicateStages.join(", ")})`;
  }

  const missingStages = REPORT_STAGES
    .filter((stage) => !progressByStage.has(stage.key))
    .map((stage) => stage.label);

  if (missingStages.length > 0) {
    return `missing workflow progress rows (${missingStages.join(", ")})`;
  }

  const firstOpenIndex = REPORT_STAGES.findIndex(
    (stage) => normalizeStatus(progressByStage.get(stage.key)?.[0]?.status) !== "APPROVED",
  );

  if (firstOpenIndex >= 0) {
    const approvedAfterCurrent = REPORT_STAGES
      .slice(firstOpenIndex + 1)
      .filter((stage) => normalizeStatus(progressByStage.get(stage.key)?.[0]?.status) === "APPROVED")
      .map((stage) => stage.label);

    if (approvedAfterCurrent.length > 0) {
      return `future stage approved before current stage (${approvedAfterCurrent.join(", ")})`;
    }
  }

  return null;
}

function collectDesignReportTruthLayerErrors({
  fixtures = [],
  progressRows = [],
  attemptRows = [],
  contributions = [],
  revisions = [],
  projectTruth = null,
  outsourcedFixtureIds = new Set(),
} = {}) {
  const progressLookup = buildProgressLookup(progressRows);
  const attemptLookup = buildAttemptLookup(attemptRows);
  const contributionLookup = buildContributionLookup(contributions);
  const revisionLookup = buildRevisionLookup(revisions);
  const errors = [];

  const kpiResult = resolveReportKpisFromCompletionTruth(projectTruth, fixtures);
  if (!kpiResult.ok) {
    errors.push(`project KPI truth: ${kpiResult.error}`);
    if (Array.isArray(kpiResult.truth_errors) && kpiResult.truth_errors.length > 0) {
      errors.push(...kpiResult.truth_errors.map((item) => `project KPI truth detail: ${item}`));
    }
  } else if (projectTruth?.truth_status === COMPLETION_TRUTH_STATUSES.DEGRADED) {
    errors.push("project completion truth is degraded; export requires complete operational truth");
  }

  fixtures.forEach((fixture) => {
    const fixtureId = String(fixture.fixture_id);
    const fixtureLabel = fixture.fixture_no || fixture.fixture_id;
    const fixtureProgressRows = (progressLookup.get(fixtureId) || [])
      .sort((left, right) => Number(left.stage_order || 0) - Number(right.stage_order || 0));
    const progressByStage = getProgressByStage(fixtureProgressRows);
    const fixtureAttempts = attemptLookup.get(fixtureId) || new Map();
    const workflowError = validateFixtureWorkflow(fixture, fixtureProgressRows, progressByStage);

    if (workflowError) {
      errors.push(`${fixtureLabel}: ${workflowError}`);
      return;
    }

    const actualTimestampsByStage = new Map();
    const isOutsourced = outsourcedFixtureIds.has(fixtureId);

    REPORT_STAGES.forEach((stage) => {
      const progressRow = progressByStage.get(stage.key)?.[0] || null;

      if (!progressRow) {
        errors.push(`${fixtureLabel}: missing ${stage.label} progress row`);
        return;
      }

      const status = normalizeStatus(progressRow.status);

      if (!VALID_WORKFLOW_STATUSES.has(status)) {
        errors.push(`${fixtureLabel}: invalid ${stage.label} workflow status "${progressRow.status || ""}"`);
        return;
      }

      if (status === "IN_PROGRESS" && !(progressRow.assigned_at || progressRow.started_at)) {
        errors.push(`${fixtureLabel}: ${stage.label} is in progress without a start or assignment timestamp`);
      }

      const stageAttempts = fixtureAttempts.get(stage.key) || [];

      if (["COMPLETED", "APPROVED", "REJECTED"].includes(status) && stageAttempts.length === 0) {
        errors.push(`${fixtureLabel}: ${stage.label} is ${status.toLowerCase()} without workflow attempt truth`);
      }

      const attempts = stageAttempts.map((attempt) => ({
        ...attempt,
        actual_end: getAttemptActualEnd(attempt, status),
      }));

      if (["COMPLETED", "APPROVED", "REJECTED"].includes(status)) {
        const hasActualEnd = attempts.some((attempt) => (
          attempt.actual_end
          || attempt.completed_at
          || attempt.approved_at
        ));

        if (!hasActualEnd) {
          errors.push(`${fixtureLabel}: ${stage.label} is ${status.toLowerCase()} without a truthful completion timestamp`);
        }
      }

      attempts.forEach((attempt) => {
        const actualTimestamp = attempt.actual_end ? String(attempt.actual_end) : null;
        if (!actualTimestamp) {
          return;
        }

        const duplicateStage = actualTimestampsByStage.get(actualTimestamp);
        if (duplicateStage && duplicateStage !== stage.label) {
          errors.push(`${fixtureLabel}: duplicate actual timestamp across ${duplicateStage} and ${stage.label}`);
          return;
        }

        actualTimestampsByStage.set(actualTimestamp, stage.label);
      });

      const stageVersion = normalizeStageVersion(progressRow.stage_version);
      if (stageVersion > 0) {
        const revisionKey = `${fixtureId}::${normalizeDesignStageName(progressRow.stage_name)}::${stageVersion}`;
        const revisionRow = revisionLookup.get(revisionKey);
        if (!revisionRow) {
          errors.push(`${fixtureLabel}: ${stage.label} revision ${formatStageRevisionCode(progressRow.stage_name, stageVersion)} is missing revision history truth`);
        } else if (!(revisionRow.reason_type || revisionRow.revision_type)) {
          errors.push(`${fixtureLabel}: ${stage.label} revision is missing reason_type truth`);
        }
      }

      if (!isOutsourced && ACTIVE_CONTRIBUTION_STATUSES.has(status)) {
        const revisionCode = formatStageRevisionCode(progressRow.stage_name, stageVersion);
        const contributionKey = `${fixtureId}::${progressRow.stage_name}::${revisionCode}`;
        const contributionRows = contributionLookup.get(contributionKey) || [];

        if (contributionRows.length === 0) {
          errors.push(`${fixtureLabel}: ${stage.label} is missing contributor execution truth`);
          return;
        }

        const totalPercent = contributionRows.reduce(
          (sum, row) => sum + Number(row.contribution_percent || 0),
          0,
        );

        if (Math.round(totalPercent) !== 100) {
          errors.push(`${fixtureLabel}: ${stage.label} contributor percentages must total 100% (received ${totalPercent}%)`);
        }
      }
    });
  });

  return errors;
}

function assertDesignReportExportIntegrity(payload) {
  const errors = collectDesignReportTruthLayerErrors(payload);

  if (errors.length === 0) {
    return;
  }

  throw new AppError(
    409,
    DESIGN_REPORT_TRUTH_LAYER_ERROR,
    {
      report: "Design Project Execution / Fixture Stage Tracking Report",
      reason: "Required workflow truth data is missing or inconsistent; export would require unsafe fallback values.",
      details: errors.slice(0, 25),
      total_errors: errors.length,
    },
    "DESIGN_REPORT_TRUTH_LAYER_REQUIRED",
  );
}

function buildWorkflowValidationProjectTruth(fixtures) {
  return {
    truth_status: COMPLETION_TRUTH_STATUSES.COMPLETE,
    completion_percent: 0,
    strict_complete: false,
    fixtures: fixtures.map((fixture) => ({
      fixture_id: fixture.fixture_id,
      strict_complete: false,
      has_blocking_hold: false,
      has_unresolved_reject: false,
      has_active_rework: false,
      is_outsourced: true,
    })),
  };
}

/** Workflow-only gate kept for unit tests and legacy callers. */
function assertDesignReportTruthLayerComplete(fixtures, progressRows, attemptRows) {
  assertDesignReportExportIntegrity({
    fixtures,
    progressRows,
    attemptRows,
    contributions: [],
    revisions: [],
    projectTruth: buildWorkflowValidationProjectTruth(fixtures),
    outsourcedFixtureIds: new Set(fixtures.map((fixture) => String(fixture.fixture_id))),
  });
}

module.exports = {
  DESIGN_REPORT_TRUTH_LAYER_ERROR,
  REPORT_STAGES,
  assertDesignReportExportIntegrity,
  assertDesignReportTruthLayerComplete,
  collectDesignReportTruthLayerErrors,
  getStageBucket,
};
