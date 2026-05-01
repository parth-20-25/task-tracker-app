const { PERMISSIONS } = require("../config/constants");
const { pool } = require("../db");
const { AppError } = require("../lib/AppError");
const { getVisibleUserIds, hasPermission, isAdmin } = require("./accessControlService");

const CREDIBILITY_TOLERANCE_MINUTES = 120;
const LATE_BOUNDARY_MINUTES = 120;
const SEVERE_BOUNDARY_MINUTES = 1440;
const WORKFLOW_HEALTH_STD_DEV_CAP_MINUTES = 10080;

function normalizeId(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function toDate(value) {
  if (!value) {
    return null;
  }

  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function startOfUtcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function endOfUtcDay(date) {
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    23,
    59,
    59,
    999,
  ));
}

function parseDateFilter(value, isEnd) {
  const normalized = normalizeId(value);
  if (!normalized) {
    return null;
  }

  const dayOnlyMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const parsed = dayOnlyMatch
    ? new Date(`${normalized}T00:00:00.000Z`)
    : new Date(normalized);

  if (Number.isNaN(parsed.getTime())) {
    throw new AppError(400, `Invalid date filter "${normalized}"`);
  }

  return isEnd ? endOfUtcDay(parsed) : startOfUtcDay(parsed);
}

function roundNumber(value, decimals = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return null;
  }

  const factor = 10 ** decimals;
  return Math.round(Number(value) * factor) / factor;
}

function clamp(value, minimum = 0, maximum = 1) {
  return Math.max(minimum, Math.min(maximum, value));
}

function percentage(numerator, denominator, decimals = 2) {
  if (!denominator) {
    return 0;
  }

  return roundNumber((numerator / denominator) * 100, decimals) || 0;
}

function ratio(numerator, denominator, decimals = 4) {
  if (!denominator) {
    return 0;
  }

  return roundNumber(numerator / denominator, decimals) || 0;
}

function minutesBetween(startValue, endValue) {
  const start = toDate(startValue);
  const end = toDate(endValue);

  if (!start || !end || end < start) {
    return null;
  }

  return Math.round((end.getTime() - start.getTime()) / 60000);
}

function average(values) {
  if (!values.length) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values) {
  if (values.length <= 1) {
    return 0;
  }

  const mean = average(values);
  const variance = average(values.map((value) => (value - mean) ** 2));
  return Math.sqrt(variance);
}

function computeMedian(values) {
  if (!values.length) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid];
  }

  return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function getTaskStartAt(task) {
  return toDate(task.assigned_at)
    || toDate(task.started_at)
    || toDate(task.created_at);
}

function getTaskCompletionAt(task) {
  return toDate(task.approved_at)
    || toDate(task.closed_at)
    || toDate(task.completed_at);
}

function getTaskDeadlineAt(task) {
  const candidates = [
    toDate(task.sla_due_date),
    toDate(task.due_date),
    toDate(task.deadline),
  ].filter(Boolean);

  if (!candidates.length) {
    return null;
  }

  return candidates.sort((left, right) => left.getTime() - right.getTime())[0];
}

function getTaskExpectedMinutes(task) {
  if (Number(task.planned_minutes) > 0) {
    return Number(task.planned_minutes);
  }

  const startAt = getTaskStartAt(task);
  const deadlineAt = getTaskDeadlineAt(task);
  const derived = minutesBetween(startAt, deadlineAt);
  return derived && derived > 0 ? derived : null;
}

function getTaskActualMinutes(task) {
  if (Number(task.actual_minutes) > 0) {
    return Number(task.actual_minutes);
  }

  const derived = minutesBetween(getTaskStartAt(task), getTaskCompletionAt(task));
  return derived && derived > 0 ? derived : null;
}

function isDateInRange(date, startDate, endDate) {
  if (!date) {
    return false;
  }

  if (startDate && date < startDate) {
    return false;
  }

  if (endDate && date > endDate) {
    return false;
  }

  return true;
}

function classifyErrorBucket(errorMinutes) {
  if (errorMinutes <= -CREDIBILITY_TOLERANCE_MINUTES) {
    return "early";
  }

  if (errorMinutes <= LATE_BOUNDARY_MINUTES) {
    return "on_target";
  }

  if (errorMinutes <= SEVERE_BOUNDARY_MINUTES) {
    return "late";
  }

  return "severe";
}

