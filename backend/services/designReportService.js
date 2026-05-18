const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const ExcelJS = require("exceljs");
const { pool } = require("../db");
const { AppError } = require("../lib/AppError");
const {
  getEffectiveDepartment,
  requireDepartmentContext,
} = require("../lib/departmentContext");
const { logger } = require("../lib/logger");
const { isAdmin } = require("./accessControlService");
const {
  buildVisibleUsersCte,
  visibleFixturePredicate,
  visibleProjectPredicate,
} = require("../repositories/projectVisibility");
const { listContributionsForFixtures } = require("../repositories/designStageContributionRepository");
const {
  formatStageRevisionCode,
  normalizeStageVersion,
} = require("../lib/workflowStageVersioning");

const DESIGN_REPORT_TEMPLATE_PATH = path.join(
  __dirname,
  "..",
  "templates",
  "design_project_execution_report_template.xlsx",
);

const STATUS_LABELS = {
  ASSIGNED: "Assigned",
  IN_PROGRESS: "In Progress",
  ON_HOLD: "On Hold",
  REVIEW: "Review",
  REWORK: "Rework",
  CLOSED: "Closed",
  OVERDUE: "Overdue",
};

const STATUS_COLORS = {
  [STATUS_LABELS.ASSIGNED]: "3A7BD5",
  [STATUS_LABELS.IN_PROGRESS]: "28A745",
  [STATUS_LABELS.ON_HOLD]: "FF9800",
  [STATUS_LABELS.REVIEW]: "009688",
  [STATUS_LABELS.REWORK]: "9C27B0",
  [STATUS_LABELS.CLOSED]: "616161",
  [STATUS_LABELS.OVERDUE]: "D32F2F",
};

const STAGE_STATUS_COLORS = {
  PENDING: "9E9E9E",
  IN_PROGRESS: "FFC107",
  COMPLETED: "4CAF50",
  APPROVED: "4CAF50",
  REJECTED: "F44336",
};

const REPORT_TYPES = {
  PROJECT: "project",
};

const STAGES = [
  { key: "concept", label: "CONCEPT" },
  { key: "dap", label: "DAP" },
  { key: "three_d_finish", label: "3D FINISH" },
  { key: "two_d_finish", label: "2D FINISH" },
];

const STAGE_KEYS = new Set(STAGES.map((stage) => stage.key));
const OPEN_TASK_STATUSES = new Set(["assigned", "in_progress", "on_hold", "under_review", "rework"]);
const MAX_STAGE_DURATION_MINUTES = 1000 * 60;
const TABLE_COLUMNS = [
  { key: "serialNumber", header: "S. No" },
  { key: "fixtureNo", header: "FIXTURE NO" },
  { key: "opNo", header: "OP.NO" },
  { key: "partName", header: "Part Name" },
  { key: "image1", header: "Image" },
  { key: "fixtureType", header: "Fixture Type" },
  { key: "qty", header: "QTY" },
  { key: "remark", header: "Remark" },
  { key: "image2", header: "image" },
  { key: "designer", header: "designer" },
  { key: "concept", header: "CONCEPT" },
  { key: "conceptTime", header: "In hrs/mins" },
  { key: "dap", header: "DAP" },
  { key: "dapTime", header: "In hrs/mins" },
  { key: "three_d_finish", header: "3D FINISH" },
  { key: "threeDTime", header: "In hrs/mins" },
  { key: "two_d_finish", header: "2D FINISH" },
  { key: "twoDTime", header: "In hrs/mins" },
  { key: "totalTime", header: "Total hrs/mins" },
  { key: "proof", header: "Work_Done_Proof_img" },
];
const RAW_TABLE_COLUMNS = [
  { key: "serialNumber", header: "S. No" },
  { key: "fixtureNo", header: "FIXTURE NO" },
  { key: "opNo", header: "OP.NO" },
  { key: "partName", header: "Part Name" },
  { key: "fixtureType", header: "Fixture Type" },
  { key: "qty", header: "QTY" },
  { key: "remark", header: "Remark" },
  { key: "status", header: "Status" },
  { key: "concept", header: "CONCEPT" },
  { key: "conceptHours", header: "CONCEPT hrs" },
  { key: "dap", header: "DAP" },
  { key: "dapHours", header: "DAP hrs" },
  { key: "finish3d", header: "3D FINISH" },
  { key: "finish3dHours", header: "3D FINISH hrs" },
  { key: "finish2d", header: "2D FINISH" },
  { key: "finish2dHours", header: "2D FINISH hrs" },
  { key: "totalHours", header: "Total hrs" },
  { key: "designer", header: "Designer" },
  { key: "refImage", header: "Part Image" },
  { key: "fixImage", header: "Fix Image" },
  { key: "proof", header: "Work Proof" },
];
const RAW_STAGE_COLUMN_KEYS = new Set(["concept", "dap", "finish3d", "finish2d"]);
const RAW_CENTERED_COLUMN_KEYS = new Set([
  "serialNumber",
  "qty",
  "conceptHours",
  "dapHours",
  "finish3dHours",
  "finish2dHours",
  "totalHours",
  "refImage",
  "workImage",
  "proof",
]);
const RAW_STATUS_COLORS = {
  ASSIGNED: "FF3A7BD5",
  IN_PROGRESS: "FF28A745",
  REWORK: "FFFF8C00",
  DELAY: "FFDC3545",
  HOLD: "FF6C757D",
  COMPLETE: "FF20C997",
};
const STAGE_COLUMN_KEYS = new Set(["concept", "dap", "three_d_finish", "two_d_finish"]);
const STAGE_TIME_COLUMN_KEYS = {
  concept: "conceptTime",
  dap: "dapTime",
  three_d_finish: "threeDTime",
  two_d_finish: "twoDTime",
};
const IMAGE_COLUMN_KEYS = new Set(["image1", "image2"]);
const CENTERED_COLUMN_KEYS = new Set([
  "serialNumber",
  "fixtureNo",
  "image1",
  "qty",
  "image2",
  "conceptTime",
  "dapTime",
  "threeDTime",
  "twoDTime",
  "totalTime",
  "proof",
]);

function sanitizeFileNamePart(value) {
  return String(value || "")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "") || "Report";
}

function toArgb(color) {
  return color?.length === 8 ? color : `FF${color}`;
}

function normalizeStageName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function getStageBucket(stageName) {
  const normalized = normalizeStageName(stageName);

  if (!normalized) {
    return null;
  }

  if (normalized.includes("concept")) {
    return "concept";
  }

  if (normalized.includes("dap")) {
    return "dap";
  }

  if (normalized.includes("3d")) {
    return "three_d_finish";
  }

  if (normalized.includes("2d")) {
    return "two_d_finish";
  }

  return null;
}

function normalizeStatus(value) {
  return String(value || "").trim().toUpperCase();
}

function parseTimestamp(value) {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

function formatTimelineTimestamp(value) {
  const date = parseTimestamp(value);
  if (!date) {
    return "";
  }

  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = String(date.getUTCFullYear()).slice(-2);
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  return `${day}/${month}/${year} ${hours}:${minutes}`;
}

function minutesBetween(startValue, endValue) {
  const start = parseTimestamp(startValue);
  const end = parseTimestamp(endValue);

  if (!start || !end) {
    return null;
  }

  const diffMs = end.getTime() - start.getTime();
  if (diffMs <= 0) {
    return null;
  }

  const diffMinutes = Math.round(diffMs / 60000);
  if (diffMinutes > MAX_STAGE_DURATION_MINUTES) {
    return null;
  }

  return diffMinutes;
}

function formatDuration(totalMinutes) {
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) {
    return "";
  }

  const safeMinutes = Math.round(totalMinutes);
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;
  return `${hours}h ${minutes}m`;
}

