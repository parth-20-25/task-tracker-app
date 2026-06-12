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
  formatStageProgressPercent,
  formatStageRevisionBlock,
  formatTimelineTimestamp,
  resolveRevisionForStage,
} = require("./designReportPresentation");
const {
  STATUS_LABELS,
  resolveFixtureGlobalStatus,
  resolveReportKpisFromCompletionTruth,
} = require("./designReportKpiContract");

const DESIGN_REPORT_TEMPLATE_PATH = path.join(
  __dirname,
  "..",
  "..",
  "templates",
  "design_project_execution_report_template.xlsx",
);

const TEMPLATE_DATA_COLUMN_COUNT = 39;
const TEMPLATE_FIRST_DATA_ROW = 14;
const TEMPLATE_HEADER_ROW = 13;
const TEMPLATE_STYLE_ROW = 15;

const MAX_STAGE_DURATION_MINUTES = 1000 * 60;
const NOT_AVAILABLE = "Not available";
const NOT_STARTED = "Not started";
const NOT_ASSIGNED = "Not assigned";
const NOT_COMPLETED = "Not completed";
const NOT_RECORDED = "Not recorded";
const NO_PROOF_UPLOADED = "No proof uploaded";
const CONTRIBUTION_NOT_RECORDED = "Contribution % Not Recorded";

const STATUS_COLORS = Object.freeze({
  [STATUS_LABELS.ASSIGNED]: "3A7BD5",
  [STATUS_LABELS.IN_PROGRESS]: "28A745",
  [STATUS_LABELS.ON_HOLD]: "FF9800",
  [STATUS_LABELS.REVIEW]: "009688",
  [STATUS_LABELS.REWORK]: "9C27B0",
  [STATUS_LABELS.CLOSED]: "616161",
  [STATUS_LABELS.OVERDUE]: "D32F2F",
});

function cloneStyle(style) {
  return JSON.parse(JSON.stringify(style || {}));
}

function writeMergedValue(worksheet, address, value) {
  worksheet.getCell(address).value = value ?? "";
}

function toArgb(color) {
  const normalized = String(color || "").replace("#", "").trim();
  return normalized.length === 8 ? normalized : `FF${normalized}`;
}

function styleStatusCell(cell, status) {
  const color = STATUS_COLORS[status];
  if (!color) {
    return;
  }

  cell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: toArgb(color) },
  };
  cell.font = {
    ...(cell.font || {}),
    color: { argb: "FFFFFFFF" },
    bold: true,
  };
  cell.alignment = {
    ...(cell.alignment || {}),
    horizontal: "center",
    vertical: "middle",
    wrapText: true,
  };
}

function withKpiLabel(label, value) {
  return `${label}: ${value === null || value === undefined || value === "" ? NOT_AVAILABLE : value}`;
}

