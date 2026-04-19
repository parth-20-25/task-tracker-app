const { TASK_STATUSES, VERIFICATION_STATUSES } = require("../config/constants");
const { listTasksByAccess } = require("../repositories/tasksRepository");
const { getTaskAccess } = require("./accessControlService");

function isOverdue(task) {
  return task.deadline && new Date(task.deadline) < new Date() && task.status !== TASK_STATUSES.CLOSED;
}

function average(values) {
  if (values.length === 0) {
    return 0;
  }

  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

async function getAnalyticsForUser(user) {
  const tasks = await listTasksByAccess(getTaskAccess(user));
  const closedTasks = tasks.filter((task) => task.status === TASK_STATUSES.CLOSED);
  const reviewedTasks = tasks.filter((task) => [VERIFICATION_STATUSES.APPROVED, VERIFICATION_STATUSES.REJECTED].includes(task.verification_status));
  const reworkTasks = tasks.filter((task) => task.status === TASK_STATUSES.REWORK || task.verification_status === VERIFICATION_STATUSES.REJECTED);
  const overdueTasks = tasks.filter(isOverdue);
  const plannedValues = tasks.map((task) => task.planned_minutes || 0).filter(Boolean);
  const actualValues = tasks.map((task) => task.actual_minutes || 0).filter(Boolean);

  const departmentMap = new Map();
  const machineMap = new Map();

  for (const task of tasks) {
    const departmentName = task.assignee?.department?.name || task.department_id || "Unassigned";
    const department = departmentMap.get(departmentName) || {
      department: departmentName,
      total: 0,
      closed: 0,
      overdue: 0,
      rework: 0,
    };

    department.total += 1;
    department.closed += task.status === TASK_STATUSES.CLOSED ? 1 : 0;
    department.overdue += isOverdue(task) ? 1 : 0;
    department.rework += task.status === TASK_STATUSES.REWORK ? 1 : 0;
    departmentMap.set(departmentName, department);

    if (task.machine_name || task.machine_id) {
      const key = task.machine_name || task.machine_id;
      const machine = machineMap.get(key) || {
        machine: key,
        tasks: 0,
        downtime_minutes: 0,
      };

      machine.tasks += 1;
      machine.downtime_minutes += task.status === TASK_STATUSES.ON_HOLD ? task.actual_minutes || task.planned_minutes || 0 : 0;
      machineMap.set(key, machine);
    }
  }

  return {
    summary: {
      total: tasks.length,
      assigned: tasks.filter((task) => task.status === TASK_STATUSES.ASSIGNED).length,
      in_progress: tasks.filter((task) => task.status === TASK_STATUSES.IN_PROGRESS).length,
      under_review: tasks.filter((task) => task.status === TASK_STATUSES.UNDER_REVIEW).length,
      rework: reworkTasks.length,
      closed: closedTasks.length,
      overdue: overdueTasks.length,
      on_time_closure_rate: closedTasks.length === 0
        ? 0
        : Math.round((closedTasks.filter((task) => new Date(task.closed_at || task.verified_at || task.updated_at || task.created_at) <= new Date(task.deadline)).length / closedTasks.length) * 100),
      rework_rate: reviewedTasks.length === 0 ? 0 : Math.round((reworkTasks.length / reviewedTasks.length) * 100),
      average_planned_minutes: average(plannedValues),
      average_actual_minutes: average(actualValues),
    },
    department_performance: [...departmentMap.values()],
    downtime: [...machineMap.values()],
    overdue_tasks: overdueTasks,
  };
}

module.exports = {
  getAnalyticsForUser,
};