function buildScope(filters = {}, user) {
  const canViewAllDepartments = isAdmin(user)
    || hasPermission(user, PERMISSIONS.VIEW_ALL_DEPARTMENTS_ANALYTICS);
  const canViewDepartment = canViewAllDepartments
    || hasPermission(user, PERMISSIONS.VIEW_DEPARTMENT_ANALYTICS)
    || Boolean(user?.department_id);
  const canViewSelf = isAdmin(user)
    || hasPermission(user, PERMISSIONS.VIEW_SELF_ANALYTICS)
    || canViewDepartment
    || hasPermission(user, PERMISSIONS.VIEW_ALL_USERS_ANALYTICS);

  if (!canViewSelf && !canViewDepartment) {
    throw new AppError(403, "Analytics access is not configured for this user");
  }

  const requestedDepartmentId = normalizeId(filters.departmentId);
  const visibleUserIds = isAdmin(user)
    ? null
    : [...new Set((getVisibleUserIds(user) || []).filter(Boolean))];

  let departmentId = requestedDepartmentId;
  if (!canViewAllDepartments) {
    if (!user?.department_id) {
      throw new AppError(403, "A department scope is required for analytics");
    }

    if (requestedDepartmentId && requestedDepartmentId !== user.department_id) {
      throw new AppError(403, "You do not have access to another department");
    }

    departmentId = user.department_id;
  }

  let userId = normalizeId(filters.userId);
  if (userId === "self") {
    userId = user.employee_id;
  }

  if (!canViewDepartment && !userId) {
    userId = user.employee_id;
  }

  if (userId) {
    if (!isAdmin(user) && visibleUserIds && !visibleUserIds.includes(userId)) {
      throw new AppError(403, "You do not have access to this user's analytics");
    }

    if (userId === user.employee_id && !canViewSelf) {
      throw new AppError(403, "You do not have access to your own analytics");
    }
  }

  const startDate = parseDateFilter(filters.startDate, false);
  const endDate = parseDateFilter(filters.endDate, true);
  if (startDate && endDate && startDate > endDate) {
    throw new AppError(400, "startDate must be before or equal to endDate");
  }

  return {
    departmentId,
    userId,
    projectId: normalizeId(filters.projectId),
    scopeId: normalizeId(filters.scopeId),
    startDate,
    endDate,
    visibleUserIds,
    isOverall: !departmentId,
  };
}

async function loadTaskRows(scope, client = pool) {
  const params = [];
  const whereClauses = [
    "t.status <> 'cancelled'",
    "COALESCE(t.task_type, 'department_workflow') = 'department_workflow'",
  ];

  if (scope.departmentId) {
    params.push(scope.departmentId);
    whereClauses.push(`t.department_id = $${params.length}`);
  }

  if (scope.userId) {
    params.push(scope.userId);
    whereClauses.push(`COALESCE(NULLIF(t.assigned_user_id, ''), t.assigned_to) = $${params.length}`);
  } else if (scope.visibleUserIds) {
    params.push(scope.visibleUserIds);
    whereClauses.push(`COALESCE(NULLIF(t.assigned_user_id, ''), t.assigned_to) = ANY($${params.length}::text[])`);
  }

  if (scope.projectId) {
    params.push(scope.projectId);
    whereClauses.push(`t.project_id = $${params.length}::uuid`);
  }

  if (scope.scopeId) {
    params.push(scope.scopeId);
    whereClauses.push(`t.scope_id = $${params.length}::uuid`);
  }

  const result = await client.query(
    `
      SELECT
        t.id,
        t.department_id,
        COALESCE(department.name, t.department_id, 'Unknown Department') AS department_name,
        COALESCE(NULLIF(t.assigned_user_id, ''), t.assigned_to) AS user_id,
        COALESCE(user_account.name, NULLIF(t.assigned_user_id, ''), t.assigned_to, 'Unassigned') AS user_name,
        t.status,
        t.verification_status,
        t.workflow_id,
        t.current_stage_id,
        COALESCE(NULLIF(current_stage.stage_name, ''), NULLIF(current_stage.name, ''), NULLIF(t.stage, ''), 'Workflow Stage') AS current_stage_name,
        t.stage AS explicit_stage_name,
        t.project_id,
        t.scope_id,
        t.fixture_id,
        t.project_no,
        t.scope_name,
        t.fixture_no,
        t.quantity_index,
        t.instance_count,
        t.internal_identifier,
        t.title,
        t.created_at,
        t.updated_at,
        t.assigned_at,
        t.started_at,
        t.submitted_at,
        t.completed_at,
        t.closed_at,
        t.approved_at,
        t.deadline,
        t.due_date,
        t.sla_due_date,
        t.actual_minutes,
        t.planned_minutes,
        COALESCE(t.rejection_count, 0) AS rejection_count
      FROM tasks t
      LEFT JOIN departments department
        ON department.id = t.department_id
      LEFT JOIN users user_account
        ON user_account.employee_id = COALESCE(NULLIF(t.assigned_user_id, ''), t.assigned_to)
      LEFT JOIN workflow_stages current_stage
        ON current_stage.id = t.current_stage_id
      WHERE ${whereClauses.join(" AND ")}
      ORDER BY COALESCE(t.approved_at, t.closed_at, t.completed_at, t.assigned_at, t.created_at) ASC, t.id ASC
    `,
    params,
  );

  return result.rows;
}

async function loadTaskActivities(taskIds, client = pool) {
  if (!taskIds.length) {
    return [];
  }

  const result = await client.query(
    `
      SELECT
        tal.task_id,
        tal.action_type,
        tal.metadata,
        tal.created_at
      FROM task_activity_logs tal
      WHERE tal.task_id = ANY($1::int[])
        AND tal.action_type IN ('workflow_transitioned', 'task_rework_requested', 'task_quality_rework_requested', 'task_approved', 'task_quality_approved')
      ORDER BY tal.task_id ASC, tal.created_at ASC, tal.id ASC
    `,
    [taskIds],
  );

  return result.rows.map((row) => ({
    task_id: Number(row.task_id),
    action_type: row.action_type,
    metadata: row.metadata && typeof row.metadata === "object" ? row.metadata : {},
    created_at: toDate(row.created_at),
  }));
}

