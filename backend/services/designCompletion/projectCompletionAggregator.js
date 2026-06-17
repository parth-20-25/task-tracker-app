const { PROJECT_STATUSES } = require("../../config/constants");
const { COMPLETION_TRUTH_STATUSES } = require("../../config/designCompletionWeights");
const { computeFixtureCompletionTruth } = require("./fixtureCompletionCalculator");
const { getDesignStageDisplayName } = require("../../lib/designWorkflowStages");

const OVERALL_STAGE_KEYS = new Set(["concept", "dap", "3d_finish", "2d_finish"]);

function buildOverallStage(fixtureTruths) {
  const active = fixtureTruths.filter((truth) => !truth.strict_complete);
  if (active.length === 0 && fixtureTruths.length > 0) {
    return { status: "completed", label: "Completed", reason: null, counts: {} };
  }

  const invalid = active.find((truth) => (
    truth.completion_percent === null
    || !truth.current_stage_key
    || !OVERALL_STAGE_KEYS.has(truth.current_stage_key)
  ));
  if (invalid) {
    const reason = invalid.truth_errors?.[0]
      || `fixture:${invalid.fixture_no || invalid.fixture_id}:current_stage_unresolved`;
    return { status: "incomplete", label: "Data incomplete", reason, counts: {} };
  }

  const counts = active.reduce((map, truth) => {
    map[truth.current_stage_key] = (map[truth.current_stage_key] || 0) + 1;
    return map;
  }, {});
  const max = Math.max(...Object.values(counts), 0);
  const leaders = Object.keys(counts).filter((key) => counts[key] === max);
  const labels = leaders.map((key) => getDesignStageDisplayName(key, key).replace(" Finish", ""));

  return {
    status: leaders.length > 1 ? "mixed" : "active",
    label: leaders.length > 1 ? `Mixed - ${labels.join(" / ")}` : labels[0] || "Data incomplete",
    reason: null,
    counts,
  };
}

function aggregateProjectCompletionTruth(projectBundle, options = {}) {
  const fixtureBundles = Array.isArray(projectBundle.fixture_bundles)
    ? projectBundle.fixture_bundles
    : [];

  const requiredBundles = fixtureBundles.filter(
    (bundle) => bundle.is_required_for_project_kpi !== false,
  );

  if (requiredBundles.length === 0) {
    return buildProjectTruth({
      projectBundle,
      fixtureTruths: [],
      completionPercent: null,
      truthStatus: COMPLETION_TRUTH_STATUSES.INCOMPLETE_TRUTH,
      strictComplete: false,
      truthErrors: ["no_required_fixtures"],
    });
  }

  const fixtureTruths = requiredBundles.map((bundle) => computeFixtureCompletionTruth(bundle, options));
  const truthErrors = [];

  if (fixtureTruths.some((truth) => truth.completion_percent === null)) {
    const fixtureTruthErrors = fixtureTruths.flatMap((truth) => (
      (truth.truth_errors || []).map((error) => `fixture:${truth.fixture_no || truth.fixture_id}:${error}`)
    ));
    return buildProjectTruth({
      projectBundle,
      fixtureTruths,
      completionPercent: null,
      truthStatus: COMPLETION_TRUTH_STATUSES.INCOMPLETE_TRUTH,
      strictComplete: false,
      truthErrors: fixtureTruthErrors.length > 0 ? fixtureTruthErrors : ["fixture_truth_incomplete"],
    });
  }

  const total = fixtureTruths.reduce((sum, truth) => sum + Number(truth.completion_percent || 0), 0);
  const completionPercent = Math.round((total / fixtureTruths.length) * 100) / 100;

  const strictComplete = fixtureTruths.every((truth) => truth.strict_complete)
    && completionPercent >= 100
    && !fixtureTruths.some((truth) => truth.has_active_rework || truth.has_unresolved_reject);

  const hasHold = (projectBundle.project_status || PROJECT_STATUSES.ACTIVE) === PROJECT_STATUSES.ON_HOLD
    || fixtureTruths.some((truth) => truth.has_blocking_hold);

  let truthStatus = COMPLETION_TRUTH_STATUSES.COMPLETE;
  if (hasHold) {
    truthStatus = COMPLETION_TRUTH_STATUSES.DEGRADED;
  } else if (!strictComplete) {
    truthStatus = fixtureTruths.some((truth) => truth.has_active_rework || truth.has_unresolved_reject)
      ? COMPLETION_TRUTH_STATUSES.DEGRADED
      : COMPLETION_TRUTH_STATUSES.COMPLETE;
  }

  if (projectBundle.project_status === PROJECT_STATUSES.COMPLETED && !strictComplete) {
    truthErrors.push("project_status_completed_without_strict_truth");
  }

  return buildProjectTruth({
    projectBundle,
    fixtureTruths,
    completionPercent: strictComplete ? 100 : completionPercent,
    truthStatus,
    strictComplete,
    truthErrors,
  });
}

function buildProjectTruth({
  projectBundle,
  fixtureTruths,
  completionPercent,
  truthStatus,
  strictComplete,
  truthErrors,
}) {
  const overallStage = buildOverallStage(fixtureTruths);
  if (overallStage.label === "Data incomplete" && !overallStage.reason && truthErrors?.length) {
    overallStage.reason = truthErrors[0];
  }

  return {
    project_id: projectBundle.project_id,
    project_no: projectBundle.project_no,
    department_id: projectBundle.department_id,
    completion_percent: completionPercent,
    truth_status: truthStatus,
    strict_complete: strictComplete,
    project_status: projectBundle.project_status || PROJECT_STATUSES.ACTIVE,
    total_fixtures: fixtureTruths.length,
    required_fixtures: fixtureTruths.filter((truth) => truth.is_required_for_project_kpi !== false).length,
    outsourced_fixtures: fixtureTruths.filter((truth) => truth.is_outsourced).length,
    fixtures: fixtureTruths,
    truth_errors: truthErrors,
    overall_stage: overallStage,
  };
}

module.exports = {
  aggregateProjectCompletionTruth,
  buildOverallStage,
};
