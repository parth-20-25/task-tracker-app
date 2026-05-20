const fs = require("fs/promises");
const path = require("path");
const ExcelJS = require("exceljs");
const { normalizeDesignStageName } = require("../../lib/designWorkflowStages");
const {
  formatStageRevisionCode,
  normalizeStageVersion,
} = require("../../lib/workflowStageVersioning");
const { buildWeightMapForStageKeys, resolveStageKeysFromProgress } = require("../designCompletion/stageWeightModel");
const { REPORT_STAGES, getStageBucket } = require("./designReportValidation");
const {
  formatApprovalStatus,
  formatDateRange,
  formatDuration,
  formatHoldHistory,
  formatProofRegister,
  formatStageContributors,
  formatStageProgressPercent,
  formatStageRevisionBlock,
  formatTimelineTimestamp,
  resolveRevisionForStage,
} = require("./designReportPresentation");
const { resolveFixtureGlobalStatus, resolveReportKpisFromCompletionTruth } = require("./designReportKpiContract");

const DESIGN_REPORT_TEMPLATE_PATH = path.join(
  __dirname,
  "..",
  "..",
  "templates",
  "design_project_execution_report_template.xlsx",
);

const TEMPLATE_DATA_COLUMN_COUNT = 39;
const TEMPLATE_FIRST_DATA_ROW = 14;

const MAX_STAGE_DURATION_MINUTES = 1000 * 60;

function cloneStyle(style) {
  return JSON.parse(JSON.stringify(style || {}));
}

function writeMergedValue(worksheet, address, value) {
  worksheet.getCell(address).value = value ?? "";
}

function normalizeStatus(value) {
  return String(value || "").trim().toUpperCase();
}

function minutesBetween(startValue, endValue) {
  const start = startValue ? new Date(startValue) : null;
  const end = endValue ? new Date(endValue) : null;

  if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return null;
  }

  const diffMinutes = Math.round((end.getTime() - start.getTime()) / 60000);
  if (diffMinutes <= 0 || diffMinutes > MAX_STAGE_DURATION_MINUTES) {
    return null;
  }

  return diffMinutes;
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

function formatAttemptLine(attempt, isDelayed, progressStatus) {
  const assigned = formatTimelineTimestamp(attempt.assigned_at || attempt.started_at);
  const completed = formatTimelineTimestamp(attempt.actual_end || getAttemptActualEnd(attempt, progressStatus));

  if (!assigned && !completed) {
    return "";
  }

  if (!completed) {
    return assigned ? `${assigned} →` : "";
  }

  if (isDelayed) {
    return `${assigned || ""} → ${completed} (Rework)`.trim();
  }

  return `${assigned || ""} → ${completed}`.trim();
}

