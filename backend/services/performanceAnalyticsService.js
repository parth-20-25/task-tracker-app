const { pool } = require("../db");
const { PERMISSIONS } = require("../config/constants");
const { AppError } = require("../lib/AppError");
const { listDepartments } = require("../repositories/departmentsRepository");
const { findUserByEmployeeId } = require("../repositories/usersRepository");
const {
  findUserPerformance,
  getPerformanceAnalyticsState,
  getPerformanceOverview: getPerformanceOverviewSnapshot,
  getUserDrilldownFacts,
  listDepartmentPerformance,
  listUserPerformance,
  refreshPerformanceAnalytics,
} = require("../repositories/performanceAnalyticsRepository");
const { hasPermission, isAdmin } = require("./accessControlService");

const DEFAULT_MINIMUM_APPROVED_TASKS = Number(process.env.PERFORMANCE_MIN_APPROVED_TASKS || 5);
const DEFAULT_OVERDUE_PENALTY_FACTOR = Number(process.env.DEPARTMENT_OVERDUE_PENALTY_FACTOR || 1);
const DEFAULT_REFRESH_INTERVAL_MS = Number(process.env.PERFORMANCE_ANALYTICS_REFRESH_MS || 15 * 60 * 1000);

function roundNumber(value, decimals = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return null;
  }

  const factor = 10 ** decimals;
  return Math.round(Number(value) * factor) / factor;
}

function ensureAnyAnalyticsAccess(user) {
  const allowed = isAdmin(user) || [
    PERMISSIONS.VIEW_SELF_USER_ANALYTICS,
    PERMISSIONS.VIEW_SELF_DEPARTMENT_ANALYTICS,
    PERMISSIONS.VIEW_DEPARTMENT_COMPARISON,
    PERMISSIONS.VIEW_USER_COMPARISON,
  ].some((permissionId) => hasPermission(user, permissionId));

  if (!allowed) {
    throw new AppError(403, "Analytics access is not configured for this user");
  }
}

function getScopeContext(user) {
  ensureAnyAnalyticsAccess(user);

  const hasAllDepartmentsScope = isAdmin(user) || hasPermission(user, PERMISSIONS.ANALYTICS_SCOPE_ALL_DEPARTMENTS);
  const hasDepartmentScope = hasPermission(user, PERMISSIONS.ANALYTICS_SCOPE_DEPARTMENT_ONLY) || Boolean(user?.department_id);

  if (!hasAllDepartmentsScope && !hasDepartmentScope) {
    throw new AppError(403, "A department analytics scope is required");
  }

  if (!hasAllDepartmentsScope && !user?.department_id) {
    throw new AppError(403, "A department is required for department-scoped analytics");
  }

  return {
    scope: hasAllDepartmentsScope ? "all_departments" : "department_only",
    department_id: user?.department_id || null,
  };
}

async function refreshAnalyticsInTransaction(options = {}, existingClient = null) {
  const client = existingClient || await pool.connect();

  try {
    const shouldManageTransaction = !existingClient;
    if (shouldManageTransaction) {
      await client.query("BEGIN");
    }

    await refreshPerformanceAnalytics({
      departmentId: options.departmentId || null,
      minimumApprovedTasks: DEFAULT_MINIMUM_APPROVED_TASKS,
      overduePenaltyFactor: DEFAULT_OVERDUE_PENALTY_FACTOR,
    }, client);

    if (shouldManageTransaction) {
      await client.query("COMMIT");
    }
  } catch (error) {
    if (!existingClient) {
      await client.query("ROLLBACK");
    }
    throw error;
  } finally {
    if (!existingClient) {
      client.release();
    }
  }
}

