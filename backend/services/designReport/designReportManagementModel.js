const { getDesignRevisionReasonLabel } = require("../../lib/designRevisionTypes");
const { getDesignStageDisplayName, normalizeDesignStageName } = require("../../lib/designWorkflowStages");
const {
  formatStageRevisionCode,
  normalizeStageVersion,
} = require("../../lib/workflowStageVersioning");
const { REPORT_STAGES, getStageBucket } = require("./designReportValidation");
const { STATUS_LABELS, resolveFixtureGlobalStatus } = require("./designReportKpiContract");

const REPORT_VERSION = "PARC Design Project Report v2";

const STATUS_COLORS = Object.freeze({
  Assigned: "#3A7BD5",
  "In Progress": "#28A745",
  "On Hold": "#FF9800",
  Review: "#009688",
  Rework: "#9C27B0",
  Closed: "#616161",
  Overdue: "#D32F2F",
});

const AUXILIARY_COLORS = Object.freeze({
  Pending: "#9E9E9E",
  Available: STATUS_COLORS["In Progress"],
  Missing: STATUS_COLORS.Overdue,
  Green: STATUS_COLORS["In Progress"],
  Yellow: STATUS_COLORS["On Hold"],
  Red: STATUS_COLORS.Overdue,
});

const STAGE_LABELS = Object.freeze({
  concept: "Concept",
  dap: "DAP",
  three_d_finish: "3D",
  two_d_finish: "2D",
});

const MATRIX_STATUS_LABELS = [
  "Pending",
  "Assigned",
  "In Progress",
  "Review",
  "Rework",
  "On Hold",
  "Closed",
  "Overdue",
];

function normalizeText(value) {
  return String(value || "").trim();
}

function parseDate(value) {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value) {
  const date = parseDate(value);
  if (!date) {
    return "";
  }

  return [
    String(date.getUTCDate()).padStart(2, "0"),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCFullYear()).slice(-2),
  ].join("/");
}

function formatTime(value) {
  const date = parseDate(value);
  if (!date) {
    return "";
  }

  return [
    String(date.getUTCHours()).padStart(2, "0"),
    String(date.getUTCMinutes()).padStart(2, "0"),
  ].join(":");
}

function formatDateTime(value) {
  const date = parseDate(value);
  if (!date) {
    return "";
  }

  return `${formatDate(date)} ${formatTime(date)}`;
}

function formatDuration(totalMinutes) {
  const minutes = Number(totalMinutes);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return "";
  }

  const rounded = Math.round(minutes);
  const hours = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  return `${hours}h ${remainder}m`;
}

function formatHours(totalMinutes) {
  const minutes = Number(totalMinutes);
  if (!Number.isFinite(minutes) || minutes === 0) {
    return "";
  }

  return `${minutes < 0 ? "-" : ""}${(Math.abs(minutes) / 60).toFixed(1)}h`;
}

function formatSignedHours(totalMinutes) {
  const minutes = Number(totalMinutes);
  if (!Number.isFinite(minutes) || minutes === 0) {
    return "";
  }

  return `${minutes > 0 ? "+" : "-"}${(Math.abs(minutes) / 60).toFixed(1)}h`;
}