function buildStagePresentation({ stageAttempts, progressRow, isCurrent }) {
  if (!progressRow) {
    return {
      timeline: "",
      minutes: null,
      assignedAt: null,
      completedAt: null,
    };
  }

  const progressStatus = normalizeStatus(progressRow.status);
  const attempts = (Array.isArray(stageAttempts) ? stageAttempts : [])
    .map((attempt) => ({
      ...attempt,
      actual_end: getAttemptActualEnd(attempt, progressStatus),
    }))
    .sort((left, right) => Number(left.attempt_no || 0) - Number(right.attempt_no || 0));

  const visibleAttempts = attempts.filter((attempt) => {
    if (normalizeStatus(attempt.status) === "IN_PROGRESS") {
      return isCurrent && Boolean(attempt.started_at || attempt.assigned_at);
    }

    return Boolean(attempt.actual_end || attempt.completed_at || attempt.approved_at);
  });

  const lines = visibleAttempts
    .map((attempt, index) => {
      const isDelayed = index < visibleAttempts.length - 1 || normalizeStatus(attempt.status) === "REJECTED";
      return formatAttemptLine(attempt, isDelayed, progressStatus);
    })
    .filter(Boolean);

  const minutes = visibleAttempts.reduce((sum, attempt) => {
    const duration = Number.isFinite(attempt.duration_minutes)
      ? Math.round(attempt.duration_minutes)
      : minutesBetween(attempt.assigned_at || attempt.started_at, attempt.actual_end);
    return duration === null ? sum : sum + duration;
  }, 0);

  const firstVisibleAttempt = visibleAttempts[0] || null;
  const lastVisibleAttempt = visibleAttempts.length > 0 ? visibleAttempts[visibleAttempts.length - 1] : null;

  return {
    timeline: lines.join("\n"),
    minutes: minutes > 0 ? minutes : null,
    assignedAt: firstVisibleAttempt?.assigned_at || firstVisibleAttempt?.started_at || progressRow.assigned_at || progressRow.started_at || null,
    completedAt: lastVisibleAttempt?.actual_end || lastVisibleAttempt?.completed_at || progressRow.completed_at || null,
  };
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

function buildFixtureAttemptLookup(attemptRows) {
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

function buildStageTaskLookup(stageTasks, attachmentsByTaskId, activitiesByTaskId = new Map()) {
  return stageTasks.reduce((map, task) => {
    const stageKey = getStageBucket(task.stage_name);
    if (!stageKey) {
      return map;
    }

    const fixtureMap = map.get(task.fixture_id) || new Map();
    const entries = fixtureMap.get(stageKey) || [];
    const attachmentUrls = (attachmentsByTaskId.get(Number(task.task_id)) || [])
      .map((attachment) => attachment.file_url)
      .filter(Boolean);

    entries.push({
      ...task,
      proof_urls: [
        ...attachmentUrls,
        ...(
          Array.isArray(task.proof_url)
            ? task.proof_url
            : task.proof_url
              ? [task.proof_url]
              : []
        ),
      ].filter(Boolean),
      activities: activitiesByTaskId.get(Number(task.task_id)) || [],
    });
    fixtureMap.set(stageKey, entries);
    map.set(task.fixture_id, fixtureMap);
    return map;
  }, new Map());
}

function buildStageWeightLookup(progressRows, weightRows, workflowStages) {
  const stageKeys = resolveStageKeysFromProgress(progressRows, workflowStages);
  return buildWeightMapForStageKeys(stageKeys, weightRows);
}

function buildTemplateFixtureRows({
  fixtures,
  progressRows,
  attemptRows,
  contributions,
  revisions,
  stageTaskLookup,
  projectTruth,
  weightRows = [],
  workflowStages = [],
}) {
  const progressLookup = progressRows.reduce((map, row) => {
    const fixtureMap = map.get(row.fixture_id) || new Map();
    const stageKey = getStageBucket(row.stage_name);
    if (stageKey) {
      fixtureMap.set(stageKey, row);
    }
    map.set(row.fixture_id, fixtureMap);
    return map;
  }, new Map());
  const attemptLookup = buildFixtureAttemptLookup(attemptRows);
  const contributionLookup = buildContributionLookup(contributions);
  const revisionLookup = buildRevisionLookup(revisions);
  const fixtureTruthById = new Map(
    (projectTruth?.fixtures || []).map((truth) => [String(truth.fixture_id), truth]),
  );
  const weightByStageKey = buildStageWeightLookup(progressRows, weightRows, workflowStages);
  const stagesWithoutRevisionColumn = new Set(["three_d_finish"]);

  return fixtures.map((fixture, index) => {
    const fixtureProgress = progressLookup.get(fixture.fixture_id) || new Map();
    const fixtureAttempts = attemptLookup.get(String(fixture.fixture_id)) || new Map();
    const fixtureStageTasks = stageTaskLookup.get(fixture.fixture_id) || new Map();
    const fixtureTruth = fixtureTruthById.get(String(fixture.fixture_id)) || null;
    const stageCells = {};
    let actualMinutes = 0;

    for (const stage of REPORT_STAGES) {
      const progressRow = fixtureProgress.get(stage.key) || null;
      const presentation = buildStagePresentation({
        stageAttempts: fixtureAttempts.get(stage.key) || [],
        progressRow,
        isCurrent: normalizeStatus(progressRow?.status) === "IN_PROGRESS",
      });
      const revisionRow = resolveRevisionForStage(revisionLookup, fixture.fixture_id, progressRow);
      const revisionCode = progressRow
        ? formatStageRevisionCode(progressRow.stage_name, normalizeStageVersion(progressRow.stage_version))
        : "";
      const contributionRows = progressRow
        ? contributionLookup.get(`${fixture.fixture_id}::${progressRow.stage_name}::${revisionCode}`) || []
        : [];
      const stageKey = normalizeDesignStageName(progressRow?.stage_name);
      const weightPercent = weightByStageKey.get(stageKey) || 0;
      const revisionText = formatStageRevisionBlock(progressRow, revisionRow);
      const employees = formatStageContributors(contributionRows);
      const approvalStatus = formatApprovalStatus(progressRow);
      const stageTasks = fixtureStageTasks.get(stage.key) || [];

      actualMinutes += Number(presentation.minutes || 0);
      stageCells[stage.key] = {
        hrs: presentation.minutes ? formatDuration(presentation.minutes) : "",
        dateRange: formatDateRange(presentation.assignedAt, presentation.completedAt),
        progress: formatStageProgressPercent(progressRow, weightPercent),
        revision: revisionText,
        employees,
        approvalStatus: revisionText && stagesWithoutRevisionColumn.has(stage.key)
          ? [approvalStatus, revisionText].filter(Boolean).join("\n")
          : approvalStatus,
        proof: formatProofRegister(stageTasks),
        holdHistory: formatHoldHistory(stageTasks),
        timeline: presentation.timeline,
      };
    }

    return {
      srNo: index + 1,
      fixtureNo: fixture.fixture_no,
      opNo: fixture.op_no,
      partName: fixture.part_name,
      priority: fixture.task_priority || "",
      assigned: fixture.task_assignee_name || fixture.task_assigned_to || "",
      globalStatus: resolveFixtureGlobalStatus(fixtureTruth, fixture),
      concept: stageCells.concept,
      dap: stageCells.dap,
      finish3d: stageCells.three_d_finish,
      finish2d: stageCells.two_d_finish,
      plannedHrs: formatDuration(Number(fixture.task_planned_minutes || 0)),
      actualHrs: formatDuration(Number(fixture.task_actual_minutes || 0) || actualMinutes),
    };
  });
}

function writeDesignTemplateRow(worksheet, rowNumber, row) {
  const values = {
    A: row.srNo,
    B: row.fixtureNo,
    C: row.opNo,
    D: row.partName,
    E: row.priority,
    F: row.assigned,
    G: row.globalStatus,
    H: row.concept.hrs,
    I: row.concept.dateRange || row.concept.timeline,
    J: row.concept.progress,
    K: row.concept.revision,
    L: row.concept.employees,
    M: row.concept.approvalStatus,
    N: row.dap.hrs,
    O: row.dap.dateRange || row.dap.timeline,
    P: row.dap.progress,
    Q: row.dap.revision,
    R: row.dap.employees,
    S: row.dap.approvalStatus,
    T: row.finish3d.hrs,
    U: row.finish3d.dateRange || row.finish3d.timeline,
    V: row.finish3d.progress,
    W: row.finish3d.employees,
    X: row.finish3d.approvalStatus,
    Y: row.finish2d.hrs,
    Z: row.finish2d.dateRange || row.finish2d.timeline,
    AA: row.finish2d.progress,
    AB: row.finish2d.revision,
    AC: row.finish2d.approvalStatus,
    AD: row.concept.holdHistory,
    AE: row.dap.holdHistory,
    AF: row.finish3d.holdHistory,
    AG: row.finish2d.holdHistory,
    AH: row.concept.proof,
    AI: row.dap.proof,
    AJ: row.finish3d.proof,
    AK: row.finish2d.proof,
    AL: row.plannedHrs,
    AM: row.actualHrs,
  };

  for (const [column, value] of Object.entries(values)) {
    worksheet.getCell(`${column}${rowNumber}`).value = value;
  }
}

function estimateRowHeight(row, templateHeight) {
  const segments = [
    row.concept,
    row.dap,
    row.finish3d,
    row.finish2d,
  ].flatMap((stage) => [
    stage.timeline,
    stage.revision,
    stage.employees,
    stage.approvalStatus,
    stage.holdHistory,
    stage.proof,
  ]);

  const maxLines = segments.reduce((max, value) => {
    const lineCount = String(value || "").split("\n").length;
    return Math.max(max, lineCount);
  }, 1);

  return Math.max(templateHeight || 18, Math.min(120, 18 + (maxLines - 1) * 12));
}

async function generateDesignProjectExecutionTemplateExcel({
  context,
  fixtures,
  reportData,
  filePath,
}) {
  const {
    progressRows,
    attemptRows,
    contributions,
    revisions,
    stageTasks,
    attachmentsByTaskId,
    activitiesByTaskId,
    projectTruth,
    weightRows,
    workflowStages,
  } = reportData;

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(DESIGN_REPORT_TEMPLATE_PATH);
  const worksheet = workbook.worksheets[0];
  const templateRow = worksheet.getRow(TEMPLATE_FIRST_DATA_ROW);
  const templateStyles = Array.from(
    { length: TEMPLATE_DATA_COLUMN_COUNT },
    (_, index) => cloneStyle(templateRow.getCell(index + 1).style),
  );
  const templateHeight = templateRow.height;
  const existingDataRows = Math.max(0, worksheet.rowCount - (TEMPLATE_FIRST_DATA_ROW - 1));

  if (existingDataRows > 0) {
    worksheet.spliceRows(TEMPLATE_FIRST_DATA_ROW, existingDataRows);
  }

  const stageTaskLookup = buildStageTaskLookup(stageTasks, attachmentsByTaskId, activitiesByTaskId);
  const rows = buildTemplateFixtureRows({
    fixtures,
    progressRows,
    attemptRows,
    contributions,
    revisions,
    stageTaskLookup,
    projectTruth,
    weightRows,
    workflowStages,
  });

  rows.forEach((row, index) => {
    const rowNumber = TEMPLATE_FIRST_DATA_ROW + index;
    worksheet.spliceRows(rowNumber, 0, []);
    const excelRow = worksheet.getRow(rowNumber);
    excelRow.height = estimateRowHeight(row, templateHeight);

    for (let columnIndex = 1; columnIndex <= TEMPLATE_DATA_COLUMN_COUNT; columnIndex += 1) {
      excelRow.getCell(columnIndex).style = cloneStyle(templateStyles[columnIndex - 1]);
      excelRow.getCell(columnIndex).alignment = {
        ...(excelRow.getCell(columnIndex).alignment || {}),
        wrapText: true,
        vertical: "middle",
        horizontal: columnIndex >= 8 ? "center" : excelRow.getCell(columnIndex).alignment?.horizontal || "left",
      };
    }

    writeDesignTemplateRow(worksheet, rowNumber, row);
    excelRow.commit();
  });

  const kpiResult = resolveReportKpisFromCompletionTruth(projectTruth, rows);
  if (!kpiResult.ok) {
    throw new Error(kpiResult.error || "Unable to resolve report KPI truth");
  }

  const { kpis } = kpiResult;
  writeMergedValue(worksheet, "A2", `Report Date: ${new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}`);
  writeMergedValue(worksheet, "A5", context.project_no || "");
  writeMergedValue(worksheet, "E5", context.project_name || "");
  writeMergedValue(worksheet, "I5", context.customer_name || "");
  writeMergedValue(worksheet, "M5", context.plant || "");
  writeMergedValue(worksheet, "Q5", context.project_leader_name || context.project_leader_id || "");
  writeMergedValue(worksheet, "U5", context.team_lead_name || context.team_lead_id || "");
  writeMergedValue(worksheet, "A8", kpis.overallProgress);
  writeMergedValue(worksheet, "E8", kpis.totalFixtures);
  writeMergedValue(worksheet, "I8", kpis.completed);
  writeMergedValue(worksheet, "M8", kpis.pending);
  writeMergedValue(worksheet, "Q8", kpis.overdue);
  writeMergedValue(worksheet, "U8", kpis.onHold);
  writeMergedValue(worksheet, "Y8", kpis.rejected);

  await workbook.xlsx.writeFile(filePath);
  return rows;
}

module.exports = {
  DESIGN_REPORT_TEMPLATE_PATH,
  buildTemplateFixtureRows,
  generateDesignProjectExecutionTemplateExcel,
  writeDesignTemplateRow,
};