async function loadWorkflowStages(workflowIds, client = pool) {
  if (!workflowIds.length) {
    return [];
  }

  const result = await client.query(
    `
      SELECT
        workflow_id,
        id,
        COALESCE(NULLIF(stage_name, ''), NULLIF(name, ''), id) AS stage_name,
        COALESCE(sequence_order, order_index, 0) AS stage_order,
        is_final
      FROM workflow_stages
      WHERE workflow_id = ANY($1::text[])
        AND COALESCE(is_active, TRUE) = TRUE
      ORDER BY workflow_id ASC, COALESCE(sequence_order, order_index, 0) ASC, created_at ASC, id ASC
    `,
    [workflowIds],
  );

  return result.rows;
}

function buildWorkflowStageMap(stageRows) {
  const map = new Map();

  for (const row of stageRows) {
    const workflowId = String(row.workflow_id);
    if (!map.has(workflowId)) {
      map.set(workflowId, {
        orderedStages: [],
        stageById: new Map(),
      });
    }

    const workflow = map.get(workflowId);
    const stage = {
      id: String(row.id),
      name: row.stage_name,
      order: Number(row.stage_order || 0),
      is_final: row.is_final === true,
    };

    workflow.orderedStages.push(stage);
    workflow.stageById.set(stage.id, stage);
  }

  return map;
}

function buildActivityMap(activityRows) {
  const map = new Map();

  for (const row of activityRows) {
    if (!map.has(row.task_id)) {
      map.set(row.task_id, []);
    }

    map.get(row.task_id).push(row);
  }

  return map;
}

function resolveEntityLabel(task) {
  return String(
    task.fixture_no
    || task.quantity_index
    || task.internal_identifier
    || task.title
    || `Task #${task.id}`,
  ).trim();
}

function resolveDelayCauseStage(segments, deadlineAt) {
  if (!deadlineAt) {
    return null;
  }

  for (const segment of segments) {
    if (segment.reliable && segment.endAt && segment.endAt > deadlineAt) {
      return segment.stageName;
    }
  }

  return null;
}

function buildTaskStageTrace(task, workflowStages, activities) {
  const startAt = getTaskStartAt(task);
  const completionAt = getTaskCompletionAt(task);
  const explicitStageName = normalizeId(task.explicit_stage_name);

  if (explicitStageName) {
    return {
      reliable: Boolean(startAt),
      currentStageName: explicitStageName,
      currentStageOrder: 1,
      totalStages: 1,
      completedStages: completionAt ? 1 : 0,
      currentStageStartedAt: startAt,
      segments: [{
        stageId: explicitStageName,
        stageName: explicitStageName,
        order: 1,
        startAt,
        endAt: completionAt,
        durationMinutes: completionAt ? minutesBetween(startAt, completionAt) : null,
        reliable: Boolean(startAt),
      }],
      stageForReworkAttribution: explicitStageName,
    };
  }

  const workflow = task.workflow_id ? workflowStages.get(String(task.workflow_id)) : null;
  const currentStageId = normalizeId(task.current_stage_id);
  const currentStage = workflow?.stageById.get(currentStageId || "");
  const fallbackStageName = normalizeId(task.current_stage_name) || "Workflow Stage";

  if (!workflow || !currentStageId || !currentStage) {
    return {
      reliable: Boolean(startAt),
      currentStageName: fallbackStageName,
      currentStageOrder: 1,
      totalStages: 1,
      completedStages: completionAt ? 1 : 0,
      currentStageStartedAt: startAt,
      segments: [{
        stageId: currentStageId || fallbackStageName,
        stageName: fallbackStageName,
        order: 1,
        startAt,
        endAt: completionAt,
        durationMinutes: completionAt ? minutesBetween(startAt, completionAt) : null,
        reliable: Boolean(startAt),
      }],
      stageForReworkAttribution: currentStageId ? fallbackStageName : null,
    };
  }

  const transitions = activities
    .filter((activity) => activity.action_type === "workflow_transitioned")
    .map((activity) => ({
      fromStageId: normalizeId(activity.metadata.from_stage_id),
      toStageId: normalizeId(activity.metadata.to_stage_id),
      at: activity.created_at,
    }))
    .filter((transition) => transition.at)
    .sort((left, right) => left.at.getTime() - right.at.getTime());

  const totalStages = workflow.orderedStages.length || 1;
  const currentStageIndex = workflow.orderedStages.findIndex((stage) => stage.id === currentStageId);
  const currentStageOrder = currentStageIndex >= 0 ? currentStageIndex + 1 : 1;
  const hasTransitionHistory = transitions.length > 0;
  const inferredInitialStageId = transitions[0]?.fromStageId || workflow.orderedStages[0]?.id || currentStageId;
  const canInferWithoutHistory = !hasTransitionHistory
    && (totalStages === 1 || inferredInitialStageId === currentStageId);

  if (!startAt || (!hasTransitionHistory && !canInferWithoutHistory)) {
    return {
      reliable: false,
      currentStageName: currentStage.name,
      currentStageOrder,
      totalStages,
      completedStages: completionAt ? totalStages : Math.max(0, currentStageOrder - 1),
      currentStageStartedAt: null,
      segments: [],
      stageForReworkAttribution: null,
    };
  }

  const segments = [];
  let cursorStageId = inferredInitialStageId;
  let segmentStart = startAt;

  for (const transition of transitions) {
    const fromStageId = transition.fromStageId || cursorStageId;
    const fromStage = workflow.stageById.get(fromStageId || "");
    if (fromStage && segmentStart && transition.at >= segmentStart) {
      segments.push({
        stageId: fromStage.id,
        stageName: fromStage.name,
        order: fromStage.order,
        startAt: segmentStart,
        endAt: transition.at,
        durationMinutes: minutesBetween(segmentStart, transition.at),
        reliable: true,
      });
    }

    cursorStageId = transition.toStageId || currentStageId;
    segmentStart = transition.at;
  }

  const finalStage = workflow.stageById.get(cursorStageId || currentStageId) || currentStage;
  segments.push({
    stageId: finalStage.id,
    stageName: finalStage.name,
    order: finalStage.order,
    startAt: segmentStart,
    endAt: completionAt,
    durationMinutes: completionAt ? minutesBetween(segmentStart, completionAt) : null,
    reliable: true,
  });

  return {
    reliable: true,
    currentStageName: currentStage.name,
    currentStageOrder,
    totalStages,
    completedStages: completionAt ? totalStages : Math.max(0, currentStageOrder - 1),
    currentStageStartedAt: segmentStart,
    segments,
    stageForReworkAttribution: hasTransitionHistory ? null : currentStage.name,
  };
}