function formatExcelDate(value) {
  const date = parseTimestamp(value);

  if (!date) {
    return "";
  }

  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = String(date.getUTCFullYear()).slice(-2);
  return `${day}/${month}/${year}`;
}

function formatStageCellValue(stage) {
  if (!stage?.assigned_at) {
    return "";
  }

  if (!stage.completed_at) {
    return "TBD";
  }

  return `${formatTimelineTimestamp(stage.assigned_at)} → ${formatTimelineTimestamp(stage.completed_at)}`;
}

function formatProofLinks(proofUrls = []) {
  return proofUrls.filter(Boolean)[0] || null;
}

function chooseDesignerName(fixture, currentStage) {
  return currentStage?.assigned_to_name || fixture.task_assignee_name || currentStage?.assigned_to || fixture.task_assigned_to || "";
}

function chooseProofUrl(fixture) {
  if (Array.isArray(fixture.task_proof_url)) {
    return fixture.task_proof_url[fixture.task_proof_url.length - 1] || null;
  }

  return fixture.task_proof_url || null;
}

function normalizeStoredImageUrl(value, publicOrigin = "") {
  const rawUrl = String(value || "").trim();

  if (!rawUrl) {
    return null;
  }

  if (rawUrl.startsWith("http://") || rawUrl.startsWith("https://")) {
    try {
      return new URL(rawUrl).href;
    } catch (_error) {
      return null;
    }
  }

  if (!rawUrl.startsWith("/uploads/")) {
    return null;
  }

  const normalizedOrigin = String(publicOrigin || "").trim().replace(/\/+$/g, "");

  if (!normalizedOrigin) {
    return null;
  }

  try {
    return new URL(rawUrl, normalizedOrigin).href;
  } catch (_error) {
    return null;
  }
}