async function ensurePerformanceAnalyticsFresh(scopeKey = "global") {
  const state = await getPerformanceAnalyticsState(scopeKey);

  if (!state?.last_refreshed_at) {
    await refreshAnalyticsInTransaction({
      departmentId: scopeKey === "global" ? null : scopeKey,
    });
    return;
  }

  const refreshedAt = new Date(state.last_refreshed_at).getTime();
  if (Number.isNaN(refreshedAt) || (Date.now() - refreshedAt) > DEFAULT_REFRESH_INTERVAL_MS) {
    await refreshAnalyticsInTransaction({
      departmentId: scopeKey === "global" ? null : scopeKey,
    });
  }
}

function ensureDepartmentAllowed(scopeContext, requestedDepartmentId) {
  if (!requestedDepartmentId) {
    return scopeContext.department_id || null;
  }

  if (scopeContext.scope === "department_only" && requestedDepartmentId !== scopeContext.department_id) {
    throw new AppError(403, "You do not have access to another department");
  }

  return requestedDepartmentId;
}

async function getVisibleDepartments(scopeContext) {
  const departments = await listDepartments();
  if (scopeContext.scope === "department_only") {
    return departments.filter((department) => department.id === scopeContext.department_id);
  }

  return departments;
}

async function resolveUserForDrilldown(scopeContext, viewer, requestedUserId) {
  const targetId = String(requestedUserId || "").trim();
  if (!targetId) {
    throw new AppError(400, "user id is required");
  }

  const targetUser = await findUserByEmployeeId(targetId);
  if (!targetUser) {
    throw new AppError(404, "User not found");
  }

  if (scopeContext.scope === "department_only" && targetUser.department_id !== scopeContext.department_id) {
    throw new AppError(403, "You do not have access to another department user");
  }

  const isSelf = targetUser.employee_id === viewer.employee_id;
  const canViewOtherUsers = isAdmin(viewer) || hasPermission(viewer, PERMISSIONS.VIEW_USER_COMPARISON);
  const canViewSelf = isAdmin(viewer) || hasPermission(viewer, PERMISSIONS.VIEW_SELF_USER_ANALYTICS) || canViewOtherUsers;

  if ((isSelf && !canViewSelf) || (!isSelf && !canViewOtherUsers)) {
    throw new AppError(403, "You do not have access to this user performance");
  }

  return targetUser;
}

function buildTimeline(tasks) {
  return tasks.map((task) => ({
    task_id: task.task_id,
    title: task.title,
    approved_at: task.approved_at,
    due_date: task.due_date,
    outcome: task.due_date
      ? (task.is_overdue ? "overdue" : "on_time")
      : "no_due_date",
    delay_hours: task.delay_hours,
  }));
}

function buildReworkHistory(tasks) {
  return tasks
    .filter((task) => task.rejection_count > 0)
    .map((task) => ({
      task_id: task.task_id,
      title: task.title,
      rejection_count: task.rejection_count,
      approved_at: task.approved_at,
      remarks: task.remarks,
      project_name: task.project_name,
      scope_name: task.scope_name,
    }));
}

function buildDelayPatterns(tasks) {
  const weekdayCounts = new Map();
  const priorityCounts = new Map();

  for (const task of tasks) {
    if (!task.is_overdue || !task.approved_at) {
      continue;
    }

    const weekdayLabel = new Date(task.approved_at).toLocaleDateString("en-US", { weekday: "short" });
    weekdayCounts.set(weekdayLabel, (weekdayCounts.get(weekdayLabel) || 0) + 1);

    const priorityLabel = String(task.priority || "unknown").toUpperCase();
    priorityCounts.set(priorityLabel, (priorityCounts.get(priorityLabel) || 0) + 1);
  }

  return {
    overdue_tasks: tasks.filter((task) => task.is_overdue).length,
    on_time_tasks: tasks.filter((task) => task.is_on_time).length,
    tasks_without_due_date: tasks.filter((task) => !task.due_date).length,
    by_weekday: Array.from(weekdayCounts.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label)),
    by_priority: Array.from(priorityCounts.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label)),
  };
}