function buildAnalyticsDataset(taskRows, activityRows, workflowStageRows) {
  const activityMap = buildActivityMap(activityRows);
  const workflowStages = buildWorkflowStageMap(workflowStageRows);

  return taskRows.map((task) => {
    const stageTrace = buildTaskStageTrace(task, workflowStages, activityMap.get(Number(task.id)) || []);
    const startAt = getTaskStartAt(task);
    const completionAt = getTaskCompletionAt(task);
    const deadlineAt = getTaskDeadlineAt(task);
    const actualMinutes = getTaskActualMinutes(task);
    const expectedMinutes = getTaskExpectedMinutes(task);
    const delayMinutes = completionAt && deadlineAt
      ? Math.max(0, minutesBetween(deadlineAt, completionAt) || 0)
      : 0;
    const planningErrorMinutes = completionAt && deadlineAt
      ? minutesBetween(deadlineAt, completionAt)
      : null;

    return {
      taskId: Number(task.id),
      entity_id: String(task.id),
      fixture_no: resolveEntityLabel(task),
      entity_label: resolveEntityLabel(task),
      department_id: task.department_id,
      department_name: task.department_name,
      user_id: task.user_id,
      user_name: task.user_name,
      workflow_id: task.workflow_id || null,
      project_id: task.project_id || null,
      scope_id: task.scope_id || null,
      explicit_stage_name: normalizeId(task.explicit_stage_name),
      current_stage_name: stageTrace.currentStageName,
      current_stage_order: stageTrace.currentStageOrder,
      total_stages: stageTrace.totalStages,
      completed_stages: stageTrace.completedStages,
      current_stage_started_at: stageTrace.currentStageStartedAt,
      status: task.status,
      verification_status: task.verification_status,
      start_at: startAt,
      deadline: deadlineAt,
      final_completed_at: completionAt,
      total_duration: actualMinutes || 0,
      expected_total_minutes: expectedMinutes,
      total_reworks: Number(task.rejection_count || 0),
      is_delayed: Boolean(completionAt && deadlineAt && completionAt > deadlineAt),
      delay_minutes: delayMinutes,
      planning_error_minutes: planningErrorMinutes,
      delay_caused_by_stage: resolveDelayCauseStage(stageTrace.segments, deadlineAt),
      stages: stageTrace.segments.map((segment) => ({
        stage_name: segment.stageName,
        assigned_at: segment.startAt,
        completed_at: segment.endAt,
        duration: segment.durationMinutes || 0,
        attempts: 1,
        reliable: segment.reliable,
      })),
      stage_trace_reliable: stageTrace.reliable,
      rework_stage_name: stageTrace.stageForReworkAttribution,
    };
  });
}

async function loadAnalyticsDataset(filters = {}, user, client = pool) {
  const scope = buildScope(filters, user);
  const taskRows = await loadTaskRows(scope, client);
  const taskIds = taskRows.map((row) => Number(row.id)).filter(Number.isInteger);
  const workflowIds = [...new Set(taskRows.map((row) => normalizeId(row.workflow_id)).filter(Boolean))];
  const [activityRows, workflowStageRows] = await Promise.all([
    loadTaskActivities(taskIds, client),
    loadWorkflowStages(workflowIds, client),
  ]);

  return {
    scope,
    entries: buildAnalyticsDataset(taskRows, activityRows, workflowStageRows),
  };
}

