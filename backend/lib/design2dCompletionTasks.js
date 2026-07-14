const DESIGN_2D_COMPLETION_TASKS = Object.freeze({
  FIXTURE_DRAFTING_CHECKING: Object.freeze({ displayName: "Drafting Checking", scope: "fixture", required: true }),
  FIXTURE_DRAWING_CORRECTION: Object.freeze({ displayName: "Drawing Correction", scope: "fixture", required: true }),
  FIXTURE_AUTOCAD_PDF: Object.freeze({ displayName: "AutoCAD PDF", scope: "fixture", required: true }),
  FIXTURE_IGES: Object.freeze({ displayName: "IGES", scope: "fixture", required: true }),
  PROJECT_CMM_DATA: Object.freeze({ displayName: "CMM Data", scope: "project", required: true }),
  PROJECT_LINE_LAYOUT: Object.freeze({ displayName: "Line Layout", scope: "project", required: true }),
  PROJECT_MIMIC: Object.freeze({ displayName: "Mimic", scope: "project", required: false }),
  PROJECT_WEAR_OUT_DATA: Object.freeze({ displayName: "Wear-Out Data", scope: "project", required: true }),
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

function isActiveCompletionTask(task) {
  return task && !["closed", "cancelled"].includes(task.status);
}

function taskScopeKey(task) {
  return task?.scope_type === "fixture"
    ? `${task.fixture_id || ""}:${task.completion_task_code || ""}`
    : `project:${task?.completion_task_code || ""}`;
}

function latestTasksByScope(tasks = []) {
  const latest = new Map();
  for (const task of tasks) {
    const key = taskScopeKey(task);
    const current = latest.get(key);
    if (!current || Number(task.completion_task_revision) > Number(current.completion_task_revision)) {
      latest.set(key, task);
    }
  }
  return latest;
}

function buildDesign2DCompletionState({ fixtures = [], tasks = [] } = {}) {
  const eligibleFixtures = fixtures.filter((fixture) => fixture.two_d_complete === true);
  const latest = latestTasksByScope(tasks);
  const missingRequirements = [];
  const allFixtures2DComplete = fixtures.length > 0 && eligibleFixtures.length === fixtures.length;
  const allOriginalWorkflowsComplete = fixtures.length > 0
    && fixtures.every((fixture) => fixture.workflow_complete === true);
  let fixtureRequirementsComplete = allFixtures2DComplete;

  if (!allFixtures2DComplete) {
    missingRequirements.push("Every fixture must complete its original 2D workflow stage");
  }
  if (!allOriginalWorkflowsComplete) {
    missingRequirements.push("Every original fixture workflow must be completed");
  }

  for (const fixture of eligibleFixtures) {
    for (const code of FIXTURE_TASK_CODES) {
      const task = latest.get(`${fixture.fixture_id}:${code}`);
      if (!isApprovedCompletionTask(task)) {
        fixtureRequirementsComplete = false;
        missingRequirements.push(`${fixture.fixture_no}: ${DESIGN_2D_COMPLETION_TASKS[code].displayName}`);
      }
    }
  }

  const projectTasksUnlocked = fixtureRequirementsComplete;

  for (const code of PROJECT_TASK_CODES) {
    const task = latest.get(`project:${code}`);
    const definition = DESIGN_2D_COMPLETION_TASKS[code];
    const mimicNotRequired = code === "PROJECT_MIMIC"
      && Boolean(task?.completion_task_not_required_at)
      && isApprovedCompletionTask(task);
    if (!isApprovedCompletionTask(task) && !(definition.required === false && mimicNotRequired)) {
      missingRequirements.push(definition.displayName);
    }
  }

  return {
    eligibleFixtures,
    latestTasks: latest,
    allFixtures2DComplete,
    allOriginalWorkflowsComplete,
    fixtureRequirementsComplete,
    projectTasksUnlocked,
    projectCompletionReady: projectTasksUnlocked && allOriginalWorkflowsComplete && missingRequirements.length === 0,
    missingRequirements,
  };
}

module.exports = {
  DESIGN_2D_COMPLETION_TASKS,
  FIXTURE_TASK_CODES,
  PROJECT_TASK_CODES,
  buildDesign2DCompletionState,
  formatDesign2DCompletionTaskName,
  getDesign2DCompletionTaskDefinition,
  isActiveCompletionTask,
  isApprovedCompletionTask,
  latestTasksByScope,
};