function execFileAsync(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      if (error) {
        reject({
          error,
          stdout,
          stderr,
        });
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

function resolveFixtureStatus(progressRows, taskStatus, deadline) {
  const currentStage = progressRows.find((row) => row.status !== "APPROVED") || null;

  if (!currentStage) {
    return STATUS_LABELS.CLOSED;
  }

  if (taskStatus === "on_hold") {
    return STATUS_LABELS.ON_HOLD;
  }

  if (deadline) {
    const deadlineDate = new Date(deadline);
    if (!Number.isNaN(deadlineDate.getTime()) && deadlineDate.getTime() < Date.now()) {
      return STATUS_LABELS.OVERDUE;
    }
  }

  if (taskStatus === "rework" || currentStage.status === "REJECTED") {
    return STATUS_LABELS.REWORK;
  }

  if (taskStatus === "under_review" || currentStage.status === "COMPLETED") {
    return STATUS_LABELS.REVIEW;
  }

  if (taskStatus === "in_progress" || currentStage.status === "IN_PROGRESS") {
    return STATUS_LABELS.IN_PROGRESS;
  }

  return STATUS_LABELS.ASSIGNED;
}

function logReportValidation(message, metadata = {}) {
  logger.warn(`Design report validation: ${message}`, metadata);
}

function buildStageAttemptFallback(progressRow) {
  if (!progressRow) {
    return [];
  }

  const start = progressRow.assigned_at || progressRow.started_at || null;
  const end = progressRow.completed_at || null;

  if (!start && !end) {
    return [];
  }

  return [{
    attempt_no: 1,
    status: progressRow.status,
    assigned_at: progressRow.assigned_at || progressRow.started_at || null,
    started_at: start,
    completed_at: progressRow.completed_at || null,
    duration_minutes: progressRow.duration_minutes ?? null,
    approved_at: null,
    updated_at: progressRow.updated_at || null,
    actual_end: end,
  }];
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

function formatAttemptLine(attempt, isDelayed, progressStatus, showPlannedAndActual = false) {
  const assigned = formatTimelineTimestamp(attempt.assigned_at || attempt.started_at) || "TBD";
  const completed = formatTimelineTimestamp(attempt.actual_end || getAttemptActualEnd(attempt, progressStatus)) || "TBD";

  if (isDelayed) {
    return `${assigned} → ${completed} (Rework)`;
  }

  return `${assigned} → ${completed}`;
}

function buildStagePresentation({ stageAttempts, progressRow, stage, fixture, isCurrent, isFuture }) {
  if (isFuture || !progressRow) {
    return {
      timeline: "",
      minutes: null,
      assignedAt: null,
      completedAt: null,
      actualEnd: null,
    };
  }

  const progressStatus = normalizeStatus(progressRow.status);
  const attempts = (Array.isArray(stageAttempts) && stageAttempts.length > 0
    ? stageAttempts
    : buildStageAttemptFallback(progressRow))
    .map((attempt) => ({
      ...attempt,
      actual_end: getAttemptActualEnd(attempt, progressStatus),
    }))
    .sort((left, right) => Number(left.attempt_no || 0) - Number(right.attempt_no || 0));

  if (progressStatus === "APPROVED" && !attempts.some((attempt) => attempt.actual_end || attempt.approved_at || attempt.completed_at)) {
    logReportValidation("approved stage is missing actual timestamp", {
      fixture_id: fixture.fixture_id,
      fixture_no: fixture.fixture_no,
      stage: stage.label,
    });

    return {
      timeline: "",
      minutes: null,
      assignedAt: null,
      completedAt: null,
      actualEnd: null,
    };
  }

  if (isCurrent && progressStatus === "COMPLETED" && !attempts.some((attempt) => attempt.completed_at)) {
    logReportValidation("completed current stage is missing completion timestamp", {
      fixture_id: fixture.fixture_id,
      fixture_no: fixture.fixture_no,
      stage: stage.label,
    });
  }

  const visibleAttempts = attempts.filter((attempt) => {
    if (normalizeStatus(attempt.status) === "IN_PROGRESS") {
      return isCurrent && Boolean(attempt.started_at);
    }

    return Boolean(attempt.actual_end || attempt.completed_at || attempt.approved_at);
  });

  const lines = visibleAttempts
    .map((attempt, index) => {
      const isDelayed = index < visibleAttempts.length - 1 || normalizeStatus(attempt.status) === "REJECTED";
      return formatAttemptLine(attempt, isDelayed, progressStatus, isCurrent && progressStatus !== "APPROVED");
    })
    .filter(Boolean);

  const minutes = visibleAttempts.reduce((sum, attempt) => {
    const duration = Number.isFinite(attempt.duration_minutes)
      ? Math.round(attempt.duration_minutes)
      : minutesBetween(attempt.assigned_at || attempt.started_at, attempt.actual_end);
    if (duration === null) {
      if ((attempt.assigned_at || attempt.started_at) && attempt.actual_end) {
        logReportValidation("invalid or unrealistic stage duration", {
          fixture_id: fixture.fixture_id,
          fixture_no: fixture.fixture_no,
          stage: stage.label,
          assigned_at: attempt.assigned_at || attempt.started_at,
          end_time: attempt.actual_end,
        });
      }

      return sum;
    }

    return sum + duration;
  }, 0);

  const firstVisibleAttempt = visibleAttempts[0] || null;
  const lastVisibleAttempt = visibleAttempts.length > 0 ? visibleAttempts[visibleAttempts.length - 1] : null;

  return {
    timeline: lines.join("\n"),
    minutes: minutes > 0 ? minutes : null,
    assignedAt: firstVisibleAttempt?.assigned_at || firstVisibleAttempt?.started_at || null,
    completedAt: lastVisibleAttempt?.actual_end || lastVisibleAttempt?.completed_at || null,
    actualEnd: lastVisibleAttempt?.actual_end || null,
  };
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

function validateFixtureWorkflow(fixture, fixtureProgressRows, progressByStage) {
  if (!fixtureProgressRows.length) {
    logReportValidation("missing workflow linkage", {
      fixture_id: fixture.fixture_id,
      fixture_no: fixture.fixture_no,
    });
    return false;
  }

  const duplicateStages = [];
  progressByStage.forEach((rows, stageKey) => {
    if (rows.length > 1) {
      duplicateStages.push(stageKey);
    }
  });

  if (duplicateStages.length > 0) {
    logReportValidation("duplicate workflow progress rows for report stage", {
      fixture_id: fixture.fixture_id,
      fixture_no: fixture.fixture_no,
      stages: duplicateStages,
    });
    return false;
  }

  const missingStages = STAGES
    .filter((stage) => !progressByStage.has(stage.key))
    .map((stage) => stage.label);

  if (missingStages.length > 0) {
    logReportValidation("missing workflow progress rows for required report stages", {
      fixture_id: fixture.fixture_id,
      fixture_no: fixture.fixture_no,
      stages: missingStages,
    });
    return false;
  }

  const firstOpenIndex = STAGES.findIndex((stage) => normalizeStatus(progressByStage.get(stage.key)?.[0]?.status) !== "APPROVED");
  if (firstOpenIndex >= 0) {
    const approvedAfterCurrent = STAGES
      .slice(firstOpenIndex + 1)
      .filter((stage) => normalizeStatus(progressByStage.get(stage.key)?.[0]?.status) === "APPROVED")
      .map((stage) => stage.label);

    if (approvedAfterCurrent.length > 0) {
      logReportValidation("future stage is approved before current stage", {
        fixture_id: fixture.fixture_id,
        fixture_no: fixture.fixture_no,
        stages: approvedAfterCurrent,
      });
      return false;
    }
  }

  return true;
}

function columnNumberToLetter(columnNumber) {
  let current = columnNumber;
  let letters = "";

  while (current > 0) {
    const remainder = (current - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    current = Math.floor((current - 1) / 26);
  }

  return letters;
}

function makeCellBorder() {
  return {
    top: { style: "thin", color: { argb: "FFD0D7DE" } },
    left: { style: "thin", color: { argb: "FFD0D7DE" } },
    bottom: { style: "thin", color: { argb: "FFD0D7DE" } },
    right: { style: "thin", color: { argb: "FFD0D7DE" } },
  };
}

function setBaseCellStyle(cell, columnKey) {
  cell.border = makeCellBorder();
  cell.alignment = {
    horizontal: CENTERED_COLUMN_KEYS.has(columnKey) ? "center" : "left",
    vertical: "middle",
    wrapText: STAGE_COLUMN_KEYS.has(columnKey) || IMAGE_COLUMN_KEYS.has(columnKey),
  };
}

function applyHeaderStyle(cell) {
  cell.border = makeCellBorder();
  cell.font = { bold: true, color: { argb: "FF1F2937" } };
  cell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE5EDF5" },
  };
  cell.alignment = {
    horizontal: "center",
    vertical: "middle",
    wrapText: false,
  };
}

function applyStatusFill(cell, statusLabel) {
  const color = STATUS_COLORS[statusLabel];
  if (!color) {
    return;
  }

  cell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: toArgb(color) },
  };
  cell.font = {
    bold: true,
    color: { argb: "FFFFFFFF" },
  };
}

function autoSizeColumns(worksheet) {
  worksheet.columns.forEach((column, index) => {
    let maxLength = 0;

    column.eachCell({ includeEmpty: true }, (cell) => {
      const value = cell.value;
      const rawText = typeof value === "object" && value !== null && "text" in value
        ? String(value.text || "")
        : cell.text || "";

      const length = rawText
        .split("\n")
        .reduce((max, line) => Math.max(max, line.length), 0);

      maxLength = Math.max(maxLength, length);
    });

    const columnKey = TABLE_COLUMNS[index]?.key;
    const minimumWidth = STAGE_COLUMN_KEYS.has(columnKey) ? 18 : 10;
    column.width = Math.max(minimumWidth, maxLength + 3);
  });
}

function buildReportTitle(context) {
  const middleSegment = context.project_name;

  return `WBS-${context.project_no}-${middleSegment}-${context.customer_name}`;
}

function buildReportFileName(context) {
  const targetName = context.project_name;
  const suffix = "Project_Wise_Design_Report";
  return `${sanitizeFileNamePart(context.project_no)}_${sanitizeFileNamePart(targetName)}_${suffix}.xlsx`;
}

function applyLinkCell(cell, url) {
  cell.value = {
    text: "View",
    hyperlink: url,
  };
  cell.font = { color: { argb: "FF1D4ED8" }, underline: true };
}

function autoSizeWorksheetColumns(worksheet, columns, stageColumnKeys = new Set()) {
  worksheet.columns.forEach((column, index) => {
    let maxLength = 0;

    column.eachCell({ includeEmpty: true }, (cell) => {
      const value = cell.value;
      const rawText = typeof value === "object" && value !== null && "text" in value
        ? String(value.text || "")
        : cell.text || "";

      const length = rawText
        .split("\n")
        .reduce((max, line) => Math.max(max, line.length), 0);

      maxLength = Math.max(maxLength, length);
    });

    const columnKey = columns[index]?.key;
    const minimumWidth = stageColumnKeys.has(columnKey) ? 18 : 10;
    column.width = Math.max(minimumWidth, maxLength + 3);
  });
}

function setRawCellStyle(cell, columnKey) {
  cell.border = makeCellBorder();
  cell.alignment = {
    horizontal: RAW_CENTERED_COLUMN_KEYS.has(columnKey) ? "center" : "left",
    vertical: "middle",
    wrapText: RAW_STAGE_COLUMN_KEYS.has(columnKey),
  };
}

function buildRawReportRows(normalizedData = [], fixtureLookup = new Map()) {
  return normalizedData.map((row, index) => {
    const fixture = fixtureLookup.get(row.fixture_key) || {};
    const concept = row.stages?.concept || {};
    const dap = row.stages?.dap || {};
    const finish3d = row.stages?.finish3d || {};
    const finish2d = row.stages?.finish2d || {};
    const totalMinutes = [concept, dap, finish3d, finish2d]
      .reduce((sum, stage) => sum + (Number.isFinite(stage.duration_minutes) ? stage.duration_minutes : 0), 0);

    return {
      serialNumber: index + 1,
      fixtureNo: row.fixture_no || "",
      opNo: row.op_no || "",
      partName: row.part_name || "",
      fixtureType: row.fixture_type || "",
      qty: row.qty || 0,
      remark: row.remark || "",
      status: row.status || "",
      concept: formatStageCellValue(concept),
      conceptHours: formatDuration(concept.duration_minutes || 0),
      dap: formatStageCellValue(dap),
      dapHours: formatDuration(dap.duration_minutes || 0),
      finish3d: formatStageCellValue(finish3d),
      finish3dHours: formatDuration(finish3d.duration_minutes || 0),
      finish2d: formatStageCellValue(finish2d),
      finish2dHours: formatDuration(finish2d.duration_minutes || 0),
      totalHours: formatDuration(totalMinutes),
      designer: row.designer || "",
      refImage: fixture.image1Url ? "View" : "",
      refImageUrl: fixture.image1Url || null,
      fixImage: fixture.image2Url ? "View" : "",
      fixImageUrl: fixture.image2Url || null,
      proof: row.proof_urls?.length ? "View" : "",
      proofUrl: formatProofLinks(row.proof_urls),
    };
  });
}

async function generateRawScopeExcel(normalizedData, filePath, context = {}, fixtureLookup = new Map()) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Design Report");
  const lastColumnLetter = columnNumberToLetter(RAW_TABLE_COLUMNS.length);
  const reportTitle = `WBS-${context.project_no || normalizedData[0]?.project_no || ""}-${context.project_name || normalizedData[0]?.project_name || ""}-${context.customer_name || "Report"}`;
  const excelRows = buildRawReportRows(normalizedData, fixtureLookup);

  worksheet.getCell("A1").value = reportTitle;
  worksheet.getRow(1).height = 24;

  const headerRow = worksheet.getRow(2);
  RAW_TABLE_COLUMNS.forEach((column, index) => {
    headerRow.getCell(index + 1).value = column.header;
  });
  headerRow.height = 22;

  excelRows.forEach((row) => {
    const excelRow = worksheet.addRow(RAW_TABLE_COLUMNS.map((column) => row[column.key] ?? ""));

    if (row.refImageUrl) {
      applyLinkCell(excelRow.getCell(19), row.refImageUrl);
    }

    if (row.fixImageUrl) {
      applyLinkCell(excelRow.getCell(20), row.fixImageUrl);
    }

    if (row.proofUrl) {
      applyLinkCell(excelRow.getCell(21), row.proofUrl);
    }

  });

  await workbook.xlsx.writeFile(filePath);
}

async function resolvePythonFormatterConfig() {
  const scriptCandidates = [
    process.env.REPORT_FORMATTER_SCRIPT,
    path.join(__dirname, "../../python-service/app/format_scope_report.py"),
    path.join(__dirname, "../../python-service/app/report_formatter.py"),
    path.join(__dirname, "../../python-service/format_scope_report.py"),
  ].filter(Boolean);
  const pythonCandidates = [
    process.env.REPORT_FORMATTER_PYTHON,
    path.join(__dirname, "../../python-service/venv/Scripts/python.exe"),
    path.join(__dirname, "../../python-service/app/venv/bin/python.exe"),
    "python",
    "py",
  ].filter(Boolean);

  let formatterScript = null;
  for (const candidate of scriptCandidates) {
    try {
      await fs.access(candidate);
      formatterScript = candidate;
      break;
    } catch (_error) {
      // Keep checking candidates until we find the formatter script.
    }
  }

  if (!formatterScript) {
    throw new Error("Python formatter script not configured");
  }

  let pythonExecutable = pythonCandidates[pythonCandidates.length - 1];
  for (const candidate of pythonCandidates) {
    try {
      await fs.access(candidate);
      pythonExecutable = candidate;
      break;
    } catch (_error) {
      // Non-file commands such as python/py are still valid fallbacks.
      if (candidate === "python" || candidate === "py") {
        pythonExecutable = candidate;
      }
    }
  }

  return {
    formatterScript,
    pythonExecutable,
  };
}

async function runPythonFormatter(rawPath, finalPath) {
  const { formatterScript, pythonExecutable } = await resolvePythonFormatterConfig();

  const args = pythonExecutable === "py"
    ? ["-3", formatterScript, rawPath, finalPath]
    : [formatterScript, rawPath, finalPath];

  console.log("=== PYTHON FORMATTER START ===");
  console.log("Python:", pythonExecutable);
  console.log("Script:", formatterScript);
  console.log("Raw Path:", rawPath);
  console.log("Final Path:", finalPath);

  try {
    const { stdout, stderr } = await execFileAsync(pythonExecutable, args, {
      windowsHide: true,
      cwd: path.dirname(formatterScript),
    });

    if (stdout) console.log("PYTHON STDOUT:", stdout);
    if (stderr) console.error("PYTHON STDERR:", stderr);

    // 🔥 ACTUAL CHECK (not fake log)
    await fs.access(finalPath);

    console.log("=== PYTHON FORMATTER SUCCESS ===");

  } catch (err) {
    console.error("=== PYTHON FORMATTER FAILED ===");
    console.error("Error:", err?.error?.message || err?.message);
    console.error("STDERR:", err?.stderr);
    console.error("STDOUT:", err?.stdout);

    throw new Error("Python formatter execution failed");
  }
}

function buildWorkbook(context, rows) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Design Report");
  const lastColumnLetter = columnNumberToLetter(TABLE_COLUMNS.length);

  worksheet.mergeCells(`A1:${lastColumnLetter}1`);
  worksheet.getCell("A1").value = buildReportTitle(context);
  worksheet.getCell("A1").font = {
    bold: true,
    size: 14,
    color: { argb: "FF0F172A" },
  };
  worksheet.getCell("A1").alignment = {
    horizontal: "center",
    vertical: "middle",
    wrapText: false,
  };
  worksheet.getRow(1).height = 24;

  const headerRow = worksheet.getRow(2);
  TABLE_COLUMNS.forEach((column, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.value = column.header;
    applyHeaderStyle(cell);
  });
  headerRow.height = 22;
  worksheet.views = [{ state: "frozen", ySplit: 2 }];

  rows.forEach((row) => {
    const excelRow = worksheet.addRow(TABLE_COLUMNS.map((column) => row[column.key] ?? ""));
    excelRow.height = STAGES.some((stage) => String(row[stage.key] || "").includes("\n")) ? 32 : 20;

    TABLE_COLUMNS.forEach((column, index) => {
      const cell = excelRow.getCell(index + 1);
      setBaseCellStyle(cell, column.key);
    });

    if (row.image1Url) {
      const cell = excelRow.getCell(5);
      applyLinkCell(cell, row.image1Url);
    }

    if (row.image2Url) {
      const cell = excelRow.getCell(9);
      applyLinkCell(cell, row.image2Url);
    }

    if (row.proofUrl) {
      const cell = excelRow.getCell(20);
      applyLinkCell(cell, row.proofUrl);
    }

    applyStatusFill(excelRow.getCell(2), row.statusLabel);

    STAGES.forEach((stage) => {
      const stageColumnIndex = TABLE_COLUMNS.findIndex((column) => column.key === stage.key);
      if (stageColumnIndex >= 0 && row.stageStatuses) {
        const status = row.stageStatuses[stage.key];
        const color = STAGE_STATUS_COLORS[status] || STAGE_STATUS_COLORS.PENDING;
        const textColor = status === "IN_PROGRESS" ? "FF000000" : "FFFFFFFF";
        const stageCell = excelRow.getCell(stageColumnIndex + 1);
        stageCell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: toArgb(color) },
        };
        stageCell.font = {
          color: { argb: textColor },
          bold: true,
        };

        const timeColumnKey = STAGE_TIME_COLUMN_KEYS[stage.key];
        const timeColumnIndex = TABLE_COLUMNS.findIndex((column) => column.key === timeColumnKey);
        if (timeColumnIndex >= 0) {
          const timeCell = excelRow.getCell(timeColumnIndex + 1);
          timeCell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: toArgb(color) },
          };
          timeCell.font = {
            color: { argb: textColor },
            bold: true,
          };
        }
      }
    });
  });

  autoSizeColumns(worksheet);
  return workbook;
}