function filterAssignedEntries(entries, scope) {
  if (!scope.startDate && !scope.endDate) {
    return [...entries];
  }

  return entries.filter((entry) => isDateInRange(entry.start_at, scope.startDate, scope.endDate));
}

function filterCompletedEntries(entries, scope) {
  if (!scope.startDate && !scope.endDate) {
    return entries.filter((entry) => Boolean(entry.final_completed_at));
  }

  return entries.filter((entry) => isDateInRange(entry.final_completed_at, scope.startDate, scope.endDate));
}

function filterActiveEntries(entries, scope) {
  return entries.filter((entry) => {
    if (entry.final_completed_at) {
      return false;
    }

    if (!scope.startDate && !scope.endDate) {
      return true;
    }

    return isDateInRange(entry.start_at, scope.startDate, scope.endDate)
      || (entry.start_at && scope.endDate && entry.start_at <= scope.endDate && !scope.startDate);
  });
}

function computeStageAverages(completedEntries) {
  const groups = new Map();

  for (const entry of completedEntries) {
    for (const stage of entry.stages) {
      if (!stage.reliable || !stage.completed_at || Number(stage.duration) <= 0) {
        continue;
      }

      if (!groups.has(stage.stage_name)) {
        groups.set(stage.stage_name, {
          totalDuration: 0,
          count: 0,
        });
      }

      const group = groups.get(stage.stage_name);
      group.totalDuration += Number(stage.duration);
      group.count += 1;
    }
  }

  const avg_stage_duration = {};
  let bottleneck_stage = "N/A";
  let bottleneckMinutes = -1;

  for (const [stageName, group] of groups.entries()) {
    const averageMinutes = roundNumber(group.totalDuration / group.count, 2) || 0;
    avg_stage_duration[stageName] = averageMinutes;
    if (averageMinutes > bottleneckMinutes) {
      bottleneckMinutes = averageMinutes;
      bottleneck_stage = stageName;
    }
  }

  return {
    avg_stage_duration,
    bottleneck_stage,
  };
}

function computeReworkStats(completedEntries) {
  const byStage = {};
  const byUser = new Map();
  let totalReworks = 0;

  for (const entry of completedEntries) {
    const reworkEvents = Number(entry.total_reworks || 0);
    if (reworkEvents <= 0) {
      continue;
    }

    totalReworks += reworkEvents;
    byUser.set(entry.user_name, (byUser.get(entry.user_name) || 0) + reworkEvents);

    if (entry.rework_stage_name) {
      byStage[entry.rework_stage_name] = (byStage[entry.rework_stage_name] || 0) + reworkEvents;
    }
  }

  const byUserRows = Array.from(byUser.entries())
    .map(([name, reworks]) => ({ name, reworks }))
    .sort((left, right) => right.reworks - left.reworks || left.name.localeCompare(right.name));

  const topStage = Object.entries(byStage)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] || null;

  return {
    by_stage: byStage,
    by_user: byUserRows,
    total_reworks: totalReworks,
    top_stage_name: topStage,
  };
}

function computeDeadlineStats(completedEntries) {
  const measurable = completedEntries.filter((entry) => entry.deadline && entry.final_completed_at);
  const delay_by_stage = {};
  let onTime = 0;
  let delayed = 0;
  let totalDelayMinutes = 0;

  for (const entry of measurable) {
    if (entry.is_delayed) {
      delayed += 1;
      totalDelayMinutes += Number(entry.delay_minutes || 0);
      if (entry.delay_caused_by_stage) {
        delay_by_stage[entry.delay_caused_by_stage] = (delay_by_stage[entry.delay_caused_by_stage] || 0) + 1;
      }
    } else {
      onTime += 1;
    }
  }

  return {
    on_time: onTime,
    delayed,
    measurable_total: measurable.length,
    on_time_rate_pct: percentage(onTime, measurable.length, 2),
    avg_delay_minutes: delayed > 0 ? roundNumber(totalDelayMinutes / delayed, 2) || 0 : 0,
    delay_by_stage,
  };
}

function computeDepartmentSummary(entries, scope) {
  const assignedEntries = filterAssignedEntries(entries, scope);
  const completedEntries = filterCompletedEntries(entries, scope);
  const activeEntries = filterActiveEntries(entries, scope);
  const measurableEntries = completedEntries.filter((entry) => entry.deadline && entry.final_completed_at);
  const reworkedEntries = completedEntries.filter((entry) => Number(entry.total_reworks || 0) > 0);
  const stageMetrics = computeStageAverages(completedEntries);
  const deadline = computeDeadlineStats(completedEntries);
  const totalCycleMinutes = completedEntries.reduce((sum, entry) => sum + Number(entry.total_duration || 0), 0);

  return {
    assigned_entries: assignedEntries.length,
    completed_entries: completedEntries.length,
    active_entries: activeEntries.length,
    measurable_entries: measurableEntries.length,
    completion_rate_pct: percentage(completedEntries.length, assignedEntries.length, 2),
    on_time_rate_pct: deadline.on_time_rate_pct,
    delayed_entries: deadline.delayed,
    avg_delay_minutes: deadline.avg_delay_minutes,
    rework_rate_pct: percentage(reworkedEntries.length, completedEntries.length, 2),
    rework_events: completedEntries.reduce((sum, entry) => sum + Number(entry.total_reworks || 0), 0),
    avg_cycle_minutes: completedEntries.length > 0 ? roundNumber(totalCycleMinutes / completedEntries.length, 2) || 0 : 0,
    bottleneck_stage: stageMetrics.bottleneck_stage,
  };
}

