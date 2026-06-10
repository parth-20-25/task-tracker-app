const {
  formatStageRevisionCode,
  normalizeStageVersion,
} = require("../../lib/workflowStageVersioning");
const {
  getDesignStageDisplayName,
  normalizeDesignStageName,
} = require("../../lib/designWorkflowStages");
const { getDesignRevisionReasonLabel } = require("../../lib/designRevisionTypes");
const {
  computeStageCompletionTruth,
  normalizeProgressStatus,
} = require("../designCompletion/stageCompletionCalculator");

const REPORT_STAGE_LAYOUT = Object.freeze({
  concept: { key: "concept", label: "CONCEPT", hasRevisionColumn: true, hasEmployeeColumn: true },
  dap: { key: "dap", label: "DAP", hasRevisionColumn: true, hasEmployeeColumn: true },
  three_d_finish: { key: "three_d_finish", label: "3D FINISH", hasRevisionColumn: false, hasEmployeeColumn: true },
  two_d_finish: { key: "two_d_finish", label: "2D FINISH", hasRevisionColumn: true, hasEmployeeColumn: false },
});

function formatTimelineTimestamp(value) {
  if (!value) {
    return "";
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = String(date.getUTCFullYear()).slice(-2);
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  return `${day}/${month}/${year} ${hours}:${minutes}`;
}

function formatExcelDate(value) {
  if (!value) {
    return "";
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = String(date.getUTCFullYear()).slice(-2);
  return `${day}/${month}/${year}`;
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

function formatDateRange(startValue, endValue) {
  const start = formatExcelDate(startValue);
  const end = formatExcelDate(endValue);
  if (start && end) {
    return `${start} - ${end}`;
  }

  return start || end || "";
}

function formatStageRevisionBlock(progressRow, revisionRow = null) {
  if (!progressRow) {
    return "";
  }

  const stageKey = normalizeDesignStageName(progressRow.stage_name);
  const stageDisplay = getDesignStageDisplayName(stageKey, progressRow.stage_name) || progressRow.stage_name;
  const revisionCode = revisionRow?.revision_code
    || formatStageRevisionCode(progressRow.stage_name, normalizeStageVersion(progressRow.stage_version));
  const reasonLabel = revisionRow
    ? getDesignRevisionReasonLabel(revisionRow.reason_type || revisionRow.revision_type)
    : null;

  const lines = [
    `Stage = ${stageDisplay}`,
    `Revision = ${revisionCode}`,
  ];

  if (reasonLabel) {
    lines.push(`Reason Type = ${reasonLabel}`);
  }

  return lines.join("\n");
}

function formatStageContributors(contributions) {
  if (!Array.isArray(contributions) || contributions.length === 0) {
    return "";
  }

  return contributions
    .map((contribution) => {
      const percent = contribution.contribution_percent === null || contribution.contribution_percent === undefined
        ? "Contribution % Not Recorded"
        : `${Number(contribution.contribution_percent)}%`;
      const employeeId = String(contribution.employee_id || "").trim();
      const employeeName = String(contribution.employee_name || "").trim();
      const employee = employeeId && employeeName && employeeName !== employeeId
        ? `${employeeId} - ${employeeName}`
        : employeeId || employeeName || "Not assigned";
      return `${employee}: ${percent}`;
    })
    .join("\n");
}

function formatStageProgressPercent(progressRow, weightPercent = 0) {
  if (!progressRow) {
    return "";
  }

  const stageTruth = computeStageCompletionTruth(progressRow, weightPercent);
  const status = normalizeProgressStatus(progressRow.status);

  if (status === "REJECTED" || stageTruth.approval_state === "rejected") {
    return "Rejected";
  }

  if (stageTruth.truth_error) {
    return "";
  }

  if (status === "APPROVED") {
    return "100%";
  }

  const weight = Number(weightPercent || 0);
  if (weight <= 0) {
    return "";
  }

  const percent = Math.round((Number(stageTruth.stage_completion_percent || 0) / weight) * 100);
  return `${Math.max(0, Math.min(100, percent))}%`;
}

function formatApprovalStatus(progressRow) {
  if (!progressRow) {
    return "";
  }

  return normalizeProgressStatus(progressRow.status);
}

function formatProofRegister(stageTasks = []) {
  const proofLines = stageTasks
    .flatMap((task) => {
      const proofs = Array.isArray(task.proof_urls) ? task.proof_urls : [];
      return proofs.map((url, index) => {
        const label = task.task_id ? `Task ${task.task_id}` : "Proof";
        return `${label} #${index + 1}: ${url}`;
      });
    })
    .filter(Boolean);

  return proofLines.join("\n");
}

function formatHoldHistory(stageTasks = []) {
  return stageTasks
    .flatMap((task) => task.activities || [])
    .filter((activity) => {
      const metadata = activity.metadata && typeof activity.metadata === "object" ? activity.metadata : {};
      return String(metadata.to || "").toLowerCase() === "on_hold"
        || String(metadata.from || "").toLowerCase() === "on_hold"
        || String(activity.action_type || "").toLowerCase().includes("hold");
    })
    .map((activity) => {
      const metadata = activity.metadata && typeof activity.metadata === "object" ? activity.metadata : {};
      const timestamp = formatTimelineTimestamp(activity.created_at);
      const actor = activity.user_name || "Not recorded";
      const stageLabel = metadata.stage || metadata.stage_name || "";
      const holdState = metadata.to === "on_hold" ? "On Hold" : metadata.from === "on_hold" ? "Resumed" : "Hold";
      return [timestamp, stageLabel, holdState, actor, activity.notes].filter(Boolean).join(" - ");
    })
    .join("\n");
}

function resolveRevisionForStage(revisionLookup, fixtureId, progressRow) {
  if (!progressRow) {
    return null;
  }

  const stageKey = normalizeDesignStageName(progressRow.stage_name);
  const version = normalizeStageVersion(progressRow.stage_version);
  return revisionLookup.get(`${fixtureId}::${stageKey}::${version}`) || null;
}

module.exports = {
  REPORT_STAGE_LAYOUT,
  formatApprovalStatus,
  formatDateRange,
  formatDuration,
  formatExcelDate,
  formatHoldHistory,
  formatProofRegister,
  formatStageContributors,
  formatStageProgressPercent,
  formatStageRevisionBlock,
  formatTimelineTimestamp,
  resolveRevisionForStage,
};