function buildFixtureRows(fixtures, progressRows, attemptRows, options = {}) {
  const publicOrigin = options.publicOrigin || "";
  const progressMap = progressRows.reduce((map, row) => {
    const key = String(row.fixture_id);
    const rows = map.get(key) || [];
    rows.push(row);
    map.set(key, rows);
    return map;
  }, new Map());

  const attemptMap = attemptRows.reduce((map, row) => {
    const fixtureKey = String(row.fixture_id);
    const fixtureAttempts = map.get(fixtureKey) || new Map();
    const stageKey = getStageBucket(row.stage_name);

    if (!stageKey) {
      map.set(fixtureKey, fixtureAttempts);
      return map;
    }

    const stageAttempts = fixtureAttempts.get(stageKey) || [];
    stageAttempts.push(row);
    fixtureAttempts.set(stageKey, stageAttempts);
    map.set(fixtureKey, fixtureAttempts);
    return map;
  }, new Map());

  const rows = [];

  fixtures.forEach((fixture) => {
    const fixtureProgressRows = (progressMap.get(String(fixture.fixture_id)) || [])
      .sort((left, right) => Number(left.stage_order || 0) - Number(right.stage_order || 0));
    const fixtureAttemptMap = attemptMap.get(String(fixture.fixture_id)) || new Map();
    const progressByStage = getProgressByStage(fixtureProgressRows);

    if (!validateFixtureWorkflow(fixture, fixtureProgressRows, progressByStage)) {
      return;
    }

    const currentStageIndex = STAGES.findIndex((stage) => normalizeStatus(progressByStage.get(stage.key)?.[0]?.status) !== "APPROVED");
    const currentStage = currentStageIndex >= 0 ? progressByStage.get(STAGES[currentStageIndex].key)?.[0] || null : null;
    const statusLabel = resolveFixtureStatus(fixtureProgressRows, fixture.task_status, fixture.task_deadline);
    const stageData = {};
    const stageStatuses = {};
    const actualTimestampsByStage = new Map();
    let totalMinutes = 0;

    STAGES.forEach((stage, stageIndex) => {
      const matchingProgress = progressByStage.get(stage.key)?.[0] || null;
      stageStatuses[stage.key] = normalizeStatus(matchingProgress?.status) || "PENDING";
      const isAllApproved = currentStageIndex === -1;
      const isFuture = !isAllApproved && stageIndex > currentStageIndex;
      const isCurrent = !isAllApproved && stageIndex === currentStageIndex;
      const isApproved = normalizeStatus(matchingProgress?.status) === "APPROVED";
      const shouldPopulate = isApproved || isCurrent;
      const presentation = shouldPopulate
        ? buildStagePresentation({
          stageAttempts: fixtureAttemptMap.get(stage.key) || [],
          progressRow: matchingProgress,
          stage,
          fixture,
          isCurrent,
          isFuture,
        })
        : {
          timeline: "",
          minutes: null,
          assignedAt: null,
          completedAt: null,
          actualEnd: null,
        };
      const actualTimestampKey = formatTimelineTimestamp(presentation.actualEnd) || null;
      const duplicateStage = actualTimestampKey ? actualTimestampsByStage.get(actualTimestampKey) : null;

      if (duplicateStage) {
        logReportValidation("duplicate actual workflow timestamp across stages", {
          fixture_id: fixture.fixture_id,
          fixture_no: fixture.fixture_no,
          stages: [duplicateStage, stage.label],
          timestamp: actualTimestampKey,
        });

        stageData[stage.key] = "";
        stageData[`${stage.key}_assigned_at`] = null;
        stageData[`${stage.key}_completed_at`] = null;
        stageData[`${stage.key}_minutes`] = null;
        return;
      }

      if (actualTimestampKey) {
        actualTimestampsByStage.set(actualTimestampKey, stage.label);
      }

      stageData[stage.key] = presentation.timeline;
      stageData[`${stage.key}_assigned_at`] = presentation.assignedAt;
      stageData[`${stage.key}_completed_at`] = presentation.completedAt;
      stageData[`${stage.key}_minutes`] = presentation.minutes;

      if (Number.isFinite(presentation.minutes)) {
        totalMinutes += presentation.minutes;
      }
    });

    const image1Url = normalizeStoredImageUrl(fixture.image_1_url, publicOrigin);
    const image2Url = normalizeStoredImageUrl(fixture.image_2_url, publicOrigin);
    const proofUrl = chooseProofUrl(fixture);

    rows.push({
      serialNumber: rows.length + 1,
      fixtureNo: fixture.fixture_no || "",
      opNo: fixture.op_no || "",
      partName: fixture.part_name || "",
      image1: "",
      image1Url,
      fixtureType: fixture.fixture_type || "",
      qty: Number(fixture.qty) || 0,
      remark: fixture.remark || "",
      image2: "",
      image2Url,
      designer: chooseDesignerName(fixture, currentStage),
      concept: stageData.concept || "",
      concept_assigned_at: stageData.concept_assigned_at || null,
      concept_completed_at: stageData.concept_completed_at || null,
      concept_duration_minutes: stageData.concept_minutes || null,
      conceptTime: formatDuration(stageData.concept_minutes || 0),
      dap: stageData.dap || "",
      dap_assigned_at: stageData.dap_assigned_at || null,
      dap_completed_at: stageData.dap_completed_at || null,
      dap_duration_minutes: stageData.dap_minutes || null,
      dapTime: formatDuration(stageData.dap_minutes || 0),
      three_d_finish: stageData.three_d_finish || "",
      three_d_finish_assigned_at: stageData.three_d_finish_assigned_at || null,
      three_d_finish_completed_at: stageData.three_d_finish_completed_at || null,
      three_d_finish_duration_minutes: stageData.three_d_finish_minutes || null,
      "3d_finish_assigned_at": stageData.three_d_finish_assigned_at || null,
      "3d_finish_completed_at": stageData.three_d_finish_completed_at || null,
      "3d_finish_duration_minutes": stageData.three_d_finish_minutes || null,
      threeDTime: formatDuration(stageData.three_d_finish_minutes || 0),
      two_d_finish: stageData.two_d_finish || "",
      two_d_finish_assigned_at: stageData.two_d_finish_assigned_at || null,
      two_d_finish_completed_at: stageData.two_d_finish_completed_at || null,
      two_d_finish_duration_minutes: stageData.two_d_finish_minutes || null,
      "2d_finish_assigned_at": stageData.two_d_finish_assigned_at || null,
      "2d_finish_completed_at": stageData.two_d_finish_completed_at || null,
      "2d_finish_duration_minutes": stageData.two_d_finish_minutes || null,
      twoDTime: formatDuration(stageData.two_d_finish_minutes || 0),
      totalTime: formatDuration(totalMinutes),
      proof: proofUrl ? "View" : "",
      proofUrl,
      currentStageKey: currentStage ? getStageBucket(currentStage.stage_name) : null,
      stageStatuses,
      statusLabel,
    });
  });

  return rows;
}