function computeDeadlineHonestyPayload(completedEntries) {
  const measurable = completedEntries.filter((entry) => entry.deadline && entry.final_completed_at);
  if (!measurable.length) {
    return {
      summary: { total: 0, on_time: 0, delayed: 0, credibility_score: 0 },
      error_distribution: { early: 0, on_target: 0, late: 0, severe: 0 },
      error_stats: { avg_error_minutes: 0, median_error_minutes: 0, max_delay_minutes: 0 },
      delay_origin: {},
      by_user: [],
    };
  }

  const error_distribution = { early: 0, on_target: 0, late: 0, severe: 0 };
  const delay_origin = {};
  const userMap = new Map();
  const allErrors = [];
  let onTime = 0;
  let delayed = 0;
  let credible = 0;

  for (const entry of measurable) {
    const errorMinutes = Number(entry.planning_error_minutes || 0);
    allErrors.push(errorMinutes);

    if (errorMinutes <= 0) {
      onTime += 1;
    } else {
      delayed += 1;
    }

    if (Math.abs(errorMinutes) <= CREDIBILITY_TOLERANCE_MINUTES) {
      credible += 1;
    }

    const bucket = classifyErrorBucket(errorMinutes);
    error_distribution[bucket] += 1;

    if (entry.delay_caused_by_stage) {
      delay_origin[entry.delay_caused_by_stage] = (delay_origin[entry.delay_caused_by_stage] || 0) + (entry.is_delayed ? 1 : 0);
    }

    if (!userMap.has(entry.user_id)) {
      userMap.set(entry.user_id, {
        user_name: entry.user_name,
        total_error: 0,
        total_items: 0,
        credible_items: 0,
        late_items: 0,
      });
    }

    const userStats = userMap.get(entry.user_id);
    userStats.total_error += errorMinutes;
    userStats.total_items += 1;
    if (Math.abs(errorMinutes) <= CREDIBILITY_TOLERANCE_MINUTES) {
      userStats.credible_items += 1;
    }
    if (errorMinutes > LATE_BOUNDARY_MINUTES) {
      userStats.late_items += 1;
    }
  }

  const by_user = Array.from(userMap.values())
    .map((userStats) => ({
      user_name: userStats.user_name,
      avg_error_minutes: roundNumber(userStats.total_error / userStats.total_items, 2) || 0,
      credibility_score: ratio(userStats.credible_items, userStats.total_items, 4),
      late_rate: ratio(userStats.late_items, userStats.total_items, 4),
    }))
    .sort((left, right) => right.avg_error_minutes - left.avg_error_minutes || left.user_name.localeCompare(right.user_name));

  return {
    summary: {
      total: measurable.length,
      on_time: onTime,
      delayed,
      credibility_score: ratio(credible, measurable.length, 4),
    },
    error_distribution,
    error_stats: {
      avg_error_minutes: roundNumber(average(allErrors), 2) || 0,
      median_error_minutes: computeMedian(allErrors),
      max_delay_minutes: Math.max(0, ...allErrors),
    },
    delay_origin,
    by_user,
  };
}

