function activity(displayName, scope, isMandatory) {
  return Object.freeze({ displayName, scope, isMandatory, required: isMandatory });
}

const DESIGN_2D_COMPLETION_TASKS = Object.freeze({
  FIXTURE_DRAFTING_CHECKING: activity("Drafting Checking", "fixture", true),
  FIXTURE_DRAWING_CORRECTION: activity("Drawing Correction", "fixture", true),
  FIXTURE_AUTOCAD_PDF: activity("AutoCAD PDF", "fixture", true),
  FIXTURE_IGES: activity("IGES", "fixture", true),
  PROJECT_CMM_DATA: activity("CMM Data", "project", true),
  PROJECT_LINE_LAYOUT: activity("Line Layout", "project", true),
  PROJECT_WEAR_OUT_DATA: activity("Wear-Out Data", "project", true),
  PROJECT_MIMIC: activity("Mimic", "project", false),
});

const FIXTURE_TASK_CODES = Object.freeze(
  Object.keys(DESIGN_2D_COMPLETION_TASKS).filter((code) => DESIGN_2D_COMPLETION_TASKS[code].scope === "fixture"),
);
const PROJECT_TASK_CODES = Object.freeze(
  Object.keys(DESIGN_2D_COMPLETION_TASKS).filter((code) => DESIGN_2D_COMPLETION_TASKS[code].scope === "project"),
);

function getDesign2DCompletionTaskDefinition(code) {
  return DESIGN_2D_COMPLETION_TASKS[String(code || "").trim().toUpperCase()] || null;
}

function formatDesign2DCompletionTaskName(code, revision) {
  const definition = getDesign2DCompletionTaskDefinition(code);
  if (!definition || !Number.isInteger(revision) || revision < 0 || revision > 99) {
    return null;
  }
  return `${definition.displayName} ${String(revision).padStart(2, "0")}`;
}

function isApprovedCompletionTask(task) {
  return task?.status === "closed" && task?.verification_status === "approved";
}

function isNotRequiredCompletionTask(task) {
  return Boolean(task?.completion_task_not_required_at);
}

function isSatisfiedCompletionTask(task) {
  return isApprovedCompletionTask(task) || isNotRequiredCompletionTask(task);
}

function isActiveCompletionTask(task) {
  return task && !["closed", "cancelled"].includes(task.status);
}

function isCancelledCompletionTask(task) {
  return task?.status === "cancelled";
}

function taskScopeKey(task) {
  return task?.scope_type === "fixture"
    ? `${task.fixture_id || ""}:${task.completion_task_code || ""}`
    : `project:${task?.completion_task_code || ""}`;
}

function latestTasksByScope(tasks = [], { includeCancelled = false } = {}) {
  const latest = new Map();
  for (const task of tasks) {
    if (!includeCancelled && isCancelledCompletionTask(task)) {
      continue;
    }
    const key = taskScopeKey(task);
    const current = latest.get(key);
    if (!current || Number(task.completion_task_revision) > Number(current.completion_task_revision)) {
      latest.set(key, task);
    }
  }
  return latest;
}

function mandatoryCodesForScope(scope) {
  return Object.keys(DESIGN_2D_COMPLETION_TASKS)
    .filter((code) => DESIGN_2D_COMPLETION_TASKS[code].scope === scope)
    .filter((code) => DESIGN_2D_COMPLETION_TASKS[code].isMandatory === true);
}

function latestTaskFor(latest, scope, fixtureId, code) {
  return latest.get(scope === "fixture" ? `${fixtureId || ""}:${code}` : `project:${code}`) || null;
}

function currentStatusForTask(task) {
  if (!task) return "UNASSIGNED";
  if (isSatisfiedCompletionTask(task)) return "COMPLETED";
  if (task.status === "rework" || task.verification_status === "rejected") return "REJECTED";
  if (task.status === "under_review") return "VERIFICATION";
  if (task.completion_task_outsource_supplier && isActiveCompletionTask(task)) return "OUTSOURCED";
  if (task.status === "in_progress" || task.status === "on_hold") return "IN_PROGRESS";
  if (task.status === "assigned" || task.status === "created") return "ASSIGNED";
  return String(task.status || "UNASSIGNED").trim().toUpperCase();
}

function isOutsourcedActiveTask(task) {
  return isActiveCompletionTask(task) && Boolean(task.completion_task_outsource_supplier);
}

function aggregateCompletionState(latest, { scope, fixtureId = null } = {}) {
  const mandatoryTasks = mandatoryCodesForScope(scope).map((code) => latestTaskFor(latest, scope, fixtureId, code));

  if (mandatoryTasks.length > 0 && mandatoryTasks.every((task) => isSatisfiedCompletionTask(task))) {
    return "WORKFLOW_COMPLETE";
  }
  if (mandatoryTasks.some((task) => task?.status === "rework" || task?.verification_status === "rejected")) {
    return "REJECTED";
  }
  if (mandatoryTasks.some((task) => task?.status === "under_review")) {
    return "VERIFICATION";
  }
  if (mandatoryTasks.some((task) => task && !isOutsourcedActiveTask(task) && ["in_progress", "on_hold"].includes(task.status))) {
    return "IN_PROGRESS";
  }
  if (mandatoryTasks.some((task) => task && !isOutsourcedActiveTask(task) && (task.status === "assigned" || task.status === "created"))) {
    return "ASSIGNED";
  }
  if (mandatoryTasks.some(isOutsourcedActiveTask)) {
    return "OUTSOURCED";
  }
  return "UNASSIGNED";
}

