const { isTaskOverdue } = require("./overdueNotificationService");
const {
  ACTIVE_TEAM_TASK_STATUSES,
  listTeamActivityRows,
} = require("../repositories/teamActivityRepository");

const ACTIVE_STATUS_SET = new Set(ACTIVE_TEAM_TASK_STATUSES);

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function isActiveTeamTask(task) {
  return Boolean(
    task?.task_id
    && ACTIVE_STATUS_SET.has(normalize(task.status))
    && !["completed", "cancelled", "archived"].includes(normalize(task.lifecycle_status))
    && normalize(task.verification_status) !== "approved",
  );
}

function taskName(task) {
  return task.resolved_stage_name
    || task.title
    || task.internal_identifier
    || task.description
    || `Task #${task.task_id}`;
}

function formatCurrentTask(task) {
  const project = task.resolved_project_no || task.project_no || "No project";

  if (task.task_type === "additional_design") {
    return `${project}\n${taskName(task)}`;
  }

  const fixture = task.resolved_fixture_no || task.resolved_fixture_name || task.fixture_no || task.quantity_index;
  return `${fixture ? `${project} · ${fixture}` : project}\n${taskName(task)}`;
}

function taskSummary(task, employeeName) {
  const proofUrls = Array.isArray(task.proof_url)
    ? task.proof_url.filter(Boolean)
    : task.proof_url ? [task.proof_url] : [];
  const project = task.resolved_project_no || task.project_no || "—";
  const fixture = task.resolved_fixture_no || task.resolved_fixture_name || task.fixture_no || task.quantity_index;

  return {
    task_id: String(task.task_id),
    project_no: project,
    task_or_fixture: fixture || task.title || task.internal_identifier || task.description || "—",
    stage: task.resolved_stage_name || task.stage || "—",
    status: task.status || "—",
    assignee: employeeName,
    proof_urls: proofUrls,
  };
}
function buildTeamActivity(rows, now = new Date()) {
  const employees = new Map();

  for (const row of rows) {
    if (!employees.has(row.employee_id)) {
      employees.set(row.employee_id, {
        employee_id: row.employee_id,
        employee_name: row.employee_name,
        tasks: new Map(),
      });
    }

    if (isActiveTeamTask(row)) {
      employees.get(row.employee_id).tasks.set(String(row.task_id), row);
    }
  }

  return [...employees.values()].map((employee) => {
    const tasks = [...employee.tasks.values()];
    const running = tasks.filter((task) => normalize(task.status) === "in_progress");
    const selected = running.find((task) => task.current_task_id && String(task.current_task_id) === String(task.task_id));
    const hasOverdueTask = tasks.some((task) => isTaskOverdue({ ...task, assigned_to: employee.employee_id }, now));
    const selectionRequired = running.length > 1;
    const status = selectionRequired
      ? "Task Selection Required"
      : hasOverdueTask
        ? "Overdue"
        : selected
          ? "Working"
          : tasks.length > 0
            ? "Not Started"
            : "Available";

    return {
      employee_id: employee.employee_id,
      employee_name: employee.employee_name,
      current_task: selectionRequired
        ? "Task selection required"
        : selected
          ? formatCurrentTask(selected)
          : tasks.length > 0
            ? "No current task"
            : "No assigned tasks",
      total_active_tasks: tasks.length,
      status,
      tasks: tasks.map((task) => taskSummary(task, employee.employee_name)),
    };
  });
}

async function listTeamActivity(user, options = {}) {
  const repository = options.repository || { listTeamActivityRows };
  const rows = await repository.listTeamActivityRows(user.employee_id, options.client);
  return buildTeamActivity(rows, options.now);
}

module.exports = {
  buildTeamActivity,
  formatCurrentTask,
  isActiveTeamTask,
  listTeamActivity,
  taskSummary,
};