function calculateLiveStatusKpis(rows) {
  const totalFixtures = rows.length;
  const completed = rows.filter((row) => row.globalStatus === STATUS_LABELS.CLOSED).length;
  const pending = rows.filter((row) => [
    STATUS_LABELS.ASSIGNED,
    STATUS_LABELS.IN_PROGRESS,
    STATUS_LABELS.REVIEW,
  ].includes(row.globalStatus)).length;
  const overdue = rows.filter((row) => row.globalStatus === STATUS_LABELS.OVERDUE).length;
  const onHold = rows.filter((row) => row.globalStatus === STATUS_LABELS.ON_HOLD).length;
  const rejected = rows.filter((row) => row.globalStatus === STATUS_LABELS.REWORK).length;

  return {
    overallProgress: NOT_AVAILABLE,
    totalFixtures,
    completed,
    pending,
    overdue,
    onHold,
    rejected,
  };
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

function getFirstProofUrl(stageTasks = []) {
  return stageTasks
    .flatMap((task) => (Array.isArray(task.proof_urls) ? task.proof_urls : []))
    .filter(Boolean)[0] || "";
}

function normalizeText(value) {
  return String(value || "").trim();
}

function formatEmployeeName(employeeId, employeeName) {
  const id = normalizeText(employeeId);
  const name = normalizeText(employeeName);

  if (id && name && name !== id) {
    return `${id} - ${name}`;
  }

  if (id) {
    return `${id} - ${NOT_RECORDED}`;
  }

  return name;
}

function requiredText(value, placeholder = NOT_RECORDED) {
  return normalizeText(value) || placeholder;
}

function formatAllocationPercent(value) {
  if (value === null || value === undefined || value === "") {
    return CONTRIBUTION_NOT_RECORDED;
  }

  const percent = Number(String(value).replace("%", "").trim());
  if (!Number.isFinite(percent)) {
    return CONTRIBUTION_NOT_RECORDED;
  }

  return `${Number.isInteger(percent) ? percent : percent.toFixed(2)}%`;
}

function formatEmployeeAllocationLine(row) {
  const name = formatEmployeeName(row.employee_id, row.employee_name);
  if (!name) {
    return "";
  }

  const percent = formatAllocationPercent(row.contribution_percent);
  return `${name}: ${percent}`;
}

function dedupeEmployeeAllocationRows(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = [
      normalizeText(row.employee_id),
      normalizeText(row.employee_name).toLowerCase(),
      formatAllocationPercent(row.contribution_percent),
    ].join("::");
    if (!normalizeText(row.employee_id) && !normalizeText(row.employee_name)) {
      return false;
    }
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function metadataValue(metadata, keys) {
  if (!metadata || typeof metadata !== "object") {
    return "";
  }

  for (const key of keys) {
    const value = metadata[key];
    if (value !== undefined && value !== null && String(value).trim()) {
      return value;
    }
  }

  return "";
}

function collectTransferAllocationRows({ stageTasks, stage, revisionCode, revisionNo }) {
  return stageTasks.flatMap((task) => (
    (task.activities || []).flatMap((activity) => {
      const metadata = activity.metadata && typeof activity.metadata === "object" ? activity.metadata : {};
      const reassignment = metadata.reassignment_contribution;
      if (!reassignment || typeof reassignment !== "object") {
        return [];
      }

      const activityStageKey = getStageBucket(
        reassignment.stage_name
        || metadata.stage_name
        || metadata.stage
        || task.stage_name,
      );
      if (activityStageKey && activityStageKey !== stage.key) {
        return [];
      }

      const activityRevisionNo = normalizeStageVersion(
        reassignment.stage_revision_no
        ?? metadata.stage_revision_no
        ?? revisionNo,
      );
      const activityRevisionCode = normalizeText(
        reassignment.revision_code
        || metadata.revision_code
        || metadata.stage_revision_code,
      );
      if (activityRevisionCode && activityRevisionCode !== revisionCode) {
        return [];
      }
      if (!activityRevisionCode && activityRevisionNo !== revisionNo) {
        return [];
      }

      return [
        {
          employee_id: metadataValue(reassignment, ["previous_assigned_to", "previous_employee_id"]),
          employee_name: metadataValue(reassignment, ["previous_assigned_to_name", "previous_employee_name"]),
          contribution_percent: metadataValue(reassignment, [
            "previous_contribution_percent",
            "completed_contribution_percent",
          ]),
        },
        {
          employee_id: metadataValue(reassignment, ["next_assigned_to", "new_assigned_to", "remaining_assigned_to"]),
          employee_name: metadataValue(reassignment, [
            "next_assigned_to_name",
            "new_assigned_to_name",
            "remaining_assigned_to_name",
          ]),
          contribution_percent: metadataValue(reassignment, [
            "remaining_contribution_percent",
            "next_contribution_percent",
          ]),
        },
      ];
    })
  ));
}

function collectAssignedEmployeeRows({ progressRow, stageAttempts, stageTasks }) {
  return dedupeEmployeeAllocationRows([
    ...stageAttempts.map((attempt) => ({
      employee_id: attempt.assigned_to,
      employee_name: attempt.assigned_to_name,
    })),
    ...stageTasks.map((task) => ({
      employee_id: task.assigned_to,
      employee_name: task.assignee_names || task.assigned_to_name,
    })),
    {
      employee_id: progressRow?.assigned_to,
      employee_name: progressRow?.assigned_to_name,
    },
  ]);
}

function formatStageEmployeeAllocations({
  contributionRows,
  stageTasks,
  stageAttempts,
  progressRow,
  stage,
  revisionCode,
  revisionNo,
}) {
  const allocatedRows = dedupeEmployeeAllocationRows([
    ...contributionRows,
    ...collectTransferAllocationRows({
      stageTasks,
      stage,
      revisionCode,
      revisionNo,
    }),
  ]);
  const rows = allocatedRows.length
    ? allocatedRows
    : collectAssignedEmployeeRows({
      progressRow,
      stageAttempts,
      stageTasks,
    });

  return rows
    .map(formatEmployeeAllocationLine)
    .filter(Boolean)
    .join("\n") || NOT_ASSIGNED;
}

function buildStageWeightLookup(progressRows, weightRows, workflowStages) {
  const stageKeys = resolveStageKeysFromProgress(progressRows, workflowStages);
  return buildWeightMapForStageKeys(stageKeys, weightRows);
}

function formatDurationOrNotRecorded(minutes, label) {
  const numeric = Number(minutes);
  const formatted = Number.isFinite(numeric) && numeric > 0
    ? formatDuration(numeric)
    : NOT_RECORDED;
  return label ? `${label}: ${formatted}` : formatted;
}

function formatSignedDuration(minutes) {
  const numeric = Number(minutes);
  if (!Number.isFinite(numeric)) {
    return NOT_AVAILABLE;
  }

  if (numeric === 0) {
    return "0h 0m";
  }

  const sign = numeric > 0 ? "+" : "-";
  return `${sign}${formatDuration(Math.abs(numeric))}`;
}

function formatVariance(plannedMinutes, actualMinutes) {
  const planned = Number(plannedMinutes);
  const actual = Number(actualMinutes);
  if (!Number.isFinite(planned) || planned <= 0 || !Number.isFinite(actual) || actual <= 0) {
    return `Variance: ${NOT_AVAILABLE}`;
  }

  return `Variance: ${formatSignedDuration(actual - planned)}`;
}

function formatStageDateCell(progressRow, presentation) {
  if (!progressRow || normalizeStatus(progressRow.status) === "PENDING") {
    return NOT_STARTED;
  }

  const range = formatDateRange(presentation.assignedAt, presentation.completedAt);
  if (range) {
    return range;
  }

  const start = formatTimelineTimestamp(presentation.assignedAt || progressRow.assigned_at || progressRow.started_at);
  if (start) {
    return `${start} -> ${NOT_COMPLETED}`;
  }

  return NOT_RECORDED;
}

function formatStageHoursCell(progressRow, minutes) {
  if (!progressRow || normalizeStatus(progressRow.status) === "PENDING") {
    return NOT_STARTED;
  }

  return Number(minutes) > 0 ? formatDuration(minutes) : NOT_RECORDED;
}

function formatStageProgressCell(progressRow, weightPercent) {
  if (!progressRow || normalizeStatus(progressRow.status) === "PENDING") {
    return NOT_STARTED;
  }

  return formatStageProgressPercent(progressRow, weightPercent) || NOT_AVAILABLE;
}

function formatStageRevisionCell(progressRow, revisionRow) {
  if (!progressRow || normalizeStatus(progressRow.status) === "PENDING") {
    return NOT_STARTED;
  }

  return formatStageRevisionBlock(progressRow, revisionRow) || NOT_RECORDED;
}

function formatApprovalStatusCell(progressRow) {
  if (!progressRow || normalizeStatus(progressRow.status) === "PENDING") {
    return NOT_STARTED;
  }

  return formatApprovalStatus(progressRow) || NOT_RECORDED;
}

function formatPerson(employeeId, employeeName) {
  return formatEmployeeName(employeeId, employeeName) || "";
}

function getLatestStageTask(stageTasks = []) {
  return stageTasks.length ? stageTasks[stageTasks.length - 1] : null;
}

function formatAssignmentSummary({ assignedTo, assignedBy }) {
  return [
    `Assigned To: ${assignedTo || NOT_ASSIGNED}`,
    `Assigned By: ${assignedBy || NOT_RECORDED}`,
  ].join("\n");
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
    let currentStageName = "";
    let currentAssignedTo = "";
    let currentAssignedBy = "";
    let latestAssignedTo = "";
    let latestAssignedBy = "";
    let actualMinutes = 0;

    for (const stage of REPORT_STAGES) {
      const progressRow = fixtureProgress.get(stage.key) || null;
      const progressStatus = normalizeStatus(progressRow?.status);
      const presentation = buildStagePresentation({
        stageAttempts: fixtureAttempts.get(stage.key) || [],
        progressRow,
        isCurrent: progressStatus === "IN_PROGRESS",
      });
      const stageAttempts = fixtureAttempts.get(stage.key) || [];
      const revisionRow = resolveRevisionForStage(revisionLookup, fixture.fixture_id, progressRow);
      const revisionCode = progressRow
        ? formatStageRevisionCode(progressRow.stage_name, normalizeStageVersion(progressRow.stage_version))
        : "";
      const revisionNo = progressRow ? normalizeStageVersion(progressRow.stage_version) : 0;
      const contributionRows = progressRow
        ? contributionLookup.get(`${fixture.fixture_id}::${progressRow.stage_name}::${revisionCode}`) || []
        : [];
      const stageKey = normalizeDesignStageName(progressRow?.stage_name);
      const weightPercent = weightByStageKey.get(stageKey) || 0;
      const stageTasks = fixtureStageTasks.get(stage.key) || [];
      const latestStageTask = getLatestStageTask(stageTasks);
      const stageAssignedTo = formatPerson(
        latestStageTask?.assigned_to || progressRow?.assigned_to,
        latestStageTask?.assignee_names || latestStageTask?.assigned_to_name || progressRow?.assigned_to_name,
      );
      const stageAssignedBy = formatPerson(
        latestStageTask?.assigned_by,
        latestStageTask?.assigned_by_name,
      );
      const revisionText = formatStageRevisionCell(progressRow, revisionRow);
      const approvalStatus = formatApprovalStatusCell(progressRow);
      const employees = formatStageEmployeeAllocations({
        contributionRows,
        stageTasks,
        stageAttempts,
        progressRow,
        stage,
        revisionCode,
        revisionNo,
      });

      if (stageAssignedTo) {
        latestAssignedTo = stageAssignedTo;
      }
      if (stageAssignedBy) {
        latestAssignedBy = stageAssignedBy;
      }
      if (
        progressRow
        && !["APPROVED", "PENDING"].includes(progressStatus)
      ) {
        currentStageName = stage.label;
        currentAssignedTo = stageAssignedTo;
        currentAssignedBy = stageAssignedBy;
      }

      actualMinutes += Number(presentation.minutes || 0);
      stageCells[stage.key] = {
        hrs: formatStageHoursCell(progressRow, presentation.minutes),
        dateRange: formatStageDateCell(progressRow, presentation),
        progress: formatStageProgressCell(progressRow, weightPercent),
        revision: revisionText,
        employees,
        approvalStatus: revisionText && stagesWithoutRevisionColumn.has(stage.key)
          ? [approvalStatus, revisionText].filter(Boolean).join("\n")
          : approvalStatus,
        proof: formatProofRegister(stageTasks) || NO_PROOF_UPLOADED,
        proofUrl: getFirstProofUrl(stageTasks),
        holdHistory: formatHoldHistory(stageTasks) || NOT_RECORDED,
        timeline: presentation.timeline,
      };
    }

    if (!currentStageName) {
      const firstOpenStage = fixtureProgress.size
        ? REPORT_STAGES.find((stage) => (
          normalizeStatus(fixtureProgress.get(stage.key)?.status) !== "APPROVED"
        ))
        : null;
      currentStageName = firstOpenStage?.label || (fixtureProgress.size ? "Completed" : NOT_STARTED);
    }

    const plannedMinutes = Number(fixture.task_planned_minutes || 0);
    const resolvedActualMinutes = Number(fixture.task_actual_minutes || 0) || actualMinutes;
    const assignedTo = currentAssignedTo
      || latestAssignedTo
      || formatPerson(fixture.task_assigned_to, fixture.task_assignee_name);
    const assignedBy = currentAssignedBy
      || latestAssignedBy
      || formatPerson(fixture.task_assigned_by, fixture.task_assigned_by_name);

    return {
      srNo: index + 1,
      fixtureNo: requiredText(fixture.fixture_no),
      opNo: requiredText(fixture.op_no),
      partName: requiredText(fixture.part_name),
      priority: requiredText(fixture.task_priority),
      assigned: formatAssignmentSummary({ assignedTo, assignedBy }),
      globalStatus: resolveFixtureGlobalStatus(fixtureTruth, fixture),
      currentStage: currentStageName,
      concept: stageCells.concept,
      dap: stageCells.dap,
      finish3d: stageCells.three_d_finish,
      finish2d: stageCells.two_d_finish,
      plannedHrs: formatDurationOrNotRecorded(plannedMinutes, "Planned Hours"),
      actualHrs: [
        formatDurationOrNotRecorded(resolvedActualMinutes, "Actual Hours"),
        formatVariance(plannedMinutes, resolvedActualMinutes),
      ].join("\n"),
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
    G: [`Status: ${row.globalStatus}`, `Current Stage: ${row.currentStage || NOT_AVAILABLE}`].join("\n"),
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
  const hyperlinks = {
    AH: row.concept.proofUrl,
    AI: row.dap.proofUrl,
    AJ: row.finish3d.proofUrl,
    AK: row.finish2d.proofUrl,
  };

  for (const [column, value] of Object.entries(values)) {
    const cell = worksheet.getCell(`${column}${rowNumber}`);
    const hyperlink = hyperlinks[column];
    if (hyperlink) {
      cell.value = {
        text: value || "View Proof",
        hyperlink,
      };
      cell.font = {
        ...(cell.font || {}),
        color: { argb: "FF1D4ED8" },
        underline: true,
      };
    } else {
      cell.value = value;
      if (["AH", "AI", "AJ", "AK"].includes(column)) {
        cell.font = {
          ...(cell.font || {}),
          color: { argb: "FF000000" },
          underline: false,
        };
      }
    }
  }

  styleStatusCell(worksheet.getCell(`G${rowNumber}`), row.globalStatus);
}

function estimateRowHeight(row, templateHeight) {
  const segments = [
    row.assigned,
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

function findTemplateStyleRow(worksheet, startRow, columnCount) {
  for (let rowNumber = TEMPLATE_STYLE_ROW; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const hasStyle = Array.from({ length: columnCount }, (_unused, index) => (
      Object.keys(row.getCell(index + 1).style || {}).length > 0
    )).some(Boolean);

    if (hasStyle) {
      return row;
    }
  }

  return worksheet.getRow(startRow);
}

function removeTemplateDataRows(worksheet, startRow) {
  const rowsToDelete = worksheet.rowCount >= startRow
    ? worksheet.rowCount - startRow + 1
    : 0;

  if (rowsToDelete > 0) {
    worksheet.spliceRows(startRow, rowsToDelete);
  }
}

function clearUnusedRows(worksheet, startRow, columnCount) {
  const endRow = Math.max(worksheet.rowCount, startRow);

  for (let rowNumber = startRow; rowNumber <= endRow; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    row.height = undefined;
    row.hidden = false;
    row.style = {};

    for (let columnIndex = 1; columnIndex <= columnCount; columnIndex += 1) {
      const cell = row.getCell(columnIndex);
      cell.value = null;
      cell.style = {};
      cell.note = undefined;
      cell.comment = undefined;
    }

    row.commit();
  }
}

function getDesignExecutionWorksheet(workbook) {
  const worksheet = workbook.worksheets.find((sheet) => (
    sheet.name.trim().toLowerCase() === "design project execution"
  )) || workbook.worksheets[0];

  if (!worksheet) {
    throw new Error("Design Project Execution worksheet is missing from report template");
  }

  workbook.worksheets.forEach((sheet) => {
    if (sheet.id !== worksheet.id) {
      workbook.removeWorksheet(sheet.id);
    }
  });
  worksheet.name = "Design Project Execution";
  worksheet.views = [];

  return worksheet;
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
  const worksheet = getDesignExecutionWorksheet(workbook);
  const templateRow = findTemplateStyleRow(worksheet, TEMPLATE_FIRST_DATA_ROW, TEMPLATE_DATA_COLUMN_COUNT);
  const templateStyles = Array.from(
    { length: TEMPLATE_DATA_COLUMN_COUNT },
    (_, index) => cloneStyle(templateRow.getCell(index + 1).style),
  );
  const templateHeight = templateRow.height;
  removeTemplateDataRows(worksheet, TEMPLATE_FIRST_DATA_ROW);

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
  clearUnusedRows(
    worksheet,
    TEMPLATE_FIRST_DATA_ROW + rows.length,
    TEMPLATE_DATA_COLUMN_COUNT,
  );

  const kpiResult = resolveReportKpisFromCompletionTruth(projectTruth, fixtures);
  const kpis = kpiResult.ok
    ? kpiResult.kpis
    : calculateLiveStatusKpis(rows);
  writeMergedValue(worksheet, "A2", `Report Date: ${new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}`);
  writeMergedValue(worksheet, "A5", requiredText(context.project_no));
  writeMergedValue(worksheet, "E5", requiredText(context.project_name));
  writeMergedValue(worksheet, "I5", requiredText(context.customer_name));
  writeMergedValue(worksheet, "M5", requiredText(context.plant));
  writeMergedValue(worksheet, "Q5", formatEmployeeName(context.project_leader_id, context.project_leader_name) || NOT_ASSIGNED);
  writeMergedValue(worksheet, "U5", formatEmployeeName(context.team_lead_id, context.team_lead_name) || NOT_ASSIGNED);
  writeMergedValue(worksheet, "A7", "Completion");
  writeMergedValue(worksheet, "E7", "Total Fixtures");
  writeMergedValue(worksheet, "I7", "Completed Fixtures");
  writeMergedValue(worksheet, "M7", "Active Fixtures");
  writeMergedValue(worksheet, "Q7", "Overdue Fixtures");
  writeMergedValue(worksheet, "U7", "On Hold Fixtures");
  writeMergedValue(worksheet, "Y7", "Rework Fixtures");
  writeMergedValue(worksheet, "A8", withKpiLabel("Completion", kpis.overallProgress));
  writeMergedValue(worksheet, "E8", withKpiLabel("Total Fixtures", kpis.totalFixtures));
  writeMergedValue(worksheet, "I8", withKpiLabel("Completed Fixtures", kpis.completed));
  writeMergedValue(worksheet, "M8", withKpiLabel("Active Fixtures", kpis.pending));
  writeMergedValue(worksheet, "Q8", withKpiLabel("Overdue Fixtures", kpis.overdue));
  writeMergedValue(worksheet, "U8", withKpiLabel("On Hold Fixtures", kpis.onHold));
  writeMergedValue(worksheet, "Y8", withKpiLabel("Rework Fixtures", kpis.rejected));

  ["A8", "E8", "I8", "M8", "Q8", "U8", "Y8"].forEach((address) => {
    worksheet.getCell(address).numFmt = "@";
  });
  worksheet.getCell("AM13").value = "Hrs / Variance";
  worksheet.views = [{ state: "frozen", ySplit: TEMPLATE_HEADER_ROW }];
  worksheet.autoFilter = {
    from: { row: TEMPLATE_HEADER_ROW, column: 1 },
    to: {
      row: Math.max(TEMPLATE_HEADER_ROW, TEMPLATE_FIRST_DATA_ROW + rows.length - 1),
      column: TEMPLATE_DATA_COLUMN_COUNT,
    },
  };

  await workbook.xlsx.writeFile(filePath);
  return rows;
}

module.exports = {
  DESIGN_REPORT_TEMPLATE_PATH,
  buildTemplateFixtureRows,
  generateDesignProjectExecutionTemplateExcel,
  writeDesignTemplateRow,
};
