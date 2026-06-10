const assert = require("node:assert/strict");
const {
  formatStageRevisionBlock,
  formatStageContributors,
  formatStageProgressPercent,
} = require("../services/designReport/designReportPresentation");
const {
  collectDesignReportTruthLayerErrors,
  assertDesignReportExportIntegrity,
} = require("../services/designReport/designReportValidation");
const { resolveReportKpisFromCompletionTruth } = require("../services/designReport/designReportKpiContract");
const { COMPLETION_TRUTH_STATUSES } = require("../config/designCompletionWeights");

function buildCompleteProjectTruth(fixtures) {
  return {
    truth_status: COMPLETION_TRUTH_STATUSES.COMPLETE,
    completion_percent: 42.5,
    strict_complete: false,
    fixtures: fixtures.map((fixture) => ({
      fixture_id: fixture.fixture_id,
      strict_complete: false,
      has_blocking_hold: false,
      has_unresolved_reject: false,
      has_active_rework: false,
      is_outsourced: false,
      is_required_for_project_kpi: true,
    })),
  };
}

function buildFixtureProgress(fixtureId, fixtureNo) {
  return [
    {
      fixture_id: fixtureId,
      stage_name: "concept",
      stage_order: 1,
      stage_version: 2,
      status: "IN_PROGRESS",
      assigned_at: "2026-04-01T08:00:00Z",
      started_at: "2026-04-01T08:00:00Z",
      completed_at: null,
    },
    {
      fixture_id: fixtureId,
      stage_name: "dap",
      stage_order: 2,
      stage_version: 0,
      status: "PENDING",
    },
    {
      fixture_id: fixtureId,
      stage_name: "3d_finish",
      stage_order: 3,
      stage_version: 0,
      status: "PENDING",
    },
    {
      fixture_id: fixtureId,
      stage_name: "2d_finish",
      stage_order: 4,
      stage_version: 0,
      status: "PENDING",
    },
  ];
}

async function run() {
  {
    const revisionBlock = formatStageRevisionBlock(
      {
        stage_name: "concept",
        stage_version: 2,
      },
      {
        revision_code: "CON 02",
        reason_type: "CUSTOMER_CHANGE",
      },
    );

    assert.match(revisionBlock, /Stage = Concept/);
    assert.match(revisionBlock, /Revision = CON 02/);
    assert.match(revisionBlock, /Reason Type = Customer Change/);
    assert.doesNotMatch(revisionBlock, /Concept02/);
  }

  {
    const contributors = formatStageContributors([
      { employee_name: "Person A", contribution_percent: 30 },
      { employee_name: "Person B", contribution_percent: 40 },
      { employee_name: "Person C", contribution_percent: 30 },
    ]);

    assert.equal(contributors, "Person A: 30%\nPerson B: 40%\nPerson C: 30%");
  }

  {
    const contributors = formatStageContributors([
      { employee_name: "Person A", contribution_percent: null },
    ]);

    assert.equal(contributors, "Person A: Contribution % Not Recorded");
  }

  {
    const kpiResult = resolveReportKpisFromCompletionTruth(
      {
        truth_status: COMPLETION_TRUTH_STATUSES.COMPLETE,
        completion_percent: 1400,
        strict_complete: false,
        fixtures: [{ fixture_id: "fixture-1" }],
      },
      [{ fixture_id: "fixture-1" }],
    );

    assert.equal(kpiResult.ok, false);
    assert.match(kpiResult.error, /outside the supported 0-100 range/);
    assert.deepEqual(kpiResult.truth_errors, ["completion_percent_out_of_range:1400"]);
  }

  {
    const progress = formatStageProgressPercent(
      { stage_name: "concept", status: "IN_PROGRESS", stage_version: 0 },
      15,
    );
    assert.equal(progress, "35%");
  }

  {
    const fixtures = [{ fixture_id: "fixture-1", fixture_no: "FX-01" }];
    const progressRows = buildFixtureProgress("fixture-1", "FX-01");
    const attemptRows = [
      {
        fixture_id: "fixture-1",
        stage_name: "concept",
        attempt_no: 1,
        status: "IN_PROGRESS",
        assigned_at: "2026-04-01T08:00:00Z",
        started_at: "2026-04-01T08:00:00Z",
      },
    ];
    const revisions = [
      {
        fixture_id: "fixture-1",
        stage_name: "concept",
        stage_version: 2,
        revision_code: "CON 02",
        reason_type: "CUSTOMER_CHANGE",
      },
    ];
    const contributions = [
      {
        fixture_id: "fixture-1",
        stage_name: "concept",
        revision_code: "CON 02",
        stage_revision_no: 2,
        employee_id: "E1",
        employee_name: "Person A",
        contribution_percent: 100,
      },
    ];

    const errors = collectDesignReportTruthLayerErrors({
      fixtures,
      progressRows,
      attemptRows,
      revisions,
      contributions,
      projectTruth: buildCompleteProjectTruth(fixtures),
    });

    assert.equal(errors.length, 0);
  }

  {
    const fixtures = [{ fixture_id: "fixture-1", fixture_no: "FX-01" }];
    const progressRows = buildFixtureProgress("fixture-1", "FX-01").map((row) => (
      row.stage_name === "concept"
        ? { ...row, stage_version: 2 }
        : row
    ));

    const errors = collectDesignReportTruthLayerErrors({
      fixtures,
      progressRows,
      attemptRows: [],
      revisions: [],
      contributions: [],
      projectTruth: buildCompleteProjectTruth(fixtures),
    });

    assert.ok(errors.some((error) => error.includes("missing revision history truth")));
    assert.ok(!errors.some((error) => error.includes("missing contributor execution truth")));
  }

  {
    const fixtures = [{ fixture_id: "fixture-1", fixture_no: "FX-01" }];
    const progressRows = buildFixtureProgress("fixture-1", "FX-01");
    const revisions = [
      {
        fixture_id: "fixture-1",
        stage_name: "concept",
        stage_version: 2,
        revision_code: "CON 02",
        reason_type: "CUSTOMER_CHANGE",
      },
    ];
    const contributions = [
      {
        fixture_id: "fixture-1",
        stage_name: "concept",
        revision_code: "CON 02",
        stage_revision_no: 2,
        employee_id: "E1",
        employee_name: "Person A",
        contribution_percent: 60,
      },
    ];

    const errors = collectDesignReportTruthLayerErrors({
      fixtures,
      progressRows,
      attemptRows: [],
      revisions,
      contributions,
      projectTruth: buildCompleteProjectTruth(fixtures),
    });

    assert.ok(errors.some((error) => error.includes("contributor percentages must total 100%")));
  }

  {
    const kpiResult = resolveReportKpisFromCompletionTruth(
      {
        truth_status: COMPLETION_TRUTH_STATUSES.INCOMPLETE_TRUTH,
        completion_percent: null,
        fixtures: [],
      },
      [{ fixture_id: "fixture-1" }],
    );

    assert.equal(kpiResult.ok, false);
  }

  console.log("designReportExport.test.js passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