function resolveCurrentProgressRow(progressByStage) {
  for (const stage of STAGES) {
    const progressRow = progressByStage.get(stage.key)?.[0] || null;
    if (!progressRow) {
      continue;
    }

    if (normalizeStatus(progressRow.status) !== "APPROVED") {
      return progressRow;
    }
  }

  return null;
}

function resolveDesigner(progressByStage, fixture) {
  const currentProgressRow = resolveCurrentProgressRow(progressByStage);

  if (currentProgressRow?.assigned_to_name) {
    return currentProgressRow.assigned_to_name;
  }

  for (const stage of STAGES) {
    const progressRow = progressByStage.get(stage.key)?.[0] || null;
    if (progressRow?.assigned_to_name) {
      return progressRow.assigned_to_name;
    }
  }

  return fixture.task_assignee_name || fixture.task_assigned_to || "";
}

function resolveNormalizedStageSnapshot(progressRow, stageAttempts = []) {
  const progressStatus = normalizeStatus(progressRow?.status);
  const attempts = (Array.isArray(stageAttempts) && stageAttempts.length > 0
    ? stageAttempts
    : buildStageAttemptFallback(progressRow))
    .map((attempt) => ({
      ...attempt,
      actual_end: getAttemptActualEnd(attempt, progressStatus),
    }))
    .sort((left, right) => Number(left.attempt_no || 0) - Number(right.attempt_no || 0));

  const assignedAt = attempts.find((attempt) => attempt.assigned_at || attempt.started_at)?.assigned_at
    || attempts.find((attempt) => attempt.assigned_at || attempt.started_at)?.started_at
    || progressRow?.assigned_at
    || progressRow?.started_at
    || null;
  const completedAt = attempts.length > 0
    ? attempts[attempts.length - 1].actual_end || attempts[attempts.length - 1].completed_at || null
    : progressRow?.completed_at || null;
  let durationMinutes = null;

  if (assignedAt && completedAt) {
    durationMinutes = minutesBetween(assignedAt, completedAt);
  } else if (Number.isFinite(progressRow?.duration_minutes)) {
    durationMinutes = Math.round(Number(progressRow.duration_minutes));
  }

  return {
    assigned_at: assignedAt,
    completed_at: completedAt,
    duration_minutes: durationMinutes,
  };
}