function computeUserPerformancePayload(completedEntries) {
  const userMap = new Map();

  for (const entry of completedEntries) {
    if (!userMap.has(entry.user_id)) {
      userMap.set(entry.user_id, {
        user_id: entry.user_id,
        name: entry.user_name,
        completed_items: 0,
        total_duration: 0,
        reworked_items: 0,
        rework_events: 0,
        measurable_items: 0,
        on_time_items: 0,
        planning_error_sum: 0,
        stage_sums: {},
        stage_counts: {},
      });
    }

    const userStats = userMap.get(entry.user_id);
    userStats.completed_items += 1;
    userStats.total_duration += Number(entry.total_duration || 0);
    userStats.rework_events += Number(entry.total_reworks || 0);
    if (Number(entry.total_reworks || 0) > 0) {
      userStats.reworked_items += 1;
    }

    if (entry.deadline && entry.final_completed_at) {
      userStats.measurable_items += 1;
      userStats.on_time_items += entry.is_delayed ? 0 : 1;
      userStats.planning_error_sum += Number(entry.planning_error_minutes || 0);
    }

    for (const stage of entry.stages) {
      if (!stage.reliable || !stage.completed_at || Number(stage.duration) <= 0) {
        continue;
      }

      userStats.stage_sums[stage.stage_name] = (userStats.stage_sums[stage.stage_name] || 0) + Number(stage.duration);
      userStats.stage_counts[stage.stage_name] = (userStats.stage_counts[stage.stage_name] || 0) + 1;
    }
  }

  const rawUsers = Array.from(userMap.values()).map((userStats) => {
    const avg_stage_duration = {};
    for (const stageName of Object.keys(userStats.stage_sums)) {
      avg_stage_duration[stageName] = roundNumber(
        userStats.stage_sums[stageName] / userStats.stage_counts[stageName],
        2,
      ) || 0;
    }

    return {
      user_id: userStats.user_id,
      name: userStats.name,
      fixtures_completed: userStats.completed_items,
      avg_duration_minutes: roundNumber(userStats.total_duration / userStats.completed_items, 2) || 0,
      avg_stage_duration,
      rework_rate: ratio(userStats.reworked_items, userStats.completed_items, 4),
      rework_events_per_item: ratio(userStats.rework_events, userStats.completed_items, 4),
      on_time_rate: ratio(userStats.on_time_items, userStats.measurable_items, 4),
      avg_planning_error_minutes: userStats.measurable_items > 0
        ? roundNumber(userStats.planning_error_sum / userStats.measurable_items, 2) || 0
        : 0,
    };
  });

  if (!rawUsers.length) {
    return {
      users: [],
      team_summary: {
        total_users: 0,
        avg_score: 0,
        best_performer: null,
        highest_rework_risk: null,
        most_accountable: null,
      },
    };
  }

  const maxCompleted = Math.max(...rawUsers.map((row) => row.fixtures_completed), 1);
  const scopeAverageDuration = average(rawUsers.map((row) => row.avg_duration_minutes).filter((value) => value > 0));

  const users = rawUsers.map((row) => {
    const throughputScore = clamp(row.fixtures_completed / maxCompleted, 0, 1);
    const efficiencyScore = scopeAverageDuration > 0 && row.avg_duration_minutes > 0
      ? clamp(scopeAverageDuration / row.avg_duration_minutes, 0, 1)
      : 0;
    const qualityScore = clamp(1 - row.rework_rate, 0, 1);
    const reliabilityScore = clamp(row.on_time_rate, 0, 1);
    const performanceScore = roundNumber(
      (throughputScore * 0.3)
      + (efficiencyScore * 0.25)
      + (qualityScore * 0.25)
      + (reliabilityScore * 0.2),
      4,
    ) || 0;

    let classification = "Average";
    if (performanceScore >= 0.85 && qualityScore >= 0.9 && reliabilityScore >= 0.85) {
      classification = "High Performer";
    } else if (efficiencyScore >= 1 && qualityScore < 0.8) {
      classification = "Fast but Careless";
    } else if (efficiencyScore < 0.85 && qualityScore >= 0.9) {
      classification = "Careful but Slow";
    } else if (row.rework_rate >= 0.35) {
      classification = "High Rework Risk";
    } else if (reliabilityScore < 0.6 && Math.abs(row.avg_planning_error_minutes) > 480) {
      classification = "Planning Issue";
    } else if (reliabilityScore < 0.6) {
      classification = "Execution Issue";
    }

    return {
      ...row,
      performance_score: performanceScore,
      classification,
    };
  });

  users.sort((left, right) => {
    if (right.performance_score !== left.performance_score) {
      return right.performance_score - left.performance_score;
    }

    if (right.fixtures_completed !== left.fixtures_completed) {
      return right.fixtures_completed - left.fixtures_completed;
    }

    return left.name.localeCompare(right.name);
  });

  const bestPerformer = users[0]?.name || null;
  const highestReworkRisk = [...users]
    .sort((left, right) => right.rework_rate - left.rework_rate || left.name.localeCompare(right.name))[0]?.name || null;
  const mostAccountable = [...users]
    .sort((left, right) => right.on_time_rate - left.on_time_rate || left.name.localeCompare(right.name))[0]?.name || null;

  return {
    users,
    team_summary: {
      total_users: users.length,
      avg_score: roundNumber(average(users.map((user) => user.performance_score)), 4) || 0,
      best_performer: bestPerformer,
      highest_rework_risk: highestReworkRisk,
      most_accountable: mostAccountable,
    },
  };
}

