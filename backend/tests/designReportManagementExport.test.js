const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const ExcelJS = require("exceljs");

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://user:pass@localhost:5432/tasktracker_test";

const {
  buildDesignManagementReportModel,
  generateDesignProjectExecutionTemplateExcel,
  generateDesignManagementPdf,
} = require("../services/designReportService");
const {
  STATUS_COLORS,
} = require("../services/designReport/designReportManagementModel");
const {
  buildDesignReportManagementSample,
} = require("./fixtures/designReportManagementSample");

function collectFixtureNumbers(worksheet, startRow = 14) {
  const fixtureNumbers = [];

  for (let rowNumber = startRow; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const value = worksheet.getCell(`B${rowNumber}`).value;
    if (value !== null && value !== undefined && String(value).trim()) {
      fixtureNumbers.push(String(value).trim());
    }
  }

  return fixtureNumbers;
}

function collectRowsContainingValue(worksheet, expectedValue) {
  const rows = [];

  worksheet.eachRow((row, rowNumber) => {
    const hasValue = row.values.some((value) => value === expectedValue);
    if (hasValue) {
      rows.push(rowNumber);
    }
  });

  return rows;
}

async function run() {
  const sample = buildDesignReportManagementSample();
  const model = buildDesignManagementReportModel(sample);

  assert.equal(model.reportVersion, "PARC Design Project Report v2");
  assert.equal(model.statusColors.Assigned, "#3A7BD5");
  assert.equal(model.statusColors["In Progress"], "#F59E0B");
  assert.equal(model.statusColors["On Hold"], "#FF9800");
  assert.equal(model.statusColors.Review, "#8B5CF6");
  assert.equal(model.statusColors.Rework, "#DC2626");
  assert.equal(model.statusColors.Closed, "#616161");
  assert.equal(model.statusColors.Overdue, "#991B1B");
  assert.equal(model.statusColors.Skipped, "#64748B");
  assert.equal(model.statusColors.Outsourced, "#0D9488");
  assert.deepEqual(model.statusColors, STATUS_COLORS);

  assert.equal(model.kpis.totalFixtures, 5);
  assert.equal(model.kpis.completedFixtures, 1);
  assert.equal(model.kpis.inProgressFixtures, 1);
  assert.equal(model.kpis.onHoldFixtures, 1);
  assert.equal(model.kpis.overdueFixtures, 1);
  assert.equal(model.kpis.reworkCount, 1);
  assert.equal(model.kpis.completionDisplay, "60%");
  assert.equal(model.kpis.assignedFixtures, 5);
  assert.equal(model.kpis.unassignedFixtures, 0);
  assert.equal(model.kpis.outsourcedFixtures, 0);
  assert.equal(model.kpis.skippedStages, 0);

  assert.equal(
    model.overview.find((row) => row.label === "Project Leader")?.value,
    "509 - Damu Khadthare",
  );
  assert.equal(
    model.overview.find((row) => row.label === "Project Uploader")?.value,
    "502 - Riya Patil",
  );
  assert.ok(model.workflowTimeline.some((row) => row.event === "Concept Started"));
  assert.ok(model.workflowTimeline.some((row) => row.event === "Released"));
  assert.ok(model.proofAnalytics.some((row) => row.proofAvailability === "Missing"));
  assert.ok(model.proofAnalytics.some((row) => row.proofAvailability === "Available"));
  assert.equal(model.fixtureStageDetails.length, 5);
  assert.equal(model.fixtureStageDetails[0].twoDProof, "View Proof (2)");
  assert.ok(model.fixtureStageDetails[0].twoDProofUrl);
  assert.equal(model.fixtureStageExecutionAudit.length, 5);
  const fixtureOneAudit = model.fixtureStageExecutionAudit.find((fixture) => fixture.fixtureNumber === "PARC26001301");
  const twoDAudit = fixtureOneAudit.stages.find((stage) => stage.stage === "2D" && stage.revision === "2D 00");
  assert.equal(twoDAudit.key, "two_d_finish");
  assert.equal(twoDAudit.status, "Approved");
  assert.equal(twoDAudit.executionMode, "In-House");
  assert.equal(twoDAudit.approvalStatus, "Approved");
  assert.equal(twoDAudit.priority, "High");
  assert.equal(twoDAudit.transferred, "Yes");
  assert.equal(twoDAudit.workers[0].worker, "511 - Mangesh Gite");
  assert.equal(twoDAudit.workers[0].contributionPercent, "40%");
  assert.equal(twoDAudit.workers[1].worker, "513 - Motilal Kurmi");
  assert.equal(twoDAudit.workers[1].contributionPercent, "60%");
  assert.equal(twoDAudit.proofLinks.length, 2);
  const fixtureThreeAudit = model.fixtureStageExecutionAudit.find((fixture) => fixture.fixtureNumber === "PARC26001303");
  const threeDAudit = fixtureThreeAudit.stages.find((stage) => stage.stage === "3D" && stage.revision === "3D 00");
  assert.equal(threeDAudit.workers[0].contributionPercent, "Contribution % Not Recorded");
  assert.ok(model.workProofHistory.some((row) => row.proofLink === "/uploads/task-proofs/fixture-1-final.png"));
  assert.equal(model.reworkAnalytics.counts.conceptReworks, 1);
  assert.equal(model.holdHistory[0].holdDuration, "2d 6h 0m");
  assert.equal(model.revisionHistory[0].fixture, "PARC26001305");
  assert.ok(model.revisionHistory[0].eventId);
  assert.ok(model.assignmentHistory.some((row) => row.comments === "Balanced workload"));
  assert.ok(model.activityLog.some((row) => row.action === "Task Quality Rework Requested"));

  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "design-report-v2-test-"));
  const xlsxPath = path.join(tempDirectory, "sample-report-v2.xlsx");

  try {
    const allocationSample = {
      ...sample,
      reportData: {
        ...sample.reportData,
        stageTasks: [
          ...sample.reportData.stageTasks,
          {
            task_id: 204,
            fixture_id: "fixture-4",
            stage_name: "3d_finish",
            proof_url: [],
            assigned_to: "514",
            assigned_to_name: "Nilesh Pawar",
            assigned_by: "509",
            assigned_by_name: "Damu Khadthare",
            assigned_at: "2026-05-18T09:00:00Z",
            priority: "high",
            deadline: "2026-05-23T18:00:00Z",
            due_date: "2026-05-23T18:00:00Z",
            sla_due_date: "2026-05-23T18:00:00Z",
            created_at: "2026-05-18T08:45:00Z",
            updated_at: "2026-05-18T15:00:00Z",
            planned_minutes: 480,
            actual_minutes: 120,
          },
        ],
        activitiesByTaskId: new Map([
          ...sample.reportData.activitiesByTaskId,
          [204, [
            {
              task_id: 204,
              user_employee_id: "509",
              user_name: "Damu Khadthare",
              action_type: "design_task_transferred",
              notes: "Shifted remaining 3D work",
              metadata: {
                stage: "3D",
                reassignment_contribution: {
                  stage_name: "3d_finish",
                  revision_code: "3D 00",
                  previous_assigned_to: "512",
                  previous_assigned_to_name: "Shivam Desai",
                  previous_contribution_percent: 35,
                  remaining_assigned_to: "514",
                  remaining_assigned_to_name: "Nilesh Pawar",
                  remaining_contribution_percent: 65,
                },
              },
              created_at: "2026-05-18T15:00:00Z",
            },
          ]],
        ]),
        contributions: [
          ...sample.reportData.contributions,
          {
            id: "contribution-concept-a",
            fixture_id: "fixture-2",
            department_id: "design",
            stage_name: "concept",
            revision_code: "CON 00",
            stage_revision_no: 0,
            employee_id: "512",
            employee_name: "Shivam Desai",
            contribution_percent: 55,
            contribution_kind: "ACTUAL",
            metadata: {},
          },
          {
            id: "contribution-concept-b",
            fixture_id: "fixture-2",
            department_id: "design",
            stage_name: "concept",
            revision_code: "CON 00",
            stage_revision_no: 0,
            employee_id: "509",
            employee_name: "Damu Khadthare",
            contribution_percent: 45,
            contribution_kind: "ACTUAL",
            metadata: {},
          },
        ],
      },
    };

    await generateDesignProjectExecutionTemplateExcel({
      context: allocationSample.context,
      fixtures: allocationSample.fixtures,
      reportData: allocationSample.reportData,
      filePath: xlsxPath,
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(xlsxPath);

    assert.equal(workbook.worksheets.length, 1);
    assert.equal(workbook.worksheets[0].name, "Design Project Execution");
    const templateSheet = workbook.getWorksheet("Design Project Execution");
    assert.equal(templateSheet.getCell("A1").value, "Fixture Stage Tracking Report");
    assert.equal(templateSheet.getCell("A10").value, "Stage Tracking Register");
    assert.equal(templateSheet.getCell("A11").value, "FIXTURE INFORMATION");
    assert.deepEqual(collectRowsContainingValue(templateSheet, "FIXTURE INFORMATION"), [11]);
    assert.equal(templateSheet.getCell("H11").value, "CONCEPT");
    assert.equal(templateSheet.getCell("AH11").value, "WORK PROOF REGISTER");
    assert.deepEqual(
      collectFixtureNumbers(templateSheet),
      allocationSample.fixtures.map((fixture) => fixture.fixture_no),
    );
    assert.equal(templateSheet.getCell("B14").value, "PARC26001301");
    assert.equal(templateSheet.getCell("E14").value, "high");
    assert.equal(templateSheet.getCell("A8").value, "Completion: 60%");
    assert.equal(templateSheet.getCell("E8").value, "Total Fixtures: 5");
    assert.equal(templateSheet.getCell("I8").value, "Completed Fixtures: 1");
    assert.equal(templateSheet.getCell("M8").value, "Active Fixtures: 1");
    assert.equal(templateSheet.getCell("U8").value, "On Hold Fixtures: 1");
    assert.equal(templateSheet.getCell("AK14").value.hyperlink, "/uploads/task-proofs/fixture-1-final.png");
    assert.ok((templateSheet.views || []).some((view) => view.state === "frozen" && view.ySplit === 13));
    assert.equal(templateSheet.autoFilter, "A13:AM18");
    assert.equal(templateSheet.getCell("F14").value, "Assigned To: 513 - Motilal Kurmi\nAssigned By: 509 - Damu Khadthare");
    assert.equal(templateSheet.getCell("G14").value, "Status: Closed\nCurrent Stage: Completed");
    assert.equal(templateSheet.getCell("G14").fill.fgColor.argb, "FF616161");
    assert.equal(templateSheet.getCell("G15").fill.fgColor.argb, "FF28A745");
    assert.equal(templateSheet.getCell("G16").fill.fgColor.argb, "FFFF9800");
    assert.equal(templateSheet.getCell("G17").fill.fgColor.argb, "FFD32F2F");
    assert.equal(templateSheet.getCell("G18").fill.fgColor.argb, "FF9C27B0");
    assert.equal(templateSheet.getCell("L15").value, "512 - Shivam Desai: 55%\n509 - Damu Khadthare: 45%");
    assert.equal(templateSheet.getCell("F17").value, "Assigned To: 514 - Nilesh Pawar\nAssigned By: 509 - Damu Khadthare");
    assert.equal(templateSheet.getCell("W17").value, "512 - Shivam Desai: 35%\n514 - Nilesh Pawar: 65%");
    assert.equal(templateSheet.getCell("AH15").value, "No proof uploaded");
    assert.notEqual(templateSheet.getCell("AH15").font?.underline, true);
    assert.equal(templateSheet.getCell("AM14").value, "Actual Hours: 15h 0m\nVariance: -1h 0m");
    assert.equal(templateSheet.getCell("B19").value, null);
    assert.deepEqual(Object.keys(templateSheet.getCell("B19").style || {}), []);
    assert.ok(!collectFixtureNumbers(templateSheet).includes("PARC26001306"));

    const emptySnapshotPath = path.join(tempDirectory, "empty-project-snapshot.xlsx");
    await generateDesignProjectExecutionTemplateExcel({
      context: {
        ...sample.context,
        project_no: "PARC-EMPTY",
        project_name: "New Project Snapshot",
      },
      fixtures: [],
      reportData: {
        progressRows: [],
        attemptRows: [],
        contributions: [],
        revisions: [],
        stageTasks: [],
        attachmentsByTaskId: new Map(),
        activitiesByTaskId: new Map(),
        projectTruth: null,
        weightRows: [],
        workflowStages: [],
      },
      filePath: emptySnapshotPath,
    });
    const emptyWorkbook = new ExcelJS.Workbook();
    await emptyWorkbook.xlsx.readFile(emptySnapshotPath);
    assert.equal(emptyWorkbook.worksheets.length, 1);
    const emptyTemplate = emptyWorkbook.getWorksheet("Design Project Execution");
    assert.equal(emptyTemplate.getCell("A5").value, "PARC-EMPTY");
    assert.equal(emptyTemplate.getCell("E5").value, "New Project Snapshot");
    assert.equal(emptyTemplate.getCell("A8").value, "Completion: Not available");
    assert.equal(emptyTemplate.getCell("E8").value, "Total Fixtures: 0");
    assert.equal(emptyTemplate.getCell("A14").value, null);
    assert.deepEqual(Object.keys(emptyTemplate.getCell("A14").style || {}), []);
    assert.deepEqual(collectFixtureNumbers(emptyTemplate), []);
    assert.deepEqual(collectRowsContainingValue(emptyTemplate, "FIXTURE INFORMATION"), [11]);
    assert.ok((emptyTemplate.views || []).some((view) => view.state === "frozen" && view.ySplit === 13));
    assert.equal(emptyTemplate.autoFilter, "A13:AM13");

    const incompleteSnapshotPath = path.join(tempDirectory, "incomplete-project-snapshot.xlsx");
    await generateDesignProjectExecutionTemplateExcel({
      context: {
        ...sample.context,
        project_no: "PARC-INCOMPLETE",
        project_name: "Incomplete Snapshot",
        customer_name: "",
        plant: "",
        project_leader_id: "509",
        project_leader_name: "Damu Khadthare",
        team_lead_id: "",
        team_lead_name: "",
      },
      fixtures: [
        {
          fixture_id: "fixture-new",
          fixture_no: "FX-NEW",
          task_status: "assigned",
        },
      ],
      reportData: {
        progressRows: [],
        attemptRows: [],
        contributions: [],
        revisions: [],
        stageTasks: [],
        attachmentsByTaskId: new Map(),
        activitiesByTaskId: new Map(),
        projectTruth: {
          truth_status: "COMPLETE",
          completion_percent: 1400,
          strict_complete: false,
          fixtures: [{ fixture_id: "fixture-new" }],
        },
        weightRows: [],
        workflowStages: [],
      },
      filePath: incompleteSnapshotPath,
    });
    const incompleteWorkbook = new ExcelJS.Workbook();
    await incompleteWorkbook.xlsx.readFile(incompleteSnapshotPath);
    const incompleteTemplate = incompleteWorkbook.getWorksheet("Design Project Execution");
    assert.equal(incompleteTemplate.getCell("A5").value, "PARC-INCOMPLETE");
    assert.equal(incompleteTemplate.getCell("I5").value, "Not recorded");
    assert.equal(incompleteTemplate.getCell("Q5").value, "509 - Damu Khadthare");
    assert.equal(incompleteTemplate.getCell("U5").value, "Not assigned");
    assert.equal(incompleteTemplate.getCell("A8").value, "Completion: Not available");
    assert.equal(incompleteTemplate.getCell("B14").value, "FX-NEW");
    assert.equal(incompleteTemplate.getCell("C14").value, "Not recorded");
    assert.equal(incompleteTemplate.getCell("D14").value, "Not recorded");
    assert.equal(incompleteTemplate.getCell("F14").value, "Assigned To: Not assigned\nAssigned By: Not recorded");
    assert.equal(incompleteTemplate.getCell("G14").value, "Status: Assigned\nCurrent Stage: Not started");
    assert.equal(incompleteTemplate.getCell("H14").value, "Not started");
    assert.equal(incompleteTemplate.getCell("AH14").value, "No proof uploaded");
    assert.equal(incompleteTemplate.getCell("B15").value, null);
    assert.deepEqual(Object.keys(incompleteTemplate.getCell("B15").style || {}), []);

    const releasedSnapshotPath = path.join(tempDirectory, "released-project-snapshot.xlsx");
    await generateDesignProjectExecutionTemplateExcel({
      context: {
        ...sample.context,
        status: "released",
        project_no: "PARC-RELEASED",
        project_name: "Released Snapshot",
      },
      fixtures: sample.fixtures.map((fixture) => ({
        ...fixture,
        task_status: "closed",
      })),
      reportData: {
        ...sample.reportData,
        projectTruth: {
          ...sample.reportData.projectTruth,
          truth_status: "COMPLETE",
          completion_percent: 100,
          strict_complete: true,
          fixtures: sample.fixtures.map((fixture) => ({
            fixture_id: fixture.fixture_id,
            strict_complete: true,
            has_blocking_hold: false,
            has_unresolved_reject: false,
            has_active_rework: false,
            is_outsourced: false,
            is_required_for_project_kpi: true,
          })),
        },
      },
      filePath: releasedSnapshotPath,
    });
    const releasedWorkbook = new ExcelJS.Workbook();
    await releasedWorkbook.xlsx.readFile(releasedSnapshotPath);
    const releasedTemplate = releasedWorkbook.getWorksheet("Design Project Execution");
    assert.equal(releasedTemplate.getCell("A5").value, "PARC-RELEASED");
    assert.equal(releasedTemplate.getCell("A8").value, "Completion: 100%");
    assert.equal(releasedTemplate.getCell("G14").value, "Status: Closed\nCurrent Stage: Completed");
    assert.equal(releasedTemplate.autoFilter, "A13:AM18");

    const pdfBuffer = generateDesignManagementPdf(model);
    assert.ok(pdfBuffer.length > 5000);
    assert.equal(pdfBuffer.subarray(0, 8).toString("utf8"), "%PDF-1.4");
    const pdfText = pdfBuffer.toString("utf8");
    assert.match(pdfText, /Executive Summary/);
    assert.match(pdfText, /PARC Task Control System/);
    assert.match(pdfText, /SECTION 6 - FIXTURE BREAKDOWN/);
    assert.match(pdfText, /FIXTURE STAGE DETAILS/);
    assert.match(pdfText, /Fixture Stage Execution Audit/);
    assert.match(pdfText, /Contribution % Not Recorded/);
    assert.match(pdfText, /WORK PROOF HISTORY/);
  } finally {
    await fs.rm(tempDirectory, { recursive: true, force: true });
  }

  console.log("designReportManagementExport.test.js passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