function buildScopeReportSourceRows(fixtures, progressRows, attemptRows, attachmentsByTaskId = new Map(), options = {}) {
  const publicOrigin = options.publicOrigin || "";
  const progressMap = progressRows.reduce((map, row) => {
    const fixtureId = String(row.fixture_id);
    const rows = map.get(fixtureId) || [];
    rows.push(row);
    map.set(fixtureId, rows);
    return map;
  }, new Map());
  const attemptMap = attemptRows.reduce((map, row) => {
    const fixtureId = String(row.fixture_id);
    const fixtureAttempts = map.get(fixtureId) || new Map();
    const stageKey = getStageBucket(row.stage_name);

    if (!stageKey) {
      map.set(fixtureId, fixtureAttempts);
      return map;
    }

    const attempts = fixtureAttempts.get(stageKey) || [];
    attempts.push(row);
    fixtureAttempts.set(stageKey, attempts);
    map.set(fixtureId, fixtureAttempts);
    return map;
  }, new Map());

  return fixtures.map((fixture) => {
    const fixtureProgressRows = (progressMap.get(String(fixture.fixture_id)) || [])
      .sort((left, right) => Number(left.stage_order || 0) - Number(right.stage_order || 0));
    const progressByStage = getProgressByStage(fixtureProgressRows);
    const fixtureAttempts = attemptMap.get(String(fixture.fixture_id)) || new Map();
    const taskAttachments = attachmentsByTaskId.get(Number(fixture.task_id)) || [];
    const image1Url = normalizeStoredImageUrl(fixture.image_1_url, publicOrigin);
    const image2Url = normalizeStoredImageUrl(fixture.image_2_url, publicOrigin);

    return {
      fixture_id: fixture.fixture_id,
      project_no: fixture.project_no,
      project_name: fixture.project_name || "",
      fixture_no: fixture.fixture_no,
      op_no: fixture.op_no,
      part_name: fixture.part_name,
      fixture_type: fixture.fixture_type,
      remark: fixture.remark || "",
      qty: fixture.qty,
      designer: resolveDesigner(progressByStage, fixture),
      image1Url,
      image2Url,
      task_status: fixture.task_status,
      task_deadline: fixture.task_deadline,
      workflow_status: resolveCurrentProgressRow(progressByStage)?.status || null,
      current_stage_status: resolveCurrentProgressRow(progressByStage)?.status || null,
      task_proof_url_array: (Array.isArray(fixture.task_proof_url) ? fixture.task_proof_url : [fixture.task_proof_url])
        .map((proofUrl) => normalizeStoredImageUrl(proofUrl, publicOrigin))
        .filter(Boolean),
      attachments: taskAttachments.map((attachment) => ({
        ...attachment,
        file_url: normalizeStoredImageUrl(attachment.file_url, publicOrigin),
      })).filter((attachment) => attachment.file_url),
      stages: {
        concept: resolveNormalizedStageSnapshot(
          progressByStage.get("concept")?.[0] || null,
          fixtureAttempts.get("concept") || [],
        ),
        dap: resolveNormalizedStageSnapshot(
          progressByStage.get("dap")?.[0] || null,
          fixtureAttempts.get("dap") || [],
        ),
        finish3d: resolveNormalizedStageSnapshot(
          progressByStage.get("three_d_finish")?.[0] || null,
          fixtureAttempts.get("three_d_finish") || [],
        ),
        finish2d: resolveNormalizedStageSnapshot(
          progressByStage.get("two_d_finish")?.[0] || null,
          fixtureAttempts.get("two_d_finish") || [],
        ),
      },
    };
  });
}

function resolveReportDepartmentId(user, requestedDepartmentId) {
  const effectiveDepartmentId = requireDepartmentContext(
    getEffectiveDepartment(user, requestedDepartmentId),
    "Invalid department context",
  );

  if (!isAdmin(user) && effectiveDepartmentId !== user.department_id) {
    throw new AppError(403, "You do not have permission to access another department");
  }

  return effectiveDepartmentId;
}

async function getProjectContext(user, projectId, departmentId) {
  const result = await pool.query(
    `
      ${buildVisibleUsersCte("$1")}
      SELECT
        p.id AS project_id,
        p.project_no,
        p.project_name,
        p.customer_name,
        p.department_id,
        p.plant,
        p.project_leader_id,
        project_leader.name AS project_leader_name,
        p.team_lead_id,
        team_lead.name AS team_lead_name
      FROM design.projects p
      LEFT JOIN users project_leader
        ON project_leader.employee_id = p.project_leader_id
      LEFT JOIN users team_lead
        ON team_lead.employee_id = p.team_lead_id
      WHERE p.id = $2
        AND p.department_id = $3
        AND ${visibleProjectPredicate("p")}
      LIMIT 1
    `,
    [user.employee_id, projectId, departmentId],
  );

  const project = result.rows[0];
  if (!project) {
    throw new AppError(404, "Project not found");
  }

  return {
    ...project,
    reportType: REPORT_TYPES.PROJECT,
  };
}

async function getFixturesForProject(projectId, user) {
  const result = await pool.query(
    `
      ${buildVisibleUsersCte("$1")}
      SELECT
        p.project_no,
        p.project_name,
        f.id AS fixture_id,
        f.fixture_no,
        f.op_no,
        f.part_name,
        f.fixture_type,
        f.remark,
        f.qty,
        f.image_1_url,
        f.image_2_url,
        linked_task.id AS task_id,
        linked_task.status AS task_status,
        linked_task.priority AS task_priority,
        linked_task.deadline AS task_deadline,
        linked_task.proof_url AS task_proof_url,
        linked_task.planned_minutes AS task_planned_minutes,
        linked_task.actual_minutes AS task_actual_minutes,
        linked_task.assigned_to AS task_assigned_to,
        assignee.name AS task_assignee_name
      FROM design.fixtures f
      JOIN design.projects p
        ON p.id = f.project_id
      LEFT JOIN LATERAL (
        SELECT
          t.id,
          t.status,
          t.priority,
          t.deadline,
          t.proof_url,
          t.planned_minutes,
          t.actual_minutes,
          t.assigned_to,
          t.updated_at,
          t.created_at
        FROM tasks t
        WHERE t.status <> 'cancelled'
          AND (
            t.fixture_id = f.id
            OR (
              t.fixture_id IS NULL
              AND t.project_no = p.project_no
              AND t.department_id = p.department_id
              AND t.quantity_index = f.fixture_no
            )
          )
        ORDER BY
          CASE WHEN t.status = ANY($3::text[]) THEN 0 ELSE 1 END,
          t.updated_at DESC NULLS LAST,
          t.created_at DESC NULLS LAST,
          t.id DESC
        LIMIT 1
      ) linked_task ON TRUE
      LEFT JOIN users assignee
        ON assignee.employee_id = linked_task.assigned_to
      WHERE f.project_id = $2
        AND ${visibleFixturePredicate("f", "p")}
      ORDER BY f.fixture_no ASC, f.id ASC
    `,
    [user.employee_id, projectId, [...OPEN_TASK_STATUSES]],
  );

  return result.rows;
}