function buildDrilldownSummary(tasks, performance) {
  const completedTasks = tasks.filter((task) => typeof task.completion_minutes === "number");
  const overdueTasks = tasks.filter((task) => typeof task.delay_hours === "number");
  const averageCompletionMinutes = completedTasks.length > 0
    ? roundNumber(
      completedTasks.reduce((sum, task) => sum + Number(task.completion_minutes || 0), 0) / completedTasks.length,
    )
    : null;
  const averageDelayHours = overdueTasks.length > 0
    ? roundNumber(
      overdueTasks.reduce((sum, task) => sum + Number(task.delay_hours || 0), 0) / overdueTasks.length,
    )
    : null;

  return {
    approved_tasks: performance?.approved_tasks || 0,
    on_time_count: performance?.on_time_count || 0,
    overdue_count: performance?.overdue_count || 0,
    rework_count: performance?.rework_count || 0,
    score: performance?.score ?? null,
    rank: performance?.rank ?? null,
    average_completion_minutes: averageCompletionMinutes,
    average_delay_hours: averageDelayHours,
    tasks_without_due_date: tasks.filter((task) => !task.due_date).length,
  };
}

async function getPerformanceAnalyticsContext(user) {
  const scopeContext = getScopeContext(user);
  await ensurePerformanceAnalyticsFresh(scopeContext.scope === "department_only" ? scopeContext.department_id : "global");
  const departments = await getVisibleDepartments(scopeContext);

  return {
    scope: scopeContext.scope,
    default_department_id: scopeContext.department_id || departments[0]?.id || null,
    minimum_approved_tasks: DEFAULT_MINIMUM_APPROVED_TASKS,
    department_penalty_factor: DEFAULT_OVERDUE_PENALTY_FACTOR,
    user: {
      employee_id: user.employee_id,
      name: user.name,
      department_id: user.department_id || null,
      department_name: user.department?.name || null,
    },
    permissions: {
      view_self_user: isAdmin(user) || hasPermission(user, PERMISSIONS.VIEW_SELF_USER_ANALYTICS) || hasPermission(user, PERMISSIONS.VIEW_USER_COMPARISON),
      view_self_department: isAdmin(user) || hasPermission(user, PERMISSIONS.VIEW_SELF_DEPARTMENT_ANALYTICS) || hasPermission(user, PERMISSIONS.VIEW_DEPARTMENT_COMPARISON),
      view_department_comparison: isAdmin(user) || hasPermission(user, PERMISSIONS.VIEW_DEPARTMENT_COMPARISON),
      view_user_comparison: isAdmin(user) || hasPermission(user, PERMISSIONS.VIEW_USER_COMPARISON),
    },
    departments: departments.map((department) => ({
      id: department.id,
      name: department.name,
    })),
  };
}

async function getPerformanceOverview(user, query = {}) {
  const scopeContext = getScopeContext(user);
  const requestedDepartmentId = String(query.department_id || "").trim() || null;
  const selectedDepartmentId = ensureDepartmentAllowed(scopeContext, requestedDepartmentId);
  await ensurePerformanceAnalyticsFresh(selectedDepartmentId || "global");

  const departments = await getVisibleDepartments(scopeContext);
  const selectedDepartment = selectedDepartmentId
    ? departments.find((department) => department.id === selectedDepartmentId) || null
    : null;
  const overview = await getPerformanceOverviewSnapshot(selectedDepartmentId);

  return {
    ...overview,
    selected_department_id: selectedDepartmentId,
    selected_department_name: selectedDepartment?.name || null,
  };
}

