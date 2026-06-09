const assert = require("node:assert/strict");

const { computeFixtureCompletionTruth } = require("../services/designCompletion/fixtureCompletionCalculator");
const { aggregateProjectCompletionTruth } = require("../services/designCompletion/projectCompletionAggregator");
const { buildWeightMapForStageKeys } = require("../services/designCompletion/stageWeightModel");
const { COMPLETION_TRUTH_STATUSES } = require("../config/designCompletionWeights");

function runTest(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function buildProgress(stageKey, status, order, version = 0) {
  return {
    stage_name: stageKey,
    stage_order: order,
    stage_version: version,
    status,
  };
}

runTest("stage weights normalize to 100 across active workflow stages", () => {
  const weights = buildWeightMapForStageKeys(["concept", "dap", "3d_finish", "2d_finish", "release"]);
  const total = [...weights.values()].reduce((sum, value) => sum + value, 0);
  assert.ok(Math.abs(total - 100) < 0.05);
});

runTest("approved stages earn full weight; in-progress earns partial only", () => {
  const truth = computeFixtureCompletionTruth({
    fixture_id: "f1",
    fixture_no: "FX-1",
    project_id: "p1",
    revision_no: 0,
    is_workflow_complete: false,
    is_outsourced: false,
    is_required_for_project_kpi: true,
    progress_rows: [
      buildProgress("concept", "APPROVED", 1),
      buildProgress("dap", "IN_PROGRESS", 2),
      buildProgress("3d_finish", "PENDING", 3),
      buildProgress("2d_finish", "PENDING", 4),
      buildProgress("release", "PENDING", 5),
    ],
    workflow_stages: [],
    weight_rows: [],
  });

  assert.equal(truth.truth_status, COMPLETION_TRUTH_STATUSES.COMPLETE);
  assert.ok(truth.completion_percent > 15 && truth.completion_percent < 40);
  assert.equal(truth.strict_complete, false);
  assert.equal(truth.current_approval_state, "in_progress");
});

runTest("rejected stage removes earned credit for that stage", () => {
  const truth = computeFixtureCompletionTruth({
    fixture_id: "f2",
    fixture_no: "FX-2",
    project_id: "p1",
    revision_no: 0,
    is_workflow_complete: false,
    is_outsourced: false,
    is_required_for_project_kpi: true,
    progress_rows: [
      buildProgress("concept", "APPROVED", 1),
      buildProgress("dap", "REJECTED", 2),
      buildProgress("3d_finish", "PENDING", 3),
      buildProgress("2d_finish", "PENDING", 4),
      buildProgress("release", "PENDING", 5),
    ],
  });

  assert.equal(truth.has_unresolved_reject, true);
  assert.equal(truth.completion_percent, 15);
  assert.equal(truth.strict_complete, false);
});

runTest("active rework caps strict completion below 100", () => {
  const truth = computeFixtureCompletionTruth({
    fixture_id: "f3",
    fixture_no: "FX-3",
    project_id: "p1",
    revision_no: 2,
    is_workflow_complete: false,
    is_outsourced: false,
    is_required_for_project_kpi: true,
    progress_rows: [
      buildProgress("concept", "APPROVED", 1),
      buildProgress("dap", "APPROVED", 2),
      buildProgress("3d_finish", "IN_PROGRESS", 3, 1),
      buildProgress("2d_finish", "PENDING", 4),
      buildProgress("release", "PENDING", 5),
    ],
  });

  assert.equal(truth.has_active_rework, true);
  assert.ok(truth.completion_percent < 100);
  assert.equal(truth.strict_complete, false);
});

runTest("all stages approved yields strict 100", () => {
  const truth = computeFixtureCompletionTruth({
    fixture_id: "f4",
    fixture_no: "FX-4",
    project_id: "p1",
    revision_no: 1,
    is_workflow_complete: true,
    is_outsourced: false,
    is_required_for_project_kpi: true,
    progress_rows: [
      buildProgress("concept", "APPROVED", 1),
      buildProgress("dap", "APPROVED", 2),
      buildProgress("3d_finish", "APPROVED", 3),
      buildProgress("2d_finish", "APPROVED", 4),
      buildProgress("release", "APPROVED", 5),
    ],
  });

  assert.equal(truth.completion_percent, 100);
  assert.equal(truth.strict_complete, true);
});

runTest("outsourced fixtures remain in project aggregation", () => {
  const projectTruth = aggregateProjectCompletionTruth({
    project_id: "p1",
    project_no: "PRJ-1",
    department_id: "design",
    project_status: "active",
    fixture_bundles: [
      {
        fixture_id: "f5",
        fixture_no: "FX-5",
        project_id: "p1",
        revision_no: 0,
        is_workflow_complete: true,
        is_outsourced: true,
        is_required_for_project_kpi: true,
        progress_rows: [
          buildProgress("concept", "APPROVED", 1),
          buildProgress("dap", "APPROVED", 2),
          buildProgress("3d_finish", "APPROVED", 3),
          buildProgress("2d_finish", "APPROVED", 4),
          buildProgress("release", "APPROVED", 5),
        ],
      },
      {
        fixture_id: "f6",
        fixture_no: "FX-6",
        project_id: "p1",
        revision_no: 0,
        is_workflow_complete: false,
        is_outsourced: false,
        is_required_for_project_kpi: true,
        progress_rows: [
          buildProgress("concept", "APPROVED", 1),
          buildProgress("dap", "PENDING", 2),
          buildProgress("3d_finish", "PENDING", 3),
          buildProgress("2d_finish", "PENDING", 4),
          buildProgress("release", "PENDING", 5),
        ],
      },
    ],
  });

  assert.equal(projectTruth.outsourced_fixtures, 1);
  assert.ok(projectTruth.completion_percent > 50 && projectTruth.completion_percent < 100);
  assert.equal(projectTruth.strict_complete, false);
});

runTest("missing progress rows fail-safe to null completion", () => {
  const truth = computeFixtureCompletionTruth({
    fixture_id: "f7",
    fixture_no: "FX-7",
    project_id: "p1",
    revision_no: 0,
    is_workflow_complete: false,
    progress_rows: [buildProgress("concept", "APPROVED", 1)],
    workflow_stages: [{ name: "DAP" }, { name: "3D Finish" }],
  });

  assert.equal(truth.completion_percent, null);
  assert.equal(truth.truth_status, COMPLETION_TRUTH_STATUSES.INCOMPLETE_TRUTH);
  assert.ok(truth.truth_errors.some((error) => error.startsWith("missing_progress:")));
});

runTest("catalog-soft-removed fixtures remain in project denominator", () => {
  const projectTruth = aggregateProjectCompletionTruth({
    project_id: "p1",
    project_status: "active",
    fixture_bundles: [
      {
        fixture_id: "f8",
        fixture_no: "FX-8",
        project_id: "p1",
        removed_from_latest_ingestion: true,
        is_required_for_project_kpi: true,
        progress_rows: [
          buildProgress("concept", "PENDING", 1),
          buildProgress("dap", "PENDING", 2),
          buildProgress("3d_finish", "PENDING", 3),
          buildProgress("2d_finish", "PENDING", 4),
          buildProgress("release", "PENDING", 5),
        ],
      },
      {
        fixture_id: "f9",
        fixture_no: "FX-9",
        project_id: "p1",
        is_required_for_project_kpi: true,
        revision_no: 0,
        is_workflow_complete: false,
        progress_rows: [
          buildProgress("concept", "APPROVED", 1),
          buildProgress("dap", "PENDING", 2),
          buildProgress("3d_finish", "PENDING", 3),
          buildProgress("2d_finish", "PENDING", 4),
          buildProgress("release", "PENDING", 5),
        ],
      },
    ],
  });

  assert.equal(projectTruth.total_fixtures, 2);
  assert.equal(projectTruth.completion_percent, 7.5);
});

console.log("All design completion engine tests passed.");