async function getFixtureProgressRows(fixtureIds) {
  if (!fixtureIds.length) {
    return [];
  }

  const result = await pool.query(
    `
      SELECT
        progress.fixture_id,
        progress.stage_name,
        progress.stage_version,
        progress.stage_order,
        progress.status,
        progress.assigned_to,
        progress.assigned_at,
        progress.started_at,
        progress.completed_at,
        progress.duration_minutes,
        progress.updated_at,
        users.name AS assigned_to_name
      FROM fixture_workflow_progress progress
      LEFT JOIN users
        ON users.employee_id = progress.assigned_to
      WHERE progress.fixture_id = ANY($1::uuid[])
      ORDER BY progress.fixture_id ASC, progress.stage_order ASC, progress.stage_name ASC
    `,
    [fixtureIds],
  );

  return result.rows;
}

async function getFixtureAttemptRows(fixtureIds) {
  if (!fixtureIds.length) {
    return [];
  }

  const result = await pool.query(
    `
      SELECT
        attempts.fixture_id,
        attempts.stage_name,
        attempts.attempt_no,
        attempts.status,
        attempts.assigned_to,
        attempts.assigned_at,
        attempts.started_at,
        attempts.completed_at,
        attempts.duration_minutes,
        attempts.approved_at,
        attempts.updated_at
      FROM fixture_workflow_stage_attempts attempts
      WHERE attempts.fixture_id = ANY($1::uuid[])
      ORDER BY attempts.fixture_id ASC, attempts.stage_name ASC, attempts.attempt_no ASC
    `,
    [fixtureIds],
  );

  return result.rows;
}

async function getTaskAttachmentsByTaskIds(taskIds) {
  const filteredTaskIds = [...new Set(taskIds.map((taskId) => Number(taskId)).filter(Number.isInteger))];

  if (!filteredTaskIds.length) {
    return new Map();
  }

  const result = await pool.query(
    `
      SELECT
        ta.id,
        ta.task_id,
        ta.file_url,
        ta.file_name,
        ta.mime_type,
        ta.file_size,
        ta.uploaded_by,
        ta.uploaded_at
      FROM task_attachments ta
      WHERE ta.task_id = ANY($1::int[])
      ORDER BY ta.task_id ASC, ta.uploaded_at ASC, ta.id ASC
    `,
    [filteredTaskIds],
  );

  return result.rows.reduce((map, row) => {
    const taskId = Number(row.task_id);
    const attachments = map.get(taskId) || [];
    attachments.push(row);
    map.set(taskId, attachments);
    return map;
  }, new Map());
}

async function getTaskActivitiesByTaskIds(taskIds) {
  const filteredTaskIds = [...new Set(taskIds.map((taskId) => Number(taskId)).filter(Number.isInteger))];

  if (!filteredTaskIds.length) {
    return new Map();
  }

  const result = await pool.query(
    `
      SELECT
        activity.task_id,
        activity.action_type,
        activity.notes,
        activity.metadata,
        activity.created_at,
        users.name AS user_name
      FROM task_activity_logs activity
      LEFT JOIN users
        ON users.employee_id = activity.user_employee_id
      WHERE activity.task_id = ANY($1::int[])
      ORDER BY activity.task_id ASC, activity.created_at ASC, activity.id ASC
    `,
    [filteredTaskIds],
  );

  return result.rows.reduce((map, row) => {
    const taskId = Number(row.task_id);
    const entries = map.get(taskId) || [];
    entries.push(row);
    map.set(taskId, entries);
    return map;
  }, new Map());
}

async function getFixtureStageTaskRows(fixtureIds) {
  if (!fixtureIds.length) {
    return [];
  }

  const result = await pool.query(
    `
      SELECT
        t.id AS task_id,
        t.fixture_id,
        COALESCE(NULLIF(t.stage, ''), NULLIF(stage.stage_name, ''), NULLIF(stage.name, ''), 'Workflow Stage') AS stage_name,
        t.proof_url,
        t.status,
        t.planned_minutes,
        t.actual_minutes
      FROM tasks t
      LEFT JOIN workflow_stages stage
        ON stage.id = t.current_stage_id
      WHERE t.fixture_id = ANY($1::uuid[])
        AND t.status <> 'cancelled'
      ORDER BY t.fixture_id ASC, t.created_at ASC, t.id ASC
    `,
    [fixtureIds],
  );

  return result.rows;
}

function cloneStyle(style) {
  return JSON.parse(JSON.stringify(style || {}));
}

function stageStatusToProgress(status) {
  switch (normalizeStatus(status)) {
    case "APPROVED":
      return "100%";
    case "COMPLETED":
      return "90%";
    case "IN_PROGRESS":
      return "50%";
    case "REJECTED":
      return "Rejected";
    default:
      return "0%";
  }
}

function formatDateRange(startValue, endValue) {
  const start = formatExcelDate(startValue);
  const end = formatExcelDate(endValue);
  if (start && end) {
    return `${start} - ${end}`;
  }

  return start || end || "";
}

function formatStageContributors(contributions, fallbackName = "") {
  if (Array.isArray(contributions) && contributions.length > 0) {
    return contributions
      .map((contribution) => `${contribution.employee_name || contribution.employee_id} - ${Number(contribution.contribution_percent || 0)}%`)
      .join("\n");
  }

  return fallbackName || "";
}