function displaySequence(task) {
  return task?.completion_task_revision === null || task?.completion_task_revision === undefined
    ? null
    : String(Number(task.completion_task_revision)).padStart(2, "0");
}

function completionActivityFor(latest, { scope, fixtureId = null, code }) {
  const definition = DESIGN_2D_COMPLETION_TASKS[code];
  const latestTask = latestTaskFor(latest, scope, fixtureId, code);
  const sequence = displaySequence(latestTask);
  const label = sequence ? `${definition.displayName} ${sequence}` : definition.displayName;
  const currentStatus = currentStatusForTask(latestTask);

  return {
    activityKey: code,
    code,
    label: definition.displayName,
    latestLabel: label,
    latestTask,
    currentStatus,
    assignable: !latestTask || isSatisfiedCompletionTask(latestTask),
  };
}

function buildCompletionAggregate(latest, { scope, fixtureId = null } = {}) {
  const mandatoryCodes = mandatoryCodesForScope(scope);
  const currentActivities = mandatoryCodes.map((code) => completionActivityFor(latest, { scope, fixtureId, code }));
  const completedMandatoryCount = currentActivities.filter((activityItem) => isSatisfiedCompletionTask(activityItem.latestTask)).length;
  const totalMandatoryCount = mandatoryCodes.length;
  const activeAssignments = currentActivities
    .filter((activityItem) => isActiveCompletionTask(activityItem.latestTask))
    .map((activityItem) => ({
      taskId: activityItem.latestTask.id,
      activityKey: activityItem.activityKey,
      label: activityItem.latestLabel,
      sequence: activityItem.latestTask.completion_task_revision,
      displaySequence: displaySequence(activityItem.latestTask),
      status: activityItem.latestTask.status,
      currentStatus: activityItem.currentStatus,
      assignedTo: activityItem.latestTask.assigned_to || null,
      assigneeNames: activityItem.latestTask.assignee_names || null,
      supplierName: activityItem.latestTask.completion_task_outsource_supplier || null,
    }));

  return {
    fixtureId,
    aggregateSection: aggregateCompletionState(latest, { scope, fixtureId }),
    completedMandatoryCount,
    totalMandatoryCount,
    progressPercentage: totalMandatoryCount ? Math.round((completedMandatoryCount / totalMandatoryCount) * 100) : 0,
    currentActivities,
    activities: currentActivities,
    activeAssignments,
    currentAssignee: activeAssignments.length ? activeAssignments[0].assignedTo : null,
  };
}

function buildFixtureCompletionAggregate(latest, fixture) {
  return buildCompletionAggregate(latest, { scope: "fixture", fixtureId: fixture?.fixture_id || null });
}

function incompleteMandatoryMessages(latest, { scope, fixture = null, projectLabel = "Project" } = {}) {
  return mandatoryCodesForScope(scope).flatMap((code) => {
    const definition = DESIGN_2D_COMPLETION_TASKS[code];
    const task = latestTaskFor(latest, scope, fixture?.fixture_id || null, code);
    if (isSatisfiedCompletionTask(task)) return [];
    const label = task?.title || formatDesign2DCompletionTaskName(code, Number(task?.completion_task_revision || 0)) || definition.displayName;
    const owner = scope === "fixture" ? fixture?.fixture_no || fixture?.fixture_id || "Fixture" : projectLabel;
    return [`${owner}: ${label} is incomplete`];
  });
}

function buildDesign2DCompletionState({ fixtures = [], tasks = [] } = {}) {
  const eligibleFixtures = fixtures.filter((fixture) => fixture.two_d_complete === true);
  const latest = latestTasksByScope(tasks);
  const allFixtures2DComplete = fixtures.length > 0 && eligibleFixtures.length === fixtures.length;
  const allOriginalWorkflowsComplete = fixtures.length > 0
    && fixtures.every((fixture) => fixture.workflow_complete === true);
  const fixtureMissingRequirements = eligibleFixtures.flatMap((fixture) => (
    incompleteMandatoryMessages(latest, { scope: "fixture", fixture })
  ));
  const projectMissingRequirements = incompleteMandatoryMessages(latest, { scope: "project" });
  const missingRequirements = [];

  if (!allOriginalWorkflowsComplete) {
    missingRequirements.push("Every original fixture workflow must be completed");
  }

  missingRequirements.push(...fixtureMissingRequirements, ...projectMissingRequirements);
  const fixtureRequirementsComplete = fixtureMissingRequirements.length === 0;
  const projectRequirementsComplete = projectMissingRequirements.length === 0;

  return {
    eligibleFixtures,
    latestTasks: latest,
    allFixtures2DComplete,
    allOriginalWorkflowsComplete,
    fixtureRequirementsComplete,
    projectRequirementsComplete,
    projectTasksUnlocked: allOriginalWorkflowsComplete && fixtureRequirementsComplete,
    projectCompletionReady: allOriginalWorkflowsComplete && fixtureRequirementsComplete && projectRequirementsComplete,
    missingRequirements,
  };
}

module.exports = {
  DESIGN_2D_COMPLETION_TASKS,
  FIXTURE_TASK_CODES,
  PROJECT_TASK_CODES,
  aggregateCompletionState,
  buildCompletionAggregate,
  buildDesign2DCompletionState,
  buildFixtureCompletionAggregate,
  formatDesign2DCompletionTaskName,
  getDesign2DCompletionTaskDefinition,
  isActiveCompletionTask,
  isApprovedCompletionTask,
  isSatisfiedCompletionTask,
  latestTasksByScope,
};