function formatPriority(value) {
  const raw = normalizeText(value);
  if (!raw) {
    return "";
  }

  return raw
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function hasRecordedContributionPercent(value) {
  if (value === null || value === undefined || value === "") {
    return false;
  }

  return Number.isFinite(Number(value));
}

function formatContributionPercent(value) {
  if (!hasRecordedContributionPercent(value)) {
    return "Contribution % Not Recorded";
  }

  const percent = Number(value);
  return `${Number.isInteger(percent) ? percent : percent.toFixed(2)}%`;
}

function clampPercent(value) {
  const percent = Number(value);
  if (!Number.isFinite(percent)) {
    return null;
  }

  if (percent < 0 || percent > 100) {
    return null;
  }

  return Math.round(percent);
}

function dateMin(values) {
  return values
    .map(parseDate)
    .filter(Boolean)
    .sort((left, right) => left.getTime() - right.getTime())[0] || null;
}

function dateMax(values) {
  const dates = values
    .map(parseDate)
    .filter(Boolean)
    .sort((left, right) => right.getTime() - left.getTime());
  return dates[0] || null;
}

function daysBetween(startValue, endValue) {
  const start = parseDate(startValue);
  const end = parseDate(endValue);
  if (!start || !end) {
    return null;
  }

  return Math.ceil((end.getTime() - start.getTime()) / 86400000);
}

function minutesBetween(startValue, endValue) {
  const start = parseDate(startValue);
  const end = parseDate(endValue);
  if (!start || !end || end <= start) {
    return null;
  }

  return Math.round((end.getTime() - start.getTime()) / 60000);
}

function formatEmployeeDisplay(employeeId, employeeName) {
  const id = normalizeText(employeeId);
  const name = normalizeText(employeeName);

  if (id && name && name !== id) {
    return `${id} - ${name}`;
  }

  if (id) {
    return `${id} - Not recorded`;
  }

  return name;
}

function normalizeProgressStatus(value) {
  return normalizeText(value).toUpperCase();
}

function statusColor(status) {
  return STATUS_COLORS[status] || AUXILIARY_COLORS[status] || "#616161";
}

function humanizeAction(value) {
  const raw = normalizeText(value);
  if (!raw) {
    return "Activity";
  }

  return raw
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function metadataValue(metadata, keys) {
  if (!metadata || typeof metadata !== "object") {
    return "";
  }

  for (const key of keys) {
    const value = metadata[key];
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }

  return "";
}

function buildProgressLookup(progressRows = []) {
  return progressRows.reduce((map, row) => {
    const fixtureKey = String(row.fixture_id);
    const fixtureMap = map.get(fixtureKey) || new Map();
    const stageKey = getStageBucket(row.stage_name);
    if (stageKey) {
      fixtureMap.set(stageKey, row);
    }
    map.set(fixtureKey, fixtureMap);
    return map;
  }, new Map());
}

function buildAttemptLookup(attemptRows = []) {
  return attemptRows.reduce((map, row) => {
    const fixtureKey = String(row.fixture_id);
    const fixtureMap = map.get(fixtureKey) || new Map();
    const stageKey = getStageBucket(row.stage_name);
    if (stageKey) {
      const attempts = fixtureMap.get(stageKey) || [];
      attempts.push(row);
      fixtureMap.set(stageKey, attempts);
    }
    map.set(fixtureKey, fixtureMap);
    return map;
  }, new Map());
}

function buildStageTaskLookup(stageTasks = []) {
  return stageTasks.reduce((map, task) => {
    const fixtureKey = String(task.fixture_id);
    const stageKey = getStageBucket(task.stage_name);
    const fixtureMap = map.get(fixtureKey) || new Map();
    if (stageKey) {
      const tasks = fixtureMap.get(stageKey) || [];
      tasks.push(task);
      fixtureMap.set(stageKey, tasks);
    }
    map.set(fixtureKey, fixtureMap);
    return map;
  }, new Map());
}

function buildContributionLookups(contributions = []) {
  return contributions.reduce((lookups, contribution) => {
    const fixtureKey = String(contribution.fixture_id);
    const stageKey = getStageBucket(contribution.stage_name);
    if (!stageKey) {
      return lookups;
    }

    const revisionNo = normalizeStageVersion(contribution.stage_revision_no);
    const revisionCode = contribution.revision_code
      || formatStageRevisionCode(contribution.stage_name || stageDisplayName(stageKey), revisionNo);
    const stageMapKey = `${fixtureKey}::${stageKey}`;
    const revisionMapKey = `${stageMapKey}::${revisionCode}`;
    const versionMapKey = `${stageMapKey}::${revisionNo}`;

    const stageRows = lookups.byStage.get(stageMapKey) || [];
    stageRows.push(contribution);
    lookups.byStage.set(stageMapKey, stageRows);

    const revisionRows = lookups.byRevisionCode.get(revisionMapKey) || [];
    revisionRows.push(contribution);
    lookups.byRevisionCode.set(revisionMapKey, revisionRows);

    const versionRows = lookups.byRevisionNo.get(versionMapKey) || [];
    versionRows.push(contribution);
    lookups.byRevisionNo.set(versionMapKey, versionRows);

    return lookups;
  }, {
    byStage: new Map(),
    byRevisionCode: new Map(),
    byRevisionNo: new Map(),
  });
}

function getMapEntries(map, key) {
  if (!map || typeof map.get !== "function") {
    return [];
  }

  return map.get(Number(key)) || map.get(String(key)) || [];
}

function stageDisplayName(stageKey, fallback = "") {
  return STAGE_LABELS[stageKey]
    || getDesignStageDisplayName(normalizeDesignStageName(fallback), fallback)
    || fallback
    || "";
}

function getProgressActualEnd(progressRow, attempts = []) {
  const attemptEnds = attempts.flatMap((attempt) => [
    attempt.approved_at,
    attempt.completed_at,
    attempt.updated_at,
  ]);
  return dateMax([progressRow?.completed_at, ...attemptEnds]);
}

function getProgressStart(progressRow, attempts = []) {
  const attemptStarts = attempts.flatMap((attempt) => [
    attempt.assigned_at,
    attempt.started_at,
  ]);
  return dateMin([progressRow?.assigned_at, progressRow?.started_at, ...attemptStarts]);
}

function getAttemptDurationMinutes(attempt) {
  const direct = Number(attempt?.duration_minutes);
  if (Number.isFinite(direct) && direct > 0) {
    return direct;
  }

  const start = parseDate(attempt?.assigned_at || attempt?.started_at);
  const end = parseDate(attempt?.completed_at || attempt?.approved_at || attempt?.updated_at);
  if (!start || !end || end <= start) {
    return 0;
  }

  return Math.round((end.getTime() - start.getTime()) / 60000);
}

function getStageDurationMinutes(progressRow, attempts = []) {
  const attemptTotal = attempts.reduce((sum, attempt) => sum + getAttemptDurationMinutes(attempt), 0);
  if (attemptTotal > 0) {
    return attemptTotal;
  }

  const direct = Number(progressRow?.duration_minutes);
  if (Number.isFinite(direct) && direct > 0) {
    return direct;
  }

  const start = getProgressStart(progressRow, attempts);
  const end = getProgressActualEnd(progressRow, attempts);
  if (!start || !end || end <= start) {
    return 0;
  }

  return Math.round((end.getTime() - start.getTime()) / 60000);
}

function getCurrentStage(progressByStage) {
  for (const stage of REPORT_STAGES) {
    const row = progressByStage.get(stage.key);
    if (normalizeProgressStatus(row?.status) !== "APPROVED") {
      return { stage, row };
    }
  }

  const lastStage = REPORT_STAGES[REPORT_STAGES.length - 1];
  return { stage: lastStage, row: progressByStage.get(lastStage.key) || null };
}

function progressStatusToMatrixStatus(progressRow, fixtureStatus, isCurrentStage) {
  if (fixtureStatus === STATUS_LABELS.ON_HOLD && isCurrentStage) {
    return "On Hold";
  }

  if (fixtureStatus === STATUS_LABELS.OVERDUE && isCurrentStage) {
    return "Overdue";
  }

  const status = normalizeProgressStatus(progressRow?.status);
  if (status === "APPROVED") {
    return "Closed";
  }

  if (status === "REJECTED") {
    return "Rework";
  }

  if (status === "COMPLETED" || status === "SUBMITTED_FOR_VERIFICATION") {
    return "Review";
  }

  if (status === "IN_PROGRESS") {
    return "In Progress";
  }

  if (progressRow?.assigned_to || progressRow?.assigned_at) {
    return "Assigned";
  }

  return "Pending";
}

function collectTaskIdsForFixture(fixture, fixtureStageTasks) {
  const ids = [];
  if (fixture.task_id) {
    ids.push(fixture.task_id);
  }

  fixtureStageTasks.forEach((tasks) => {
    tasks.forEach((task) => {
      if (task.task_id) {
        ids.push(task.task_id);
      }
    });
  });

  return [...new Set(ids.map(String))];
}

function getProofUrlsFromTask(task) {
  if (!task) {
    return [];
  }

  if (Array.isArray(task.proof_url)) {
    return task.proof_url.filter(Boolean);
  }

  return task.proof_url ? [task.proof_url] : [];
}

function collectProofRecords({ fixture, fixtureStageTasks, attachmentsByTaskId }) {
  const records = [];
  const seen = new Set();
  const addRecord = (record) => {
    const url = normalizeText(record.url);
    if (!url || seen.has(url)) {
      return;
    }
    seen.add(url);
    records.push({
      url,
      fixtureNumber: record.fixtureNumber || fixture.fixture_no || "",
      fixtureName: record.fixtureName || fixture.part_name || "",
      stage: record.stage || "Fixture",
      taskId: record.taskId || "",
      source: record.source || "Proof",
      uploadedAt: record.uploadedAt || null,
      uploadedBy: record.uploadedBy || "",
    });
  };

  getProofUrlsFromTask({ proof_url: fixture.task_proof_url }).forEach((url) => {
    addRecord({
      url,
      stage: "Fixture",
      taskId: fixture.task_id || "",
      source: "Task proof",
      uploadedAt: fixture.task_completed_at || fixture.task_updated_at || fixture.task_created_at,
      uploadedBy: formatEmployeeDisplay(fixture.task_assigned_to, fixture.task_assignee_name),
    });
  });

  fixtureStageTasks.forEach((stageTasks, stageKey) => {
    stageTasks.forEach((task) => {
      const stage = stageDisplayName(stageKey, task.stage_name);
      getProofUrlsFromTask(task).forEach((url) => {
        addRecord({
          url,
          stage,
          taskId: task.task_id || "",
          source: "Stage proof",
          uploadedAt: task.completed_at || task.updated_at || task.created_at,
          uploadedBy: formatEmployeeDisplay(task.assigned_to, task.assignee_names || task.assigned_to_name),
        });
      });

      getMapEntries(attachmentsByTaskId, task.task_id).forEach((attachment) => {
        addRecord({
          url: attachment.file_url,
          stage,
          taskId: task.task_id || "",
          source: attachment.file_name || "Attachment",
          uploadedAt: attachment.uploaded_at,
          uploadedBy: formatEmployeeDisplay(attachment.uploaded_by, attachment.uploaded_by_name),
        });
      });
    });
  });

  if (fixture.task_id) {
    getMapEntries(attachmentsByTaskId, fixture.task_id).forEach((attachment) => {
      addRecord({
        url: attachment.file_url,
        stage: "Fixture",
        taskId: fixture.task_id || "",
        source: attachment.file_name || "Attachment",
        uploadedAt: attachment.uploaded_at,
        uploadedBy: formatEmployeeDisplay(attachment.uploaded_by, attachment.uploaded_by_name),
      });
    });
  }

  return records.sort((left, right) => {
    const leftDate = parseDate(left.uploadedAt)?.getTime() || 0;
    const rightDate = parseDate(right.uploadedAt)?.getTime() || 0;
    return leftDate - rightDate;
  });
}

function buildStageRevisionLookup(revisions = []) {
  return revisions.reduce((map, revision) => {
    const key = `${revision.fixture_id}::${getStageBucket(revision.stage_name)}::${normalizeStageVersion(revision.stage_version)}`;
    if (!map.has(key)) {
      map.set(key, revision);
    }
    return map;
  }, new Map());
}

function formatStageTimeline(startValue, endValue) {
  const start = formatDateTime(startValue);
  const end = formatDateTime(endValue);
  if (start && end) {
    return `${start} -> ${end}`;
  }
  if (start) {
    return `${start} -> In Progress`;
  }
  return "";
}

function buildStageDetailCell({ fixtureRow, stage, revisionLookup }) {
  const progress = fixtureRow.raw.progressByStage.get(stage.key) || null;
  const attempts = fixtureRow.raw.attemptByStage.get(stage.key) || [];
  const start = getProgressStart(progress, attempts);
  const end = getProgressActualEnd(progress, attempts);
  const duration = getStageDurationMinutes(progress, attempts);
  const status = progressStatusToMatrixStatus(
    progress,
    fixtureRow.currentStatus,
    getCurrentStage(fixtureRow.raw.progressByStage).stage.key === stage.key,
  );
  const stageVersion = normalizeStageVersion(progress?.stage_version);
  const revision = progress
    ? revisionLookup.get(`${fixtureRow.fixture_id}::${stage.key}::${stageVersion}`)
    : null;
  const revisionCode = progress
    ? (revision?.revision_code || formatStageRevisionCode(progress.stage_name, stageVersion))
    : "";
  const revisionReason = revision
    ? getDesignRevisionReasonLabel(revision.reason_type || revision.revision_type)
      || revision.revision_reason
      || revision.revision_remarks
      || ""
    : "";
  const stageProofs = fixtureRow.proofRecords.filter((record) => record.stage === stageDisplayName(stage.key, progress?.stage_name));
  const proofCount = stageProofs.length;
  const firstProof = stageProofs[0] || null;

  return {
    status,
    timeline: formatStageTimeline(start, end),
    duration: formatDuration(duration),
    assignedTo: formatEmployeeDisplay(progress?.assigned_to, progress?.assigned_to_name),
    revision: [revisionCode, revisionReason].filter(Boolean).join(" - "),
    proof: proofCount ? `View Proof (${proofCount})` : "Missing",
    proofUrl: firstProof?.url || "",
  };
}

function buildFixtureStageDetails(fixtureRows, revisions = []) {
  const revisionLookup = buildStageRevisionLookup(revisions);

  return fixtureRows.map((fixtureRow) => {
    const stageDetails = REPORT_STAGES.reduce((acc, stage) => {
      acc[stage.key] = buildStageDetailCell({ fixtureRow, stage, revisionLookup });
      return acc;
    }, {});

    return {
      fixtureNumber: fixtureRow.fixtureNumber,
      fixtureName: fixtureRow.fixtureName,
      globalStatus: fixtureRow.currentStatus,
      currentStage: fixtureRow.currentStage,
      assignedTo: fixtureRow.assignedTo,
      conceptStatus: stageDetails.concept.status,
      conceptTimeline: stageDetails.concept.timeline,
      conceptDuration: stageDetails.concept.duration,
      conceptAssignedTo: stageDetails.concept.assignedTo,
      conceptRevision: stageDetails.concept.revision,
      conceptProof: stageDetails.concept.proof,
      conceptProofUrl: stageDetails.concept.proofUrl,
      dapStatus: stageDetails.dap.status,
      dapTimeline: stageDetails.dap.timeline,
      dapDuration: stageDetails.dap.duration,
      dapAssignedTo: stageDetails.dap.assignedTo,
      dapRevision: stageDetails.dap.revision,
      dapProof: stageDetails.dap.proof,
      dapProofUrl: stageDetails.dap.proofUrl,
      threeDStatus: stageDetails.three_d_finish.status,
      threeDTimeline: stageDetails.three_d_finish.timeline,
      threeDDuration: stageDetails.three_d_finish.duration,
      threeDAssignedTo: stageDetails.three_d_finish.assignedTo,
      threeDRevision: stageDetails.three_d_finish.revision,
      threeDProof: stageDetails.three_d_finish.proof,
      threeDProofUrl: stageDetails.three_d_finish.proofUrl,
      twoDStatus: stageDetails.two_d_finish.status,
      twoDTimeline: stageDetails.two_d_finish.timeline,
      twoDDuration: stageDetails.two_d_finish.duration,
      twoDAssignedTo: stageDetails.two_d_finish.assignedTo,
      twoDRevision: stageDetails.two_d_finish.revision,
      twoDProof: stageDetails.two_d_finish.proof,
      twoDProofUrl: stageDetails.two_d_finish.proofUrl,
      plannedHours: fixtureRow.plannedHours,
      actualHours: fixtureRow.actualHours,
      variance: fixtureRow.variance,
    };
  });
}

function buildRevisionRowsByFixtureStage(revisions = []) {
  return revisions.reduce((map, revision) => {
    const fixtureKey = String(revision.fixture_id);
    const stageKey = getStageBucket(revision.stage_name);
    if (!stageKey) {
      return map;
    }

    const key = `${fixtureKey}::${stageKey}`;
    const rows = map.get(key) || [];
    rows.push(revision);
    map.set(key, rows);
    return map;
  }, new Map());
}

function getStageTaskPlannedEnd(stageTasks, fixtureRow) {
  const stageTaskPlannedEnd = dateMax(
    stageTasks.map((task) => task.deadline || task.due_date || task.sla_due_date),
  );

  if (stageTaskPlannedEnd) {
    return stageTaskPlannedEnd;
  }

  return dateMax([
    fixtureRow.raw.fixture.task_deadline,
    fixtureRow.raw.fixture.task_due_date,
    fixtureRow.raw.fixture.task_sla_due_date,
  ]);
}

function getStageTaskPlannedMinutes(stageTasks) {
  return stageTasks.reduce((sum, task) => {
    const minutes = Number(task.planned_minutes);
    return sum + (Number.isFinite(minutes) && minutes > 0 ? minutes : 0);
  }, 0);
}

function getStageTaskActualMinutes(stageTasks) {
  return stageTasks.reduce((sum, task) => {
    const minutes = Number(task.actual_minutes);
    return sum + (Number.isFinite(minutes) && minutes > 0 ? minutes : 0);
  }, 0);
}

function getContributionDate(contribution, metadataKeys, fallback) {
  const metadata = contribution?.metadata && typeof contribution.metadata === "object"
    ? contribution.metadata
    : {};
  return metadataKeys
    .map((key) => metadata[key])
    .map(parseDate)
    .find(Boolean)
    || parseDate(fallback)
    || null;
}

function collectActivityContributionWorkers({ fixtureRow, stage, revisionCode, revisionNo }) {
  return fixtureRow.raw.activities.flatMap((activity) => {
    const metadata = activity.metadata && typeof activity.metadata === "object" ? activity.metadata : {};
    const reassignment = metadata.reassignment_contribution;
    if (!reassignment || typeof reassignment !== "object") {
      return [];
    }

    const activityStageKey = getStageBucket(reassignment.stage_name || metadata.stage_name || metadata.stage);
    const activityRevisionNo = normalizeStageVersion(reassignment.stage_revision_no);
    const activityRevisionCode = reassignment.revision_code || formatStageRevisionCode(reassignment.stage_name || stageDisplayName(stage.key), activityRevisionNo);
    if (activityStageKey !== stage.key || (activityRevisionCode !== revisionCode && activityRevisionNo !== revisionNo)) {
      return [];
    }

    const previousPercent = reassignment.previous_contribution_percent;
    const remainingPercent = reassignment.remaining_contribution_percent;
    const actor = formatEmployeeDisplay(activity.user_employee_id, activity.user_name);
    return [
      {
        worker: formatEmployeeDisplay(reassignment.previous_assigned_to, reassignment.previous_assigned_to_name),
        contributionPercent: formatContributionPercent(previousPercent),
        contributionKind: "ACTUAL",
        started: "",
        ended: formatDateTime(activity.created_at),
        transferReason: "Task reassignment",
        transferredBy: actor,
        transferredAt: formatDateTime(activity.created_at),
      },
      {
        worker: formatEmployeeDisplay(reassignment.next_assigned_to, reassignment.next_assigned_to_name),
        contributionPercent: formatContributionPercent(remainingPercent),
        contributionKind: "REMAINING",
        started: formatDateTime(activity.created_at),
        ended: "",
        transferReason: "Task reassignment",
        transferredBy: actor,
        transferredAt: formatDateTime(activity.created_at),
      },
    ].filter((row) => row.worker);
  });
}

function collectAuditWorkers({ contributions, activityWorkers = [], attempts, stageTasks, progress, stageStart, stageEnd }) {
  if (contributions.length) {
    return contributions.map((contribution) => {
      const matchingAttempts = attempts.filter((attempt) => (
        normalizeText(attempt.assigned_to) === normalizeText(contribution.employee_id)
      ));
      const matchingTasks = stageTasks.filter((task) => (
        normalizeText(task.assigned_to) === normalizeText(contribution.employee_id)
      ));
      const workerStart = getContributionDate(
        contribution,
        ["started_at", "start_at", "assigned_at"],
        dateMin([
          ...matchingAttempts.flatMap((attempt) => [attempt.assigned_at, attempt.started_at]),
          ...matchingTasks.flatMap((task) => [task.assigned_at, task.started_at, task.created_at]),
          stageStart,
        ]),
      );
      const workerEnd = getContributionDate(
        contribution,
        ["ended_at", "end_at", "completed_at", "actual_end"],
        contribution.transferred_at
          || dateMax([
            ...matchingAttempts.flatMap((attempt) => [attempt.approved_at, attempt.completed_at, attempt.updated_at]),
            ...matchingTasks.flatMap((task) => [task.approved_at, task.completed_at, task.closed_at, task.updated_at]),
            stageEnd,
          ]),
      );

      return {
        worker: formatEmployeeDisplay(contribution.employee_id, contribution.employee_name),
        contributionPercent: formatContributionPercent(contribution.contribution_percent),
        contributionKind: contribution.contribution_kind || "ACTUAL",
        started: formatDateTime(workerStart),
        ended: formatDateTime(workerEnd),
        transferReason: contribution.transfer_reason || "",
        transferredBy: formatEmployeeDisplay(contribution.transferred_by, contribution.transferred_by_name),
        transferredAt: formatDateTime(contribution.transferred_at),
      };
    });
  }

  if (activityWorkers.length) {
    return activityWorkers;
  }

  const workerMap = new Map();
  const addWorker = (employeeId, employeeName, startValue, endValue) => {
    const key = normalizeText(employeeId) || normalizeText(employeeName);
    if (!key) {
      return;
    }

    const existing = workerMap.get(key) || {
      employeeId,
      employeeName,
      starts: [],
      ends: [],
    };
    existing.starts.push(startValue);
    existing.ends.push(endValue);
    workerMap.set(key, existing);
  };

  attempts.forEach((attempt) => {
    addWorker(
      attempt.assigned_to,
      attempt.assigned_to_name,
      attempt.started_at || attempt.assigned_at,
      attempt.approved_at || attempt.completed_at || attempt.updated_at,
    );
  });
  stageTasks.forEach((task) => {
    addWorker(
      task.assigned_to,
      task.assignee_names || task.assigned_to_name,
      task.started_at || task.assigned_at || task.created_at,
      task.approved_at || task.completed_at || task.closed_at || task.updated_at,
    );
  });
  addWorker(
    progress?.assigned_to,
    progress?.assigned_to_name,
    progress?.started_at || progress?.assigned_at || stageStart,
    progress?.completed_at || progress?.updated_at || stageEnd,
  );

  const workers = [...workerMap.values()].map((worker) => ({
    worker: formatEmployeeDisplay(worker.employeeId, worker.employeeName),
    contributionPercent: "Contribution % Not Recorded",
    contributionKind: "",
    started: formatDateTime(dateMin(worker.starts)),
    ended: formatDateTime(dateMax(worker.ends)),
    transferReason: "",
    transferredBy: "",
    transferredAt: "",
  }));

  if (workers.length) {
    return workers;
  }

  return [{
    worker: "Not assigned",
    contributionPercent: "Contribution % Not Recorded",
    contributionKind: "",
    started: formatDateTime(stageStart),
    ended: formatDateTime(stageEnd),
    transferReason: "",
    transferredBy: "",
    transferredAt: "",
  }];
}

function collectStageProofLinks(fixtureRow, stageLabel, includeProofs) {
  if (!includeProofs) {
    return [];
  }

  return fixtureRow.proofRecords
    .filter((record) => record.stage === stageLabel)
    .map((record, index) => ({
      label: `Proof ${index + 1}`,
      url: record.url,
      uploadedAt: formatDateTime(record.uploadedAt),
      uploadedBy: record.uploadedBy,
      source: record.source,
    }));
}

function buildStageAuditEntry({
  fixtureRow,
  stage,
  revisionNo,
  revision,
  contributionLookups,
}) {
  const progress = fixtureRow.raw.progressByStage.get(stage.key) || null;
  const progressRevisionNo = normalizeStageVersion(progress?.stage_version);
  const attempts = (fixtureRow.raw.attemptByStage.get(stage.key) || [])
    .filter((attempt) => normalizeStageVersion(attempt.stage_version) === revisionNo);
  const isCurrentRevision = !progress || progressRevisionNo === revisionNo;
  const stageTasks = isCurrentRevision
    ? (fixtureRow.raw.fixtureStageTasks.get(stage.key) || [])
    : [];
  const stageName = progress?.stage_name || revision?.stage_name || stageDisplayName(stage.key);
  const revisionCode = revision?.revision_code || formatStageRevisionCode(stageName, revisionNo);
  const contributions = (
    contributionLookups.byRevisionCode.get(`${fixtureRow.fixture_id}::${stage.key}::${revisionCode}`)
    || contributionLookups.byRevisionNo.get(`${fixtureRow.fixture_id}::${stage.key}::${revisionNo}`)
    || []
  );
  const activityWorkers = collectActivityContributionWorkers({
    fixtureRow,
    stage,
    revisionCode,
    revisionNo,
  });
  const stageStart = dateMin([
    progress?.assigned_at,
    progress?.started_at,
    ...attempts.flatMap((attempt) => [attempt.assigned_at, attempt.started_at]),
    ...stageTasks.flatMap((task) => [task.assigned_at, task.started_at, task.created_at]),
  ]);
  const actualEnd = dateMax([
    progress?.completed_at,
    ...attempts.flatMap((attempt) => [attempt.approved_at, attempt.completed_at, attempt.updated_at]),
    ...stageTasks.flatMap((task) => [task.approved_at, task.completed_at, task.closed_at, task.updated_at]),
  ]);
  const stageDuration = attempts.length || progress
    ? getStageDurationMinutes(progress, attempts)
    : getStageTaskActualMinutes(stageTasks);
  const plannedMinutes = getStageTaskPlannedMinutes(stageTasks);
  const actualMinutes = getStageTaskActualMinutes(stageTasks) || stageDuration;
  const plannedEnd = getStageTaskPlannedEnd(stageTasks, fixtureRow);
  const proofLinks = collectStageProofLinks(
    fixtureRow,
    stageDisplayName(stage.key, stageName),
    isCurrentRevision,
  );
  const workers = collectAuditWorkers({
    contributions,
    activityWorkers,
    attempts,
    stageTasks,
    progress: isCurrentRevision ? progress : null,
    stageStart,
    stageEnd: actualEnd,
  });
  const hasTransfer = contributions.some((contribution) => (
    contribution.transfer_reason || contribution.transferred_by || contribution.transferred_at
  )) || activityWorkers.length > 0 || workers.filter((worker) => worker.worker && worker.worker !== "Not assigned").length > 1;

  return {
    stage: stageDisplayName(stage.key, stageName),
    revision: revisionCode,
    revisionReason: revision
      ? getDesignRevisionReasonLabel(revision.reason_type || revision.revision_type)
        || revision.revision_reason
        || revision.revision_remarks
        || ""
      : "",
    plannedStart: formatDateTime(stageStart),
    plannedEnd: formatDateTime(plannedEnd),
    actualEnd: formatDateTime(actualEnd),
    plannedTime: formatHours(plannedMinutes),
    actualTime: formatHours(actualMinutes),
    variance: plannedMinutes && actualMinutes ? formatSignedHours(actualMinutes - plannedMinutes) : "",
    priority: formatPriority(stageTasks[0]?.priority || fixtureRow.raw.fixture.task_priority),
    transferred: hasTransfer ? "Yes" : "No",
    proofLinks,
    proofSummary: proofLinks.length ? `View Proof (${proofLinks.length})` : "No proof uploaded",
    workers,
  };
}

function buildFixtureStageExecutionAudit({ fixtureRows, contributions = [], revisions = [] }) {
  const contributionLookups = buildContributionLookups(contributions);
  const revisionsByFixtureStage = buildRevisionRowsByFixtureStage(revisions);

  return fixtureRows.map((fixtureRow) => {
    const stages = [];

    REPORT_STAGES.forEach((stage) => {
      const progress = fixtureRow.raw.progressByStage.get(stage.key) || null;
      const attempts = fixtureRow.raw.attemptByStage.get(stage.key) || [];
      const stageContributions = contributionLookups.byStage.get(`${fixtureRow.fixture_id}::${stage.key}`) || [];
      const stageRevisions = revisionsByFixtureStage.get(`${fixtureRow.fixture_id}::${stage.key}`) || [];
      const revisionNos = new Set([0]);

      if (progress) {
        revisionNos.add(normalizeStageVersion(progress.stage_version));
      }
      attempts.forEach((attempt) => revisionNos.add(normalizeStageVersion(attempt.stage_version)));
      stageContributions.forEach((contribution) => revisionNos.add(normalizeStageVersion(contribution.stage_revision_no)));
      stageRevisions.forEach((revision) => revisionNos.add(normalizeStageVersion(revision.stage_version)));

      [...revisionNos]
        .sort((left, right) => left - right)
        .forEach((revisionNo) => {
          const revision = stageRevisions.find((row) => normalizeStageVersion(row.stage_version) === revisionNo) || null;
          stages.push(buildStageAuditEntry({
            fixtureRow,
            stage,
            revisionNo,
            revision,
            contributionLookups,
          }));
        });
    });

    return {
      fixtureNumber: fixtureRow.fixtureNumber,
      fixtureName: fixtureRow.fixtureName,
      priority: formatPriority(fixtureRow.raw.fixture.task_priority),
      currentStatus: fixtureRow.currentStatus,
      currentStage: fixtureRow.currentStage,
      stages,
    };
  });
}

function buildWorkProofHistory(fixtureRows) {
  return fixtureRows.flatMap((fixtureRow) => (
    fixtureRow.proofRecords.map((record, index) => ({
      fixtureNumber: fixtureRow.fixtureNumber,
      fixtureName: fixtureRow.fixtureName,
      stage: record.stage,
      taskId: record.taskId,
      proofNumber: index + 1,
      proofAvailability: record.url ? "Available" : "Missing",
      proofLink: record.url,
      uploadedAt: formatDateTime(record.uploadedAt),
      uploadedBy: record.uploadedBy,
      source: record.source,
    }))
  ));
}

function describeActivity(activity) {
  const metadata = activity.metadata && typeof activity.metadata === "object" ? activity.metadata : {};
  const parts = [
    activity.notes,
    metadataValue(metadata, ["description", "reason", "remarks", "comment"]),
  ].filter(Boolean);

  if (parts.length) {
    return parts.join(" | ");
  }

  const from = metadataValue(metadata, ["from", "from_status", "previous_status"]);
  const to = metadataValue(metadata, ["to", "to_status", "next_status"]);
  if (from || to) {
    return [from, to].filter(Boolean).join(" -> ");
  }

  return humanizeAction(activity.action_type);
}

function collectActivitiesForFixture({ fixture, fixtureStageTasks, activitiesByTaskId }) {
  const taskIds = collectTaskIdsForFixture(fixture, fixtureStageTasks);
  return taskIds.flatMap((taskId) => (
    getMapEntries(activitiesByTaskId, taskId).map((activity) => ({
      ...activity,
      task_id: Number(taskId),
      fixture_id: fixture.fixture_id,
      fixture_no: fixture.fixture_no,
    }))
  ));
}

function buildFixtureRows({
  fixtures,
  progressLookup,
  attemptLookup,
  stageTaskLookup,
  projectTruth,
  activitiesByTaskId,
  attachmentsByTaskId,
  generatedAt,
}) {
  const fixtureTruthById = new Map(
    (projectTruth?.fixtures || []).map((truth) => [String(truth.fixture_id), truth]),
  );

  return fixtures.map((fixture) => {
    const fixtureKey = String(fixture.fixture_id);
    const progressByStage = progressLookup.get(fixtureKey) || new Map();
    const attemptByStage = attemptLookup.get(fixtureKey) || new Map();
    const fixtureStageTasks = stageTaskLookup.get(fixtureKey) || new Map();
    const fixtureTruth = fixtureTruthById.get(fixtureKey) || null;
    const current = getCurrentStage(progressByStage);
    const fixtureStatus = resolveFixtureGlobalStatus(fixtureTruth, fixture);
    const currentProgress = current.row;
    const currentAttempts = attemptByStage.get(current.stage.key) || [];
    const startDate = getProgressStart(currentProgress, currentAttempts)
      || fixture.task_started_at
      || fixture.task_assigned_at
      || fixture.task_created_at;
    const completionDate = fixture.task_closed_at
      || fixture.task_completed_at
      || dateMax(REPORT_STAGES.map((stage) => (
        getProgressActualEnd(progressByStage.get(stage.key), attemptByStage.get(stage.key) || [])
      )));
    const dueDate = fixture.task_deadline || fixture.task_due_date || fixture.task_sla_due_date;
    const actualMinutes = Number(fixture.task_actual_minutes || 0)
      || REPORT_STAGES.reduce((sum, stage) => (
        sum + getStageDurationMinutes(progressByStage.get(stage.key), attemptByStage.get(stage.key) || [])
      ), 0);
    const plannedMinutes = Number(fixture.task_planned_minutes || 0);
    const overdueDays = fixtureStatus === STATUS_LABELS.OVERDUE
      ? Math.max(0, daysBetween(dueDate, generatedAt) || 0)
      : 0;
    const activities = collectActivitiesForFixture({
      fixture,
      fixtureStageTasks,
      activitiesByTaskId,
    });
    const latestActivity = activities
      .sort((left, right) => (parseDate(right.created_at)?.getTime() || 0) - (parseDate(left.created_at)?.getTime() || 0))[0];
    const proofRecords = collectProofRecords({ fixture, fixtureStageTasks, attachmentsByTaskId });

    return {
      fixture_id: fixture.fixture_id,
      fixtureNumber: fixture.fixture_no || "",
      fixtureName: fixture.part_name || "",
      currentStage: fixtureStatus === STATUS_LABELS.CLOSED ? "Released" : stageDisplayName(current.stage.key, current.row?.stage_name),
      currentStatus: fixtureStatus,
      assignedTo: formatEmployeeDisplay(currentProgress?.assigned_to || fixture.task_assigned_to, currentProgress?.assigned_to_name || fixture.task_assignee_name),
      assignedBy: formatEmployeeDisplay(fixture.task_assigned_by, fixture.task_assigned_by_name),
      startDate: formatDate(startDate),
      dueDate: formatDate(dueDate),
      completionDate: formatDate(completionDate),
      actualHours: formatHours(actualMinutes),
      plannedHours: formatHours(plannedMinutes),
      variance: plannedMinutes || actualMinutes ? formatHours(actualMinutes - plannedMinutes) : "",
      overdueDays,
      latestActivity: latestActivity ? `${formatDateTime(latestActivity.created_at)} - ${humanizeAction(latestActivity.action_type)}` : "",
      proofRecords,
      raw: {
        fixture,
        progressByStage,
        attemptByStage,
        fixtureStageTasks,
        fixtureTruth,
        activities,
        startDate,
        dueDate,
        completionDate,
        actualMinutes,
        plannedMinutes,
      },
    };
  });
}

function buildKpis({ fixtureRows, projectTruth, context }) {
  const totalFixtures = fixtureRows.length;
  const countStatus = (status) => fixtureRows.filter((row) => row.currentStatus === status).length;
  const completedFixtures = countStatus(STATUS_LABELS.CLOSED);
  const inProgressFixtures = countStatus(STATUS_LABELS.IN_PROGRESS);
  const onHoldFixtures = countStatus(STATUS_LABELS.ON_HOLD);
  const overdueFixtures = countStatus(STATUS_LABELS.OVERDUE);
  const reworkCount = countStatus(STATUS_LABELS.REWORK);
  const reviewCount = countStatus(STATUS_LABELS.REVIEW);
  const averageMinutes = fixtureRows.length
    ? fixtureRows.reduce((sum, row) => sum + Number(row.raw.actualMinutes || 0), 0) / fixtureRows.length
    : 0;
  const truthCompletionPercent = context.status === "released" || projectTruth?.strict_complete
    ? 100
    : clampPercent(projectTruth?.completion_percent);
  const hasCompletionTruth = truthCompletionPercent !== null;
  const completionPercent = hasCompletionTruth ? truthCompletionPercent : 0;

  return {
    totalFixtures,
    completedFixtures,
    inProgressFixtures,
    onHoldFixtures,
    overdueFixtures,
    releasedFixtures: completedFixtures,
    reworkCount,
    reviewCount,
    completionPercent,
    completionDisplay: hasCompletionTruth ? `${completionPercent}%` : "Not available",
    completionTruthErrors: Array.isArray(projectTruth?.truth_errors) ? projectTruth.truth_errors : [],
    averageCompletionTime: formatDuration(averageMinutes),
  };
}

function resolveOverallStatus(kpis) {
  if (kpis.overdueFixtures > 0) {
    return STATUS_LABELS.OVERDUE;
  }

  if (kpis.onHoldFixtures > 0) {
    return STATUS_LABELS.ON_HOLD;
  }

  if (kpis.reworkCount > 0) {
    return STATUS_LABELS.REWORK;
  }

  if (kpis.reviewCount > 0) {
    return STATUS_LABELS.REVIEW;
  }

  if (kpis.completedFixtures === kpis.totalFixtures && kpis.totalFixtures > 0) {
    return STATUS_LABELS.CLOSED;
  }

  if (kpis.inProgressFixtures > 0) {
    return STATUS_LABELS.IN_PROGRESS;
  }

  return STATUS_LABELS.ASSIGNED;
}

function buildProjectOverview({ context, fixtureRows, kpis, generatedAt, generatedBy }) {
  const startDate = dateMin([
    context.created_at,
    ...fixtureRows.map((row) => row.raw.startDate),
  ]);
  const expectedCompletionDate = dateMax(fixtureRows.map((row) => row.raw.dueDate));
  const actualCompletionDate = context.completed_at
    || (kpis.completedFixtures === kpis.totalFixtures ? dateMax(fixtureRows.map((row) => row.raw.completionDate)) : null);
  const openStages = new Map();
  fixtureRows.forEach((row) => {
    if (row.currentStatus !== STATUS_LABELS.CLOSED) {
      openStages.set(row.currentStage, (openStages.get(row.currentStage) || 0) + 1);
    }
  });
  const currentStage = fixtureRows.length
    ? ([...openStages.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] || "Released")
    : "Not Started";

  return [
    { label: "Project Number", value: context.project_no || "" },
    { label: "Project Name", value: context.project_name || "" },
    { label: "Customer", value: context.customer_name || "" },
    { label: "Project Type", value: context.project_type || "Design" },
    { label: "Department", value: context.department_name || context.department_id || "" },
    { label: "Project Uploader", value: formatEmployeeDisplay(context.created_by_user_id || context.uploaded_by, context.created_by_name || context.uploaded_by_name) },
    { label: "Project Leader", value: formatEmployeeDisplay(context.project_leader_id, context.project_leader_name) },
    { label: "Current Stage", value: currentStage },
    { label: "Current Status", value: resolveOverallStatus(kpis) },
    { label: "Completion Percentage", value: kpis.completionDisplay },
    { label: "Project Start Date", value: formatDate(startDate) },
    { label: "Expected Completion Date", value: formatDate(expectedCompletionDate) },
    { label: "Actual Completion Date", value: formatDate(actualCompletionDate) },
    { label: "Generated Date", value: formatDateTime(generatedAt) },
    { label: "Generated By", value: formatEmployeeDisplay(generatedBy.employee_id, generatedBy.name) },
  ];
}

function buildWorkflowTimeline({ fixtureRows, context }) {
  const rows = [];

  REPORT_STAGES.forEach((stage) => {
    const starts = [];
    const ends = [];
    const assignees = new Map();
    let duration = 0;

    fixtureRows.forEach((fixtureRow) => {
      const progress = fixtureRow.raw.progressByStage.get(stage.key);
      const attempts = fixtureRow.raw.attemptByStage.get(stage.key) || [];
      starts.push(getProgressStart(progress, attempts));
      ends.push(getProgressActualEnd(progress, attempts));
      duration += getStageDurationMinutes(progress, attempts);
      const assignee = formatEmployeeDisplay(progress?.assigned_to, progress?.assigned_to_name);
      if (assignee) {
        assignees.set(assignee, (assignees.get(assignee) || 0) + 1);
      }
    });

    const responsible = [...assignees.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] || "";
    const stageName = stageDisplayName(stage.key);
    const started = dateMin(starts);
    const closed = dateMax(ends);

    rows.push({
      event: `${stageName} Started`,
      date: formatDate(started),
      time: formatTime(started),
      responsibleUser: responsible,
      duration: "",
    });
    rows.push({
      event: `${stageName} Closed`,
      date: formatDate(closed),
      time: formatTime(closed),
      responsibleUser: responsible,
      duration: formatDuration(duration),
    });
  });

  const released = context.completed_at || dateMax(fixtureRows.map((row) => row.raw.completionDate));
  rows.push({
    event: "Released",
    date: formatDate(released),
    time: formatTime(released),
    responsibleUser: formatEmployeeDisplay(context.project_leader_id, context.project_leader_name),
    duration: "",
  });

  return rows;
}

function buildStageHealthMatrix(fixtureRows) {
  return REPORT_STAGES.map((stage) => {
    const row = {
      stage: stageDisplayName(stage.key),
    };
    MATRIX_STATUS_LABELS.forEach((status) => {
      row[status] = 0;
    });

    fixtureRows.forEach((fixtureRow) => {
      const progress = fixtureRow.raw.progressByStage.get(stage.key);
      const current = getCurrentStage(fixtureRow.raw.progressByStage);
      const matrixStatus = progressStatusToMatrixStatus(
        progress,
        fixtureRow.currentStatus,
        current.stage.key === stage.key,
      );
      row[matrixStatus] += 1;
    });

    return row;
  });
}

function buildProgressVisualization({ fixtureRows, kpis }) {
  const rows = [{
    area: "Project Overall",
    percent: kpis.completionPercent,
  }];

  REPORT_STAGES.forEach((stage) => {
    const closed = fixtureRows.filter((row) => (
      normalizeProgressStatus(row.raw.progressByStage.get(stage.key)?.status) === "APPROVED"
    )).length;
    const percent = fixtureRows.length ? Math.round((closed / fixtureRows.length) * 100) : 0;
    rows.push({
      area: stageDisplayName(stage.key),
      percent,
    });
  });

  return rows.map((row) => ({
    ...row,
    bar: buildProgressBar(row.percent),
  }));
}

function buildProgressBar(percent) {
  const clamped = Math.max(0, Math.min(100, Number(percent) || 0));
  const filled = Math.round(clamped / 5);
  return `${"#".repeat(filled)}${"-".repeat(20 - filled)} ${clamped}%`;
}

function buildProofAnalytics(fixtureRows) {
  return fixtureRows.map((row) => {
    const first = row.proofRecords[0] || null;
    const latest = row.proofRecords[row.proofRecords.length - 1] || null;
    return {
      fixtureNumber: row.fixtureNumber,
      fixtureName: row.fixtureName,
      proofCount: row.proofRecords.length,
      latestUploadDate: formatDateTime(latest?.uploadedAt),
      latestUploadedBy: latest?.uploadedBy || "",
      firstUploadDate: formatDateTime(first?.uploadedAt),
      proofAvailability: row.proofRecords.length ? "Available" : "Missing",
    };
  });
}

function buildReworkAnalytics({ revisions = [], attemptRows = [] }) {
  const counts = {
    Concept: 0,
    DAP: 0,
    "3D": 0,
    "2D": 0,
  };
  const rejectedDurations = new Map();

  attemptRows.forEach((attempt) => {
    if (normalizeProgressStatus(attempt.status) !== "REJECTED") {
      return;
    }
    const stageKey = getStageBucket(attempt.stage_name);
    const key = `${attempt.fixture_id}::${stageKey}`;
    rejectedDurations.set(key, (rejectedDurations.get(key) || 0) + getAttemptDurationMinutes(attempt));
  });

  const rows = revisions.map((revision) => {
    const stageKey = getStageBucket(revision.stage_name);
    const stage = stageDisplayName(stageKey, revision.stage_name);
    if (counts[stage] !== undefined) {
      counts[stage] += 1;
    }
    const reason = getDesignRevisionReasonLabel(revision.reason_type || revision.revision_type)
      || revision.revision_reason
      || revision.revision_remarks
      || "";
    return {
      fixtureId: revision.fixture_id,
      stage,
      reworkReason: reason,
      initiatedBy: formatEmployeeDisplay(revision.requested_by || revision.changed_by, revision.requested_by_name || revision.changed_by_name),
      date: formatDateTime(revision.changed_at),
      durationImpact: formatDuration(rejectedDurations.get(`${revision.fixture_id}::${stageKey}`) || 0),
      revision: revision.revision_code || "",
      comments: revision.revision_remarks || revision.revision_reason || "",
    };
  });

  return {
    counts: {
      conceptReworks: counts.Concept,
      dapReworks: counts.DAP,
      threeDReworks: counts["3D"],
      twoDReworks: counts["2D"],
      totalReworks: rows.length,
    },
    rows,
  };
}

function isHoldActivity(activity) {
  const metadata = activity.metadata && typeof activity.metadata === "object" ? activity.metadata : {};
  const action = normalizeText(activity.action_type).toLowerCase();
  return action.includes("hold")
    || normalizeText(metadata.to).toLowerCase() === "on_hold"
    || normalizeText(metadata.from).toLowerCase() === "on_hold";
}

function buildHoldHistory(fixtureRows) {
  const rows = [];

  fixtureRows.forEach((fixtureRow) => {
    const activities = fixtureRow.raw.activities
      .filter(isHoldActivity)
      .sort((left, right) => (parseDate(left.created_at)?.getTime() || 0) - (parseDate(right.created_at)?.getTime() || 0));
    const pendingByStage = new Map();

    activities.forEach((activity) => {
      const metadata = activity.metadata && typeof activity.metadata === "object" ? activity.metadata : {};
      const stage = stageDisplayName(getStageBucket(metadata.stage || metadata.stage_name), metadata.stage || metadata.stage_name || fixtureRow.currentStage);
      const stateTo = normalizeText(metadata.to).toLowerCase();
      const stateFrom = normalizeText(metadata.from).toLowerCase();
      const actor = formatEmployeeDisplay(activity.user_employee_id, activity.user_name);
      const key = `${activity.task_id || fixtureRow.fixture_id}::${stage}`;

      if (stateTo === "on_hold" || (!stateFrom && normalizeText(activity.action_type).toLowerCase().includes("hold"))) {
        pendingByStage.set(key, {
          date: activity.created_at,
          stage,
          reason: activity.notes || metadataValue(metadata, ["reason", "remarks", "comment"]),
          heldBy: actor,
          comments: activity.notes || "",
        });
        return;
      }

      if (stateFrom === "on_hold") {
        const pending = pendingByStage.get(key) || {
          date: null,
          stage,
          reason: "",
          heldBy: "",
          comments: "",
        };
        rows.push({
          fixtureNumber: fixtureRow.fixtureNumber,
          date: formatDateTime(pending.date),
          stage,
          reason: pending.reason,
          heldBy: pending.heldBy,
          releasedBy: actor,
          holdDuration: formatDuration(minutesBetween(pending.date, activity.created_at)),
          comments: [pending.comments, activity.notes].filter(Boolean).join(" | "),
        });
        pendingByStage.delete(key);
      }
    });

    pendingByStage.forEach((pending) => {
      rows.push({
        fixtureNumber: fixtureRow.fixtureNumber,
        date: formatDateTime(pending.date),
        stage: pending.stage,
        reason: pending.reason,
        heldBy: pending.heldBy,
        releasedBy: "",
        holdDuration: "",
        comments: pending.comments,
      });
    });
  });

  return rows;
}

function buildAssignmentHistory(fixtureRows) {
  const rows = [];
  const addRow = (row) => {
    rows.push({
      fixtureNumber: row.fixtureNumber || "",
      assignedBy: row.assignedBy || "",
      assignedTo: row.assignedTo || "",
      assignmentDate: row.assignmentDate || "",
      reassignmentDate: row.reassignmentDate || "",
      stage: row.stage || "",
      revision: row.revision || "",
      comments: row.comments || "",
    });
  };

  fixtureRows.forEach((fixtureRow) => {
    const current = getCurrentStage(fixtureRow.raw.progressByStage);
    const revisionForStage = (stageKey) => {
      const progress = fixtureRow.raw.progressByStage.get(stageKey);
      return progress
        ? formatStageRevisionCode(progress.stage_name, normalizeStageVersion(progress.stage_version))
        : "";
    };

    if (fixtureRow.raw.fixture.task_id || fixtureRow.assignedTo) {
      addRow({
        fixtureNumber: fixtureRow.fixtureNumber,
        assignedBy: fixtureRow.assignedBy,
        assignedTo: fixtureRow.assignedTo,
        assignmentDate: formatDateTime(fixtureRow.raw.fixture.task_assigned_at || fixtureRow.raw.fixture.task_created_at),
        stage: fixtureRow.currentStage,
        revision: current.row
          ? formatStageRevisionCode(current.row.stage_name, normalizeStageVersion(current.row.stage_version))
          : "",
        comments: "Current task assignment",
      });
    }

    fixtureRow.raw.fixtureStageTasks.forEach((stageTasks, stageKey) => {
      stageTasks.forEach((task) => {
        addRow({
          fixtureNumber: fixtureRow.fixtureNumber,
          assignedBy: formatEmployeeDisplay(task.assigned_by, task.assigned_by_name),
          assignedTo: formatEmployeeDisplay(task.assigned_to, task.assignee_names || task.assigned_to_name),
          assignmentDate: formatDateTime(task.assigned_at || task.created_at),
          stage: stageDisplayName(stageKey, task.stage_name),
          revision: revisionForStage(stageKey),
          comments: "Stage task assignment",
        });
      });
    });

    fixtureRow.raw.activities
      .filter((activity) => normalizeText(activity.action_type).toLowerCase().includes("assign"))
      .forEach((activity) => {
        const metadata = activity.metadata && typeof activity.metadata === "object" ? activity.metadata : {};
        addRow({
          fixtureNumber: fixtureRow.fixtureNumber,
          assignedBy: formatEmployeeDisplay(activity.user_employee_id, activity.user_name),
          assignedTo: metadataValue(metadata, ["assigned_to", "to", "assignee", "to_user"]) || "",
          reassignmentDate: formatDateTime(activity.created_at),
          stage: stageDisplayName(getStageBucket(metadata.stage || metadata.stage_name), metadata.stage || metadata.stage_name || fixtureRow.currentStage),
          revision: metadataValue(metadata, ["revision", "revision_code", "stage_revision_code"]) || "",
          comments: activity.notes || describeActivity(activity),
        });
      });
  });

  return rows.sort((left, right) => {
    const leftDate = parseDate(left.reassignmentDate || left.assignmentDate)?.getTime() || 0;
    const rightDate = parseDate(right.reassignmentDate || right.assignmentDate)?.getTime() || 0;
    return leftDate - rightDate;
  });
}

function buildActivityLog(fixtureRows, revisions = []) {
  const rows = [];

  fixtureRows.forEach((fixtureRow) => {
    fixtureRow.raw.activities.forEach((activity) => {
      rows.push({
        timestamp: formatDateTime(activity.created_at),
        sortDate: parseDate(activity.created_at),
        fixtureNumber: fixtureRow.fixtureNumber,
        user: formatEmployeeDisplay(activity.user_employee_id, activity.user_name),
        action: humanizeAction(activity.action_type),
        description: describeActivity(activity),
      });
    });

    fixtureRow.proofRecords.forEach((proof) => {
      rows.push({
        timestamp: formatDateTime(proof.uploadedAt),
        sortDate: parseDate(proof.uploadedAt),
        fixtureNumber: fixtureRow.fixtureNumber,
        user: proof.uploadedBy,
        action: "Proof Upload",
        description: proof.url,
      });
    });
  });

  revisions.forEach((revision) => {
    rows.push({
      timestamp: formatDateTime(revision.changed_at),
      sortDate: parseDate(revision.changed_at),
      fixtureNumber: "",
      user: formatEmployeeDisplay(revision.changed_by, revision.changed_by_name),
      action: "Rework / Revision",
      description: [
        stageDisplayName(getStageBucket(revision.stage_name), revision.stage_name),
        revision.revision_code,
        getDesignRevisionReasonLabel(revision.reason_type || revision.revision_type),
        revision.revision_remarks || revision.revision_reason,
      ].filter(Boolean).join(" - "),
    });
  });

  return rows
    .sort((left, right) => (left.sortDate?.getTime() || 0) - (right.sortDate?.getTime() || 0))
    .map(({ sortDate, ...row }) => row);
}

function buildProjectHealthSummary({ fixtureRows, kpis, reworkAnalytics, holdHistory }) {
  const expected = dateMax(fixtureRows.map((row) => row.raw.dueDate));
  const actualOrNow = dateMax(fixtureRows.map((row) => row.raw.completionDate)) || new Date();
  const scheduleDays = expected ? daysBetween(expected, actualOrNow) : null;
  const reworkRate = kpis.totalFixtures ? reworkAnalytics.counts.totalReworks / kpis.totalFixtures : 0;
  const activeHolds = holdHistory.filter((row) => !row.releasedBy).length;
  const riskLevel = kpis.overdueFixtures > 0 || reworkRate >= 0.25
    ? "Red"
    : (kpis.onHoldFixtures > 0 || reworkRate > 0 || activeHolds > 0 ? "Yellow" : "Green");
  const hasCompletionTruth = kpis.completionDisplay !== "Not available";
  const completionTruthNote = [
    ...(Array.isArray(kpis.completionTruthErrors) ? kpis.completionTruthErrors : []),
  ].find(Boolean) || "Completion truth missing from live workflow tables";

  return [
    { indicator: "Overall Status", value: resolveOverallStatus(kpis), level: riskLevel, notes: `${kpis.completedFixtures}/${kpis.totalFixtures} fixtures closed` },
    { indicator: "Project Risk Level", value: riskLevel, level: riskLevel, notes: kpis.overdueFixtures ? `${kpis.overdueFixtures} overdue fixture(s)` : "No overdue fixtures in current report data" },
    { indicator: "Schedule Variance", value: scheduleDays === null ? "No due date" : `${scheduleDays > 0 ? "+" : ""}${scheduleDays} day(s)`, level: scheduleDays && scheduleDays > 0 ? "Red" : "Green", notes: expected ? `Expected ${formatDate(expected)}` : "No expected completion date available" },
    { indicator: "Completion Trend", value: hasCompletionTruth ? (kpis.completionPercent >= 75 ? "Strong" : kpis.completionPercent >= 40 ? "Moderate" : "Early / Low") : "Not available", level: hasCompletionTruth && kpis.completionPercent >= 75 ? "Green" : "Yellow", notes: hasCompletionTruth ? `${kpis.completionDisplay} complete` : completionTruthNote },
    { indicator: "Rework Severity", value: reworkAnalytics.counts.totalReworks ? `${reworkAnalytics.counts.totalReworks} event(s)` : "None", level: reworkRate >= 0.25 ? "Red" : reworkRate > 0 ? "Yellow" : "Green", notes: `Rate ${(reworkRate * 100).toFixed(1)}%` },
    { indicator: "Hold Impact", value: holdHistory.length ? `${holdHistory.length} hold event(s)` : "None", level: activeHolds ? "Yellow" : "Green", notes: activeHolds ? `${activeHolds} active hold(s)` : "No active hold detected" },
  ];
}

function buildDesignManagementReportModel({
  context,
  fixtures,
  reportData,
  generatedAt = new Date(),
  generatedBy = {},
}) {
  const progressLookup = buildProgressLookup(reportData.progressRows || []);
  const attemptLookup = buildAttemptLookup(reportData.attemptRows || []);
  const stageTaskLookup = buildStageTaskLookup(reportData.stageTasks || []);
  const fixtureRows = buildFixtureRows({
    fixtures,
    progressLookup,
    attemptLookup,
    stageTaskLookup,
    projectTruth: reportData.projectTruth,
    activitiesByTaskId: reportData.activitiesByTaskId,
    attachmentsByTaskId: reportData.attachmentsByTaskId,
    generatedAt,
  });
  const integrityWarnings = Array.isArray(reportData.integrityWarnings)
    ? reportData.integrityWarnings
    : [];
  const kpis = buildKpis({ fixtureRows, projectTruth: reportData.projectTruth, context });
  const reworkAnalytics = buildReworkAnalytics({
    revisions: reportData.revisions || [],
    attemptRows: reportData.attemptRows || [],
  });
  const holdHistory = buildHoldHistory(fixtureRows);
  const model = {
    reportVersion: REPORT_VERSION,
    generatedAt,
    generatedBy: formatEmployeeDisplay(generatedBy.employee_id, generatedBy.name),
    context,
    statusColors: STATUS_COLORS,
    auxiliaryColors: AUXILIARY_COLORS,
    matrixStatusLabels: MATRIX_STATUS_LABELS,
    overview: [],
    kpis,
    workflowTimeline: buildWorkflowTimeline({ fixtureRows, context }),
    stageHealthMatrix: buildStageHealthMatrix(fixtureRows),
    progressVisualization: buildProgressVisualization({ fixtureRows, kpis }),
    fixtureBreakdown: fixtureRows.map(({ raw, proofRecords, ...row }) => row),
    fixtureStageDetails: buildFixtureStageDetails(fixtureRows, reportData.revisions || []),
    fixtureStageExecutionAudit: buildFixtureStageExecutionAudit({
      fixtureRows,
      contributions: reportData.contributions || [],
      revisions: reportData.revisions || [],
    }),
    proofAnalytics: buildProofAnalytics(fixtureRows),
    workProofHistory: buildWorkProofHistory(fixtureRows),
    reworkAnalytics,
    holdHistory,
    assignmentHistory: buildAssignmentHistory(fixtureRows),
    activityLog: buildActivityLog(fixtureRows, reportData.revisions || []),
    healthSummary: [],
    databaseQuerySummary: [
      "Report availability: generated as a current-state snapshot; incomplete stages, missing proofs, and open workflow items are reported as-is.",
      "design.projects / design.fixtures with visibility predicates for project context and fixture list",
      "fixture_workflow_progress for current stage, stage status, and timeline truth",
      "fixture_workflow_stage_attempts for stage durations and rework attempt history",
      "design.fixture_stage_contributions for contributor execution truth",
      "task_activity_logs reassignment_contribution metadata for future reassignment contribution capture when exact task completion percent is recorded",
      "fixture_workflow_revisions for controlled rework and revision history",
      "tasks, task_attachments, and task_activity_logs for assignments, proof analytics, holds, and activity log",
      "design completion truth and stage completion weights for KPI accuracy",
      ...(integrityWarnings.length
        ? [
          `Snapshot data warnings captured: ${integrityWarnings.length}`,
          ...integrityWarnings.slice(0, 25).map((warning) => `Snapshot warning: ${warning}`),
        ]
        : ["Snapshot data warnings captured: 0"]),
    ],
  };

  model.overview = buildProjectOverview({
    context,
    fixtureRows,
    kpis,
    generatedAt,
    generatedBy,
  });
  model.healthSummary = buildProjectHealthSummary({
    fixtureRows,
    kpis,
    reworkAnalytics,
    holdHistory,
  });

  return model;
}

module.exports = {
  AUXILIARY_COLORS,
  MATRIX_STATUS_LABELS,
  REPORT_VERSION,
  STATUS_COLORS,
  buildDesignManagementReportModel,
  buildProgressBar,
  formatDate,
  formatDateTime,
  formatDuration,
  formatEmployeeDisplay,
  statusColor,
};