function buildContributionLookup(contributions) {
  return contributions.reduce((map, contribution) => {
    const key = `${contribution.fixture_id}::${contribution.stage_name}::${contribution.revision_code}`;
    const entries = map.get(key) || [];
    entries.push(contribution);
    map.set(key, entries);
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

function resolveStageProof(stageTasks = []) {
  return stageTasks
    .flatMap((task) => task.proof_urls || [])
    .filter(Boolean)
    .join("\n");
}

function resolveStageHoldHistory(stageTasks = []) {
  return stageTasks
    .flatMap((task) => task.activities || [])
    .filter((activity) => {
      const metadata = activity.metadata && typeof activity.metadata === "object" ? activity.metadata : {};
      return String(metadata.to || "").toLowerCase() === "on_hold"
        || String(activity.action_type || "").toLowerCase().includes("hold");
    })
    .map((activity) => {
      const timestamp = formatTimelineTimestamp(activity.created_at);
      const actor = activity.user_name || "Unknown";
      return [timestamp, actor, activity.notes].filter(Boolean).join(" - ");
    })
    .join("\n");
}

function buildTemplateFixtureRows(fixtures, progressRows, attemptRows, contributions, stageTaskLookup) {
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

  return fixtures.map((fixture, index) => {
    const fixtureProgress = progressLookup.get(fixture.fixture_id) || new Map();
    const fixtureAttempts = attemptLookup.get(fixture.fixture_id) || new Map();
    const fixtureStageTasks = stageTaskLookup.get(fixture.fixture_id) || new Map();
    const stageCells = {};
    let actualMinutes = 0;

    for (const stage of STAGES) {
      const progressRow = fixtureProgress.get(stage.key) || null;
      const presentation = buildStagePresentation({
        stageAttempts: fixtureAttempts.get(stage.key) || [],
        progressRow,
        stage,
        fixture,
        isCurrent: progressRow?.status === "IN_PROGRESS",
        isFuture: !progressRow,
      });
      const revisionCode = progressRow
        ? formatStageRevisionCode(progressRow.stage_name, normalizeStageVersion(progressRow.stage_version))
        : "";
      const contributionRows = progressRow
        ? contributionLookup.get(`${fixture.fixture_id}::${progressRow.stage_name}::${revisionCode}`) || []
        : [];

      actualMinutes += Number(presentation.minutes || 0);
      stageCells[stage.key] = {
        hrs: presentation.minutes ? formatDuration(presentation.minutes) : "",
        dateRange: formatDateRange(presentation.assignedAt, presentation.completedAt),
        progress: stageStatusToProgress(progressRow?.status),
        revision: revisionCode,
        employees: formatStageContributors(contributionRows, progressRow?.assigned_to_name || progressRow?.assigned_to || ""),
        approvalStatus: progressRow ? normalizeStatus(progressRow.status) : "",
        proof: resolveStageProof(fixtureStageTasks.get(stage.key) || []),
        holdHistory: resolveStageHoldHistory(fixtureStageTasks.get(stage.key) || []),
      };
    }

    return {
      srNo: index + 1,
      fixtureNo: fixture.fixture_no,
      opNo: fixture.op_no,
      partName: fixture.part_name,
      priority: fixture.task_priority || "",
      assigned: fixture.task_assignee_name || fixture.task_assigned_to || "",
      globalStatus: resolveFixtureStatus(Array.from(fixtureProgress.values()), fixture.task_status, fixture.task_deadline),
      concept: stageCells.concept,
      dap: stageCells.dap,
      finish3d: stageCells.three_d_finish,
      finish2d: stageCells.two_d_finish,
      plannedHrs: formatDuration(Number(fixture.task_planned_minutes || 0)),
      actualHrs: formatDuration(Number(fixture.task_actual_minutes || 0) || actualMinutes),
    };
  });
}

function writeMergedValue(worksheet, address, value) {
  worksheet.getCell(address).value = value ?? "";
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
    I: row.concept.dateRange,
    J: row.concept.progress,
    K: row.concept.revision,
    L: row.concept.employees,
    M: row.concept.approvalStatus,
    N: row.dap.hrs,
    O: row.dap.dateRange,
    P: row.dap.progress,
    Q: row.dap.revision,
    R: row.dap.employees,
    S: row.dap.approvalStatus,
    T: row.finish3d.hrs,
    U: row.finish3d.dateRange,
    V: row.finish3d.progress,
    W: row.finish3d.employees,
    X: row.finish3d.approvalStatus,
    Y: row.finish2d.hrs,
    Z: row.finish2d.dateRange,
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

function calculateTemplateKpis(rows) {
  const totalFixtures = rows.length;
  const completed = rows.filter((row) => row.globalStatus === STATUS_LABELS.CLOSED).length;
  const pending = rows.filter((row) => [STATUS_LABELS.ASSIGNED, STATUS_LABELS.IN_PROGRESS, STATUS_LABELS.REVIEW].includes(row.globalStatus)).length;
  const overdue = rows.filter((row) => row.globalStatus === STATUS_LABELS.OVERDUE).length;
  const onHold = rows.filter((row) => row.globalStatus === STATUS_LABELS.ON_HOLD).length;
  const rejected = rows.filter((row) => row.globalStatus === STATUS_LABELS.REWORK).length;

  return {
    overallProgress: totalFixtures ? `${Math.round((completed / totalFixtures) * 100)}%` : "0%",
    totalFixtures,
    completed,
    pending,
    overdue,
    onHold,
    rejected,
  };
}

async function generateDesignProjectExecutionTemplateExcel({
  context,
  fixtures,
  progressRows,
  attemptRows,
  contributions,
  stageTasks,
  attachmentsByTaskId,
  activitiesByTaskId,
  filePath,
}) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(DESIGN_REPORT_TEMPLATE_PATH);
  const worksheet = workbook.worksheets[0];
  const templateRow = worksheet.getRow(14);
  const templateStyles = Array.from({ length: 39 }, (_, index) => cloneStyle(templateRow.getCell(index + 1).style));
  const templateHeight = templateRow.height;
  const existingDataRows = Math.max(0, worksheet.rowCount - 13);

  if (existingDataRows > 0) {
    worksheet.spliceRows(14, existingDataRows);
  }

  const stageTaskLookup = buildStageTaskLookup(stageTasks, attachmentsByTaskId, activitiesByTaskId);
  const rows = buildTemplateFixtureRows(fixtures, progressRows, attemptRows, contributions, stageTaskLookup);

  rows.forEach((row, index) => {
    const rowNumber = 14 + index;
    worksheet.spliceRows(rowNumber, 0, []);
    const excelRow = worksheet.getRow(rowNumber);
    excelRow.height = templateHeight;
    for (let columnIndex = 1; columnIndex <= 39; columnIndex += 1) {
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

  const kpis = calculateTemplateKpis(rows);
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

async function exportDesignReport(user, query = {}, options = {}) {
  const reportType = REPORT_TYPES.PROJECT;
  const departmentId = resolveReportDepartmentId(user, query.department_id);
  let context = null;
  let fixtures = [];

  if (reportType === REPORT_TYPES.PROJECT) {
    const projectId = String(query.project_id || "").trim();
    if (!projectId) {
      throw new AppError(400, "project_id is required");
    }

    context = await getProjectContext(user, projectId, departmentId);
    fixtures = await getFixturesForProject(projectId, user);
  }

  if (!fixtures.length) {
    throw new AppError(404, "No fixtures found for this report");
  }

  const fixtureIds = fixtures.map((fixture) => fixture.fixture_id);
  const [progressRows, attemptRows, stageTasks, contributions] = await Promise.all([
    getFixtureProgressRows(fixtureIds),
    getFixtureAttemptRows(fixtureIds),
    getFixtureStageTaskRows(fixtureIds),
    listContributionsForFixtures(fixtureIds),
  ]);
  const stageTaskIds = stageTasks.map((task) => task.task_id);
  const reportTaskIds = [
    ...fixtures.map((fixture) => fixture.task_id),
    ...stageTaskIds,
  ];
  const [attachmentsByTaskId, activitiesByTaskId] = await Promise.all([
    getTaskAttachmentsByTaskIds(reportTaskIds),
    getTaskActivitiesByTaskIds(reportTaskIds),
  ]);

  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "design-report-"));
  const finalPath = path.join(tempDirectory, buildReportFileName(context));

  try {
    await generateDesignProjectExecutionTemplateExcel({
      context,
      fixtures,
      progressRows,
      attemptRows,
      contributions,
      stageTasks,
      attachmentsByTaskId,
      activitiesByTaskId,
      filePath: finalPath,
    });

    const buffer = await fs.readFile(finalPath);

    return {
      filename: buildReportFileName(context),
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer,
    };
  } finally {
    await fs.rm(tempDirectory, { recursive: true, force: true });
  }
}

module.exports = {
  exportDesignReport,
  generateDesignProjectExecutionTemplateExcel,
  generateRawScopeExcel,
  normalizeStoredImageUrl,
  runPythonFormatter,
  getFixturesForProject,
  getFixtureProgressRows,
  getFixtureAttemptRows,
};