async function getUserPerformanceRankings(user, query = {}) {
  const scopeContext = getScopeContext(user);
  const canViewRankings = isAdmin(user) || hasPermission(user, PERMISSIONS.VIEW_USER_COMPARISON);

  if (!canViewRankings) {
    throw new AppError(403, "User performance rankings require comparison access");
  }

  const visibleDepartments = await getVisibleDepartments(scopeContext);
  const fallbackDepartmentId = scopeContext.department_id || visibleDepartments[0]?.id || null;
  const requestedDepartmentId = String(query.department_id || "").trim() || fallbackDepartmentId;
  const selectedDepartmentId = ensureDepartmentAllowed(scopeContext, requestedDepartmentId);

  if (!selectedDepartmentId) {
    throw new AppError(400, "department_id is required");
  }

  await ensurePerformanceAnalyticsFresh(selectedDepartmentId);

  const department = visibleDepartments.find((item) => item.id === selectedDepartmentId) || null;
  const items = await listUserPerformance(selectedDepartmentId);

  return {
    department_id: selectedDepartmentId,
    department_name: department?.name || selectedDepartmentId,
    minimum_approved_tasks: DEFAULT_MINIMUM_APPROVED_TASKS,
    items,
    last_updated: items[0]?.last_updated || null,
  };
}

async function getDepartmentPerformanceRankings(user, query = {}) {
  const scopeContext = getScopeContext(user);
  const visibleDepartments = await getVisibleDepartments(scopeContext);
  const canCompareDepartments = isAdmin(user) || hasPermission(user, PERMISSIONS.VIEW_DEPARTMENT_COMPARISON);
  const canViewOwnDepartment = isAdmin(user)
    || hasPermission(user, PERMISSIONS.VIEW_SELF_DEPARTMENT_ANALYTICS)
    || canCompareDepartments;

  if (!canViewOwnDepartment) {
    throw new AppError(403, "Department performance access is not configured");
  }

  const requestedDepartmentId = String(query.department_id || "").trim() || null;
  const selectedDepartmentId = canCompareDepartments
    ? ensureDepartmentAllowed(scopeContext, requestedDepartmentId)
    : scopeContext.department_id;

  await ensurePerformanceAnalyticsFresh(selectedDepartmentId || "global");

  const items = await listDepartmentPerformance(selectedDepartmentId || null);

  const filteredItems = canCompareDepartments
    ? items
    : items.filter((item) => item.department_id === scopeContext.department_id);

  return {
    items: filteredItems,
    last_updated: filteredItems[0]?.last_updated || null,
    departments: visibleDepartments.map((department) => ({
      id: department.id,
      name: department.name,
    })),
  };
}

async function getUserPerformanceDrilldown(user, userId) {
  const scopeContext = getScopeContext(user);
  const targetUser = await resolveUserForDrilldown(scopeContext, user, userId);
  await ensurePerformanceAnalyticsFresh(targetUser.department_id || "global");

  const performance = await findUserPerformance(targetUser.employee_id);
  const tasks = await getUserDrilldownFacts(targetUser.employee_id);

  return {
    user: {
      employee_id: targetUser.employee_id,
      name: targetUser.name,
      department_id: targetUser.department_id || null,
      department_name: targetUser.department?.name || null,
      is_active: targetUser.is_active !== false,
    },
    performance,
    summary: buildDrilldownSummary(tasks, performance),
    tasks,
    approval_timeline: buildTimeline(tasks),
    rework_history: buildReworkHistory(tasks),
    delay_patterns: buildDelayPatterns(tasks),
  };
}

async function refreshPerformanceAnalyticsForDepartment(departmentId = null) {
  try {
    await refreshAnalyticsInTransaction({ departmentId });
  } catch (error) {
    console.error("Performance analytics refresh failed", {
      departmentId,
      error: error?.message || "Unknown performance analytics refresh error",
    });
  }
}

async function refreshPerformanceAnalyticsAtStartup(client = null) {
  await refreshAnalyticsInTransaction({}, client);
}

module.exports = {
  DEFAULT_MINIMUM_APPROVED_TASKS,
  DEFAULT_OVERDUE_PENALTY_FACTOR,
  DEFAULT_REFRESH_INTERVAL_MS,
  getPerformanceAnalyticsContext,
  getDepartmentPerformanceRankings,
  getPerformanceOverview,
  getUserPerformanceDrilldown,
  getUserPerformanceRankings,
  refreshPerformanceAnalyticsAtStartup,
  refreshPerformanceAnalyticsForDepartment,
};