function computeWorkflowHealthPayload(completedEntries) {
  if (!completedEntries.length) {
    return {
      overall_score: 0,
      breakdown: { efficiency: 0, quality: 0, reliability: 0, stability: 0 },
      status: "CRITICAL",
      weakest_dimension: "efficiency",
      raw: {
        avg_duration_minutes: 0,
        rework_rate: 0,
        on_time_rate: 0,
        planning_error_std_dev: 0,
        fixture_count: 0,
        measurable_count: 0,
        efficiency_sample_count: 0,
      },
    };
  }

  const measurable = completedEntries.filter((entry) => entry.deadline && entry.final_completed_at);
  const expectedEntries = completedEntries.filter((entry) => Number(entry.expected_total_minutes || 0) > 0 && Number(entry.total_duration || 0) > 0);
  const withinEstimate = expectedEntries.filter((entry) => Number(entry.total_duration) <= Number(entry.expected_total_minutes));
  const reworkedEntries = completedEntries.filter((entry) => Number(entry.total_reworks || 0) > 0);
  const planningErrors = measurable.map((entry) => Number(entry.planning_error_minutes || 0));

  const efficiency = percentage(withinEstimate.length, expectedEntries.length, 2);
  const quality = percentage(completedEntries.length - reworkedEntries.length, completedEntries.length, 2);
  const reliability = percentage(measurable.filter((entry) => !entry.is_delayed).length, measurable.length, 2);
  const stability = roundNumber(
    100 - ((Math.min(standardDeviation(planningErrors), WORKFLOW_HEALTH_STD_DEV_CAP_MINUTES) / WORKFLOW_HEALTH_STD_DEV_CAP_MINUTES) * 100),
    2,
  ) || 0;

  const weightedScore = roundNumber(
    (efficiency * 0.3)
    + (quality * 0.25)
    + (reliability * 0.25)
    + (stability * 0.2),
    2,
  ) || 0;

  let status = "CRITICAL";
  if (weightedScore >= 80) {
    status = "HEALTHY";
  } else if (weightedScore >= 60) {
    status = "MODERATE";
  } else if (weightedScore >= 40) {
    status = "UNSTABLE";
  }

  const breakdown = {
    efficiency,
    quality,
    reliability,
    stability,
  };

  const weakest_dimension = Object.entries(breakdown)
    .sort((left, right) => left[1] - right[1])[0]?.[0] || "efficiency";

  return {
    overall_score: Math.round(weightedScore),
    breakdown,
    status,
    weakest_dimension,
    raw: {
      avg_duration_minutes: roundNumber(average(completedEntries.map((entry) => Number(entry.total_duration || 0))), 2) || 0,
      rework_rate: ratio(reworkedEntries.length, completedEntries.length, 4),
      on_time_rate: ratio(measurable.filter((entry) => !entry.is_delayed).length, measurable.length, 4),
      planning_error_std_dev: roundNumber(standardDeviation(planningErrors), 2) || 0,
      fixture_count: completedEntries.length,
      measurable_count: measurable.length,
      efficiency_sample_count: expectedEntries.length,
    },
  };
}

function buildComparisonPayload(entries, scope) {
  if (!scope.isOverall) {
    return null;
  }

  const departmentMap = new Map();
  for (const entry of entries) {
    if (!departmentMap.has(entry.department_id)) {
      departmentMap.set(entry.department_id, {
        department_id: entry.department_id,
        department_name: entry.department_name,
        entries: [],
      });
    }

    departmentMap.get(entry.department_id).entries.push(entry);
  }

  const departments = Array.from(departmentMap.values())
    .map((departmentGroup) => {
      const summary = computeDepartmentSummary(departmentGroup.entries, scope);
      const workflowHealth = computeWorkflowHealthPayload(filterCompletedEntries(departmentGroup.entries, scope));

      return {
        department_id: departmentGroup.department_id,
        department_name: departmentGroup.department_name,
        completed_items: summary.completed_entries,
        active_items: summary.active_entries,
        completion_rate_pct: summary.completion_rate_pct,
        on_time_rate_pct: summary.on_time_rate_pct,
        rework_rate_pct: summary.rework_rate_pct,
        avg_cycle_minutes: summary.avg_cycle_minutes,
        workflow_health_score: workflowHealth.overall_score,
      };
    })
    .sort((left, right) => right.workflow_health_score - left.workflow_health_score || left.department_name.localeCompare(right.department_name));

  return { departments };
}

async function getAnalyticsOverview(filters, user) {
  const { scope, entries } = await loadAnalyticsDataset(filters, user);
  const completedEntries = filterCompletedEntries(entries, scope);
  const rework = computeReworkStats(completedEntries);
  const deadline = computeDeadlineStats(completedEntries);
  const efficiency = computeStageAverages(completedEntries);
  const summary = computeDepartmentSummary(entries, scope);

  return {
    summary,
    rework,
    deadline,
    efficiency,
    comparison: buildComparisonPayload(entries, scope),
    metadata: {
      department_id: scope.departmentId,
      user_id: scope.userId,
      start_date: scope.startDate ? scope.startDate.toISOString() : null,
      end_date: scope.endDate ? scope.endDate.toISOString() : null,
      scope_mode: scope.userId ? "user" : scope.departmentId ? "department" : "overall",
    },
  };
}

async function getDeadlineHonesty(filters, user) {
  const { scope, entries } = await loadAnalyticsDataset(filters, user);
  return computeDeadlineHonestyPayload(filterCompletedEntries(entries, scope));
}

async function getUserPerformance(filters, user) {
  const { scope, entries } = await loadAnalyticsDataset(filters, user);
  return computeUserPerformancePayload(filterCompletedEntries(entries, scope));
}

async function getWorkflowHealth(filters, user) {
  const { scope, entries } = await loadAnalyticsDataset(filters, user);
  return computeWorkflowHealthPayload(filterCompletedEntries(entries, scope));
}

module.exports = {
  buildFixtureAnalyticsDataset: async (filters, user, client = pool) => (await loadAnalyticsDataset(filters, user, client)).entries,
  getAnalyticsOverview,
  getDeadlineHonesty,
  getUserPerformance,
  getWorkflowHealth,
};
