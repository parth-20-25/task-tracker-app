const { pool } = require("../db");
const { PERMISSIONS } = require("../config/constants");
const { AppError } = require("../lib/AppError");
const { listDepartments } = require("../repositories/departmentsRepository");
const { listUsers } = require("../repositories/usersRepository");
const { hasPermission, isAdmin } = require("./accessControlService");

// ─── Constants ───────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 15 * 60 * 1000;
/**
 * Approval scoring thresholds (in hours).
 * ≤ TARGET → score 100. ≥ MAX → score 0. Linear in between.
 */
const APPROVAL_TARGET_HOURS = 3;
const APPROVAL_MAX_HOURS = 24;
const DEFAULT_TREND_MONTHS = 6;
const DEFAULT_TOP_SERIES = 5;
/**
 * Minimum non-cancelled tasks to produce a non-null performance_score.
 * Below this threshold all rate/score metrics are null + low_data = true.
 */
const MIN_TASKS_FOR_METRICS = 3;

const METRIC_CONFIG = {
  performance_score:        { label: "Performance Score",    kind: "score" },
  completion_rate:          { label: "Completion Rate",       kind: "percent" },
  approval_score:           { label: "Approval Score",        kind: "score" },
  rejection_rate:           { label: "Rejection Rate",        kind: "percent" },
  overdue_rate:             { label: "Overdue Rate",          kind: "percent" },
  planning_inaccuracy_rate: { label: "Planning Inaccuracy",   kind: "percent" },
  // avg_approval_time is computed but NOT exposed as a selectable metric
  avg_approval_time:        { label: "Average Approval Time", kind: "duration_hours" },
};

const SCORE_BREAKDOWN = [
  { key: "completion_score", label: "Completion",  raw_key: "completion_rate" },
  { key: "approval_score",   label: "Approval",    raw_key: "avg_approval_time" },
  { key: "rejection_score",  label: "Rejection",   raw_key: "rejection_rate" },
  { key: "overdue_score",    label: "Overdue",     raw_key: "overdue_rate" },
  { key: "planning_score",   label: "Planning",    raw_key: "planning_inaccuracy_rate" },
];

const SUMMARY_CARD_DEFINITIONS = [
  { key: "completion_rate",          label: "Completion", higher_is_better: true,  kind: "percent" },
  { key: "approval_score",           label: "Approval",   higher_is_better: true,  kind: "score" },
  { key: "rejection_rate",           label: "Rejection",  higher_is_better: false, kind: "percent" },
  { key: "overdue_rate",             label: "Overdue",    higher_is_better: false, kind: "percent" },
  { key: "planning_inaccuracy_rate", label: "Planning",   higher_is_better: false, kind: "percent" },
];

// ─── Cache ────────────────────────────────────────────────────────────────────

const analyticsCache = new Map();

function readFromCache(key) {
  const cached = analyticsCache.get(key);
  if (!cached) return null;
  if (cached.expires_at <= Date.now()) {
    analyticsCache.delete(key);
    return null;
  }
  return cached.value;
}

function writeToCache(key, value) {
  analyticsCache.set(key, { value, expires_at: Date.now() + CACHE_TTL_MS });
  return value;
}

async function withAnalyticsCache(key, loader) {
  const cached = readFromCache(key);
  if (cached) return cached;
  return writeToCache(key, await loader());
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function nowUtc() { return new Date(); }

function roundNumber(value, decimals = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return null;
  const factor = 10 ** decimals;
  return Math.round(Number(value) * factor) / factor;
}

function clampScore(value) {
  return Math.min(100, Math.max(0, Number(value) || 0));
}

function getMetricKey(metric) {
  const requested = String(metric || "performance_score").trim();
  return Object.prototype.hasOwnProperty.call(METRIC_CONFIG, requested)
    ? requested
    : "performance_score";
}

function parseMonthKey(monthInput) {
  const trimmed = String(monthInput || "").trim();
  const match = trimmed.match(/^(\d{4})-(\d{2})$/);
  if (match) {
    const year = Number(match[1]);
    const monthIndex = Number(match[2]) - 1;
    if (monthIndex < 0 || monthIndex > 11) {
      throw new AppError(400, `Invalid month value in "${trimmed}"`);
    }
    return new Date(Date.UTC(year, monthIndex, 1));
  }
  const current = nowUtc();
  return new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 1));
}

function addUtcMonths(date, delta) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + delta, 1));
}

function monthKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(date) {
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

function buildMonthSequence(endMonthStart, length) {
  const months = [];
  for (let i = length - 1; i >= 0; i--) {
    const month = addUtcMonths(endMonthStart, -i);
    months.push({ key: monthKey(month), start: month, label: monthLabel(month) });
  }
  return months;
}

function normalizeMonths(value, fallback = DEFAULT_TREND_MONTHS) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, 24);
}

function parseOptionalInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function toDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Compute approval duration in hours.
 * Uses ONLY submitted_at → approved_at. Returns null if either is missing or
 * if the duration is negative (data inconsistency). Caps at APPROVAL_MAX_HOURS.
 */
function safeDurationHours(submittedAt, approvedAt) {
  const start = toDate(submittedAt);
  const end   = toDate(approvedAt);
  if (!start || !end) return null;
  const deltaHours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
  if (deltaHours < 0) return null;
  return Math.min(APPROVAL_MAX_HOURS, deltaHours);
}

function percentage(numerator, denominator) {
  if (!denominator) return null;
  return roundNumber((numerator / denominator) * 100);
}

function calculateApprovalScore(avgApprovalTimeHours) {
  if (avgApprovalTimeHours === null || avgApprovalTimeHours === undefined) return null;
  if (avgApprovalTimeHours <= APPROVAL_TARGET_HOURS) return 100;
  if (avgApprovalTimeHours >= APPROVAL_MAX_HOURS) return 0;
  return roundNumber(
    100 * (APPROVAL_MAX_HOURS - avgApprovalTimeHours) / (APPROVAL_MAX_HOURS - APPROVAL_TARGET_HOURS),
  );
}

function normalizeComparisonValue(value) {
  return value === null || value === undefined || Number.isNaN(Number(value))
    ? null
    : Number(value);
}

function calculateChange(currentValue, previousValue) {
  if (currentValue === null || currentValue === undefined ||
      previousValue === null || previousValue === undefined) return null;
  const prev = Number(previousValue);
  const curr = Number(currentValue);
  if (prev === 0) return curr === 0 ? 0 : null;
  return roundNumber(((curr - prev) / Math.abs(prev)) * 100);
}

// ─── Status resolution ────────────────────────────────────────────────────────

/**
 * Canonical status mapping. Priority order is important.
 * "cancelled" is excluded from KPI denominators entirely.
 * "completed" = task is fully closed/approved.
 */
function resolveAnalyticsStatus(task) {
  if (task.status === "cancelled") return "cancelled";

  // closed + approved_at present = completed
  if (task.status === "closed" && task.approved_at) return "completed";
  // approved by verification = completed
  if (task.verification_status === "approved") return "completed";
  // closed without approval record = completed (system-closed)
  if (task.status === "closed") return "completed";

  if (task.status === "under_review") return "submitted";
  if (task.status === "rework" || task.verification_status === "rejected") return "rejected";

  return "pending";
}

// ─── Aggregate calculation ────────────────────────────────────────────────────

function buildNullAggregate() {
  return {
    total_tasks: 0,
    cancelled_tasks: 0,
    closed_tasks: 0,
    overdue_tasks: 0,
    total_rejections: 0,
    approval_count: 0,
    approval_time_sum: 0,
    completion_rate: null,
    rejection_rate: null,
    overdue_rate: null,
    planning_inaccuracy_rate: null,
    avg_approval_time: null,
    completion_score: null,
    approval_score: null,
    rejection_score: null,
    overdue_score: null,
    planning_score: null,
    performance_score: null,
    low_data: false,
  };
}

/**
 * KPI FORMULAS (authoritative definitions)
 *
 * Denominator for rate metrics = total_tasks (excludes cancelled).
 *
 * completion_rate          = closed_tasks / total_tasks × 100
 * rejection_rate           = total_rejections / total_tasks × 100
 *   (rejection_count per task; not capped – a task may be rejected N times)
 * overdue_rate             = overdue_tasks / total_tasks × 100
 *   overdue_task = approved_at exists AND (due_date < approved_at OR sla_due_date < approved_at)
 * planning_inaccuracy_rate = cancelled_tasks / (total_tasks + cancelled_tasks) × 100
 *   (cancelled tasks are in numerator and denominator for this metric only)
 * avg_approval_time        = mean of (approved_at − submitted_at) in hours
 *   only computed for tasks where BOTH submitted_at and approved_at are non-null
 * approval_score           = linear interpolation TARGET→MAX hours → 100→0
 * completion_score         = completion_rate (0–100)
 * rejection_score          = 100 − rejection_rate  (clamped 0–100)
 * overdue_score            = 100 − overdue_rate     (clamped 0–100)
 * planning_score           = 100 − planning_inaccuracy_rate (clamped 0–100)
 * performance_score        = 0.40×completion + 0.20×approval + 0.20×rejection
 *                            + 0.15×overdue + 0.05×planning
 *   (null if any component score is null AND total_tasks < MIN_TASKS_FOR_METRICS)
 *
 * If total_tasks < MIN_TASKS_FOR_METRICS → all rate/score metrics = null, low_data = true.
 */
function calculateAggregate(tasks) {
  const agg = {
    total_tasks: 0,
    cancelled_tasks: 0,
    closed_tasks: 0,
    overdue_tasks: 0,
    total_rejections: 0,
    approval_count: 0,
    approval_time_sum: 0,
  };

  for (const task of tasks) {
    const status = resolveAnalyticsStatus(task);

    if (status === "cancelled") {
      agg.cancelled_tasks += 1;
      continue; // cancelled tasks do NOT enter the KPI denominator
    }

    agg.total_tasks += 1;

    if (status === "completed") {
      agg.closed_tasks += 1;
    }

    // rejection_count is the authoritative per-task rejection tally
    agg.total_rejections += Number(task.rejection_count || 0);

    // Approval time: only when both submitted_at and approved_at are present
    const approvalHours = safeDurationHours(task.submitted_at, task.approved_at);
    if (approvalHours !== null) {
      agg.approval_time_sum += approvalHours;
      agg.approval_count += 1;
    }

    // Overdue: task considered overdue if completed after the earlier of due_date / sla_due_date
    if (status === "completed") {
      const approvedAt  = toDate(task.approved_at);
      const closedAt    = toDate(task.closed_at);
      const completedAt = approvedAt || closedAt;
      const dueDate     = toDate(task.due_date);
      const slaDueDate  = toDate(task.sla_due_date);
      if (completedAt && ((dueDate && dueDate < completedAt) || (slaDueDate && slaDueDate < completedAt))) {
        agg.overdue_tasks += 1;
      }
    }
  }

  // Not enough data → return nulls, preserve raw counts
  if (agg.total_tasks < MIN_TASKS_FOR_METRICS) {
    return {
      ...buildNullAggregate(),
      total_tasks: agg.total_tasks,
      cancelled_tasks: agg.cancelled_tasks,
      closed_tasks: agg.closed_tasks,
      overdue_tasks: agg.overdue_tasks,
      total_rejections: agg.total_rejections,
      approval_count: agg.approval_count,
      low_data: true,
    };
  }

  const completionRate          = percentage(agg.closed_tasks, agg.total_tasks);
  const rejectionRate           = percentage(agg.total_rejections, agg.total_tasks);
  const overdueRate             = percentage(agg.overdue_tasks, agg.total_tasks);
  const planningInaccuracyRate  = percentage(agg.cancelled_tasks, agg.total_tasks + agg.cancelled_tasks);
  const avgApprovalTime         = agg.approval_count > 0
    ? roundNumber(agg.approval_time_sum / agg.approval_count)
    : null;

  const completionScore  = completionRate;
  const rejectionScore   = rejectionRate  === null ? null : clampScore(100 - rejectionRate);
  const overdueScore     = overdueRate    === null ? null : clampScore(100 - overdueRate);
  const planningScore    = planningInaccuracyRate === null ? null : clampScore(100 - planningInaccuracyRate);
  const approvalScore    = calculateApprovalScore(avgApprovalTime);

  // performance_score is null when approval_score is null (no tasks were approved/submitted)
  const allScores = [completionScore, approvalScore, rejectionScore, overdueScore, planningScore];
  const performanceScore = allScores.some((s) => s === null)
    ? null
    : roundNumber(
        0.40 * completionScore
      + 0.20 * approvalScore
      + 0.20 * rejectionScore
      + 0.15 * overdueScore
      + 0.05 * planningScore,
      );

  return {
    ...agg,
    completion_rate:          completionRate,
    rejection_rate:           rejectionRate,
    overdue_rate:             overdueRate,
    planning_inaccuracy_rate: planningInaccuracyRate,
    avg_approval_time:        avgApprovalTime,
    completion_score:         completionScore,
    approval_score:           approvalScore,
    rejection_score:          rejectionScore,
    overdue_score:            overdueScore,
    planning_score:           planningScore,
    performance_score:        performanceScore,
    low_data:                 false,
  };
}

// ─── Sorting / metric extraction ──────────────────────────────────────────────

function getMetricValue(result, metricKey) {
  return normalizeComparisonValue(result?.[metricKey]);
}

function sortRowsByMetric(rows, metricKey) {
  return [...rows].sort((left, right) => {
    const r = getMetricValue(right, metricKey);
    const l = getMetricValue(left, metricKey);
    if (r === null && l === null) return String(left.name || "").localeCompare(String(right.name || ""));
    if (r === null) return -1;
    if (l === null) return 1;
    if (r === l) return String(left.name || "").localeCompare(String(right.name || ""));
    return r - l;
  });
}

// ─── Scope / permission helpers ───────────────────────────────────────────────

function getScopeContext(user) {
  const hasAllDeptScope = isAdmin(user) || hasPermission(user, PERMISSIONS.ANALYTICS_SCOPE_ALL_DEPARTMENTS);
  const hasDeptScope    = hasPermission(user, PERMISSIONS.ANALYTICS_SCOPE_DEPARTMENT_ONLY) || Boolean(user?.department_id);

  if (!hasAllDeptScope && !hasDeptScope) {
    throw new AppError(403, "Analytics scope is not configured for this user");
  }
  if (!hasAllDeptScope && !user?.department_id) {
    throw new AppError(403, "A department is required for department-scoped analytics");
  }

  return {
    scope: hasAllDeptScope ? "all_departments" : "department_only",
    department_id: user?.department_id || null,
  };
}

function ensureMonthlyTimeRange(timeRange) {
  const normalized = String(timeRange || "monthly").trim().toLowerCase();
  if (normalized !== "monthly") {
    throw new AppError(400, "Only monthly aggregation is currently supported");
  }
  return normalized;
}

function ensurePermission(user, permissionId) {
  if (!hasPermission(user, permissionId) && !isAdmin(user)) {
    throw new AppError(403, `Forbidden: ${permissionId} is required`);
  }
}

function ensureDepartmentAccess(user, scopeContext, departmentId) {
  if (!departmentId) return null;
  if (scopeContext.scope === "department_only" && departmentId !== scopeContext.department_id) {
    throw new AppError(403, "You do not have access to another department's analytics");
  }
  return departmentId;
}

function resolveDepartmentEntityId(user, scopeContext, requestedEntityId) {
  const targetId = requestedEntityId || scopeContext.department_id;
  if (!targetId) throw new AppError(400, "department_id is required");

  if (targetId === scopeContext.department_id) {
    ensurePermission(user, PERMISSIONS.VIEW_SELF_DEPARTMENT_ANALYTICS);
  } else {
    ensurePermission(user, PERMISSIONS.VIEW_DEPARTMENT_COMPARISON);
  }

  return ensureDepartmentAccess(user, scopeContext, targetId);
}

async function resolveUserEntity(user, scopeContext, requestedEmployeeId) {
  const targetId = requestedEmployeeId || user?.employee_id;
  if (!targetId) throw new AppError(400, "entity_id is required");

  const users = await listUsers();
  const targetUser = users.find((u) => u.employee_id === targetId);
  if (!targetUser) throw new AppError(404, "User not found");

  if (targetId === user.employee_id) {
    ensurePermission(user, PERMISSIONS.VIEW_SELF_USER_ANALYTICS);
  } else {
    ensurePermission(user, PERMISSIONS.VIEW_USER_COMPARISON);
  }

  if (scopeContext.scope === "department_only" && targetUser.department_id !== scopeContext.department_id) {
    throw new AppError(403, "You do not have access to another department's users");
  }

  return targetUser;
}

async function listVisibleDepartments(user, scopeContext) {
  const departments = await listDepartments();
  if (scopeContext.scope === "department_only") {
    return departments.filter((d) => d.id === scopeContext.department_id);
  }
  return departments;
}

async function listVisibleUsers(scopeContext, departmentId = null) {
  const users = await listUsers();
  return users.filter((u) => {
    if (u.is_active === false) return false;
    if (scopeContext.scope === "department_only" && u.department_id !== scopeContext.department_id) return false;
    if (departmentId && u.department_id !== departmentId) return false;
    return true;
  });
}

// ─── DB query ─────────────────────────────────────────────────────────────────

/**
 * Fetch raw task facts for the given window.
 *
 * PERIOD REFERENCE: DATE_TRUNC('month', t.created_at)
 * We use created_at as the single authoritative timeline anchor for bucketing.
 * This ensures a task is counted exactly once and in the month it was created,
 * preventing shifting between months as status fields are updated.
 *
 * submitted_at  = t.submitted_at only (not fabricated from status)
 * approved_at   = t.approved_at only (not substituted with closed_at/verified_at)
 * due_date      = t.due_date only
 * sla_due_date  = t.sla_due_date only (separate field; not derived from due_date)
 *
 * rejection_count uses GREATEST to handle both explicit counter and status-derived flag.
 */
async function queryTaskFacts({ scopeContext, startDate, endDate, departmentId = null, assignedUserId = null }) {
  const params = [startDate.toISOString(), endDate.toISOString()];
  const where = [
    "t.created_at >= $1",
    "t.created_at < $2",
  ];

  if (scopeContext.scope === "department_only") {
    params.push(scopeContext.department_id);
    where.push(`t.department_id = $${params.length}`);
  }

  if (departmentId) {
    params.push(departmentId);
    where.push(`t.department_id = $${params.length}`);
  }

  if (assignedUserId) {
    params.push(assignedUserId);
    // Use assigned_user_id first; fall back to assigned_to only if assigned_user_id is null
    where.push(`COALESCE(t.assigned_user_id, t.assigned_to) = $${params.length}`);
  }

  const result = await pool.query(
    `
      SELECT
        t.id,
        t.department_id,
        d.name                                     AS department_name,
        COALESCE(t.assigned_user_id, t.assigned_to) AS assigned_user_id,
        u.name                                     AS assigned_user_name,
        t.status,
        t.verification_status,
        t.created_at,
        -- Exact fields only; no fabrication from status transitions
        t.submitted_at,
        t.approved_at,
        t.closed_at,
        t.due_date,
        t.sla_due_date,
        GREATEST(
          COALESCE(t.rejection_count, 0),
          CASE WHEN t.status = 'rework' OR t.verification_status = 'rejected' THEN 1 ELSE 0 END
        )                                          AS rejection_count,
        DATE_TRUNC('month', t.created_at)          AS period_month
      FROM tasks t
      LEFT JOIN departments d ON d.id = t.department_id
      LEFT JOIN users u ON u.employee_id = COALESCE(t.assigned_user_id, t.assigned_to)
      WHERE ${where.join(" AND ")}
    `,
    params,
  );

  return result.rows.map((row) => ({
    id:                  row.id,
    department_id:       row.department_id,
    department_name:     row.department_name || null,
    assigned_user_id:    row.assigned_user_id || null,
    assigned_user_name:  row.assigned_user_name || null,
    status:              row.status,
    verification_status: row.verification_status,
    created_at:          row.created_at,
    submitted_at:        row.submitted_at || null,
    approved_at:         row.approved_at  || null,
    closed_at:           row.closed_at    || null,
    due_date:            row.due_date     || null,
    sla_due_date:        row.sla_due_date || null,
    rejection_count:     Number(row.rejection_count || 0),
    period_month:        row.period_month ? monthKey(new Date(row.period_month)) : null,
  }));
}

// ─── Group / build helpers ────────────────────────────────────────────────────

function groupFactsBy(items, getKey) {
  return items.reduce((map, item) => {
    const key = getKey(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
    return map;
  }, new Map());
}

function buildComparisonRows(entities, groupedFacts, metricKey, idKey, nameKey) {
  const rows = entities.map((entity) => {
    const facts   = groupedFacts.get(entity[idKey]) || [];
    const metrics = calculateAggregate(facts);
    return {
      [idKey]: entity[idKey],
      name:         entity[nameKey],
      metric_value: getMetricValue(metrics, metricKey),
      ...metrics,
    };
  });

  return sortRowsByMetric(rows, metricKey).map((row, index) => ({
    ...row,
    rank: index + 1,
  }));
}

function buildTrendPoints(months, groupedFactsByMonth, metricKey) {
  return months.map((month) => {
    const monthFacts = groupedFactsByMonth.get(month.key) || [];
    const metrics    = calculateAggregate(monthFacts);
    return {
      month:    month.key,
      label:    month.label,
      value:    getMetricValue(metrics, metricKey),
      low_data: metrics.low_data,
    };
  });
}

function buildTopSeries(entities, months, facts, entityIdKey, entityNameKey, metricKey, top) {
  const factsByEntity = groupFactsBy(facts, (task) => task[entityIdKey]);

  const ranked = entities.map((entity) => {
    const entityFacts      = factsByEntity.get(entity[entityIdKey]) || [];
    const latestMonthFacts = entityFacts.filter((f) => f.period_month === months[months.length - 1]?.key);
    const latestMetrics    = calculateAggregate(latestMonthFacts);
    return { ...entity, metric_value: getMetricValue(latestMetrics, metricKey) };
  });

  const selected = sortRowsByMetric(ranked, metricKey).slice(0, top);

  return selected.map((entity) => {
    const entityFacts  = factsByEntity.get(entity[entityIdKey]) || [];
    const factsByMonth = groupFactsBy(entityFacts, (task) => task.period_month);
    return {
      entity_id: entity[entityIdKey],
      name:      entity[entityNameKey],
      series:    buildTrendPoints(months, factsByMonth, metricKey),
    };
  });
}

function buildSummaryCards(currentMetrics, previousMetrics) {
  return SUMMARY_CARD_DEFINITIONS.map((def) => ({
    key:             def.key,
    label:           def.label,
    kind:            def.kind,
    higher_is_better: def.higher_is_better,
    current_value:   normalizeComparisonValue(currentMetrics?.[def.key]),
    previous_value:  normalizeComparisonValue(previousMetrics?.[def.key]),
    change_pct:      calculateChange(currentMetrics?.[def.key], previousMetrics?.[def.key]),
  }));
}

function buildScoreBreakdown(metrics) {
  return SCORE_BREAKDOWN.map((def) => ({
    key:       def.key,
    label:     def.label,
    score:     normalizeComparisonValue(metrics?.[def.key]),
    raw_value: normalizeComparisonValue(metrics?.[def.raw_key]),
  }));
}

// ─── Public service functions ─────────────────────────────────────────────────

async function getAnalyticsContext(user) {
  const scopeContext = getScopeContext(user);
  const departments  = await listVisibleDepartments(user, scopeContext);
  const defaultMonth = monthKey(parseMonthKey());
  const availableViews = [];

  if (hasPermission(user, PERMISSIONS.VIEW_SELF_USER_ANALYTICS) || isAdmin(user)) {
    availableViews.push({ key: "my_performance", label: "My Performance" });
  }
  if (hasPermission(user, PERMISSIONS.VIEW_SELF_DEPARTMENT_ANALYTICS) || isAdmin(user)) {
    availableViews.push({ key: "my_department", label: "My Department" });
  }
  if (hasPermission(user, PERMISSIONS.VIEW_DEPARTMENT_COMPARISON) || isAdmin(user)) {
    availableViews.push({ key: "department_comparison", label: "Department Comparison" });
  }
  if (hasPermission(user, PERMISSIONS.VIEW_USER_COMPARISON) || isAdmin(user)) {
    availableViews.push({ key: "user_comparison", label: "User Comparison" });
  }

  if (availableViews.length === 0) {
    throw new AppError(403, "No analytics permissions are configured for this user");
  }

  return {
    default_month:  defaultMonth,
    default_view:   availableViews[0].key,
    scope:          scopeContext.scope,
    user: {
      employee_id:     user.employee_id,
      name:            user.name,
      department_id:   user.department_id || null,
      department_name: user.department?.name || null,
    },
    permissions: {
      view_self_user:              hasPermission(user, PERMISSIONS.VIEW_SELF_USER_ANALYTICS)        || isAdmin(user),
      view_self_department:        hasPermission(user, PERMISSIONS.VIEW_SELF_DEPARTMENT_ANALYTICS)  || isAdmin(user),
      view_department_comparison:  hasPermission(user, PERMISSIONS.VIEW_DEPARTMENT_COMPARISON)      || isAdmin(user),
      view_user_comparison:        hasPermission(user, PERMISSIONS.VIEW_USER_COMPARISON)            || isAdmin(user),
    },
    departments: departments.map((d) => ({ id: d.id, name: d.name })),
    available_views: availableViews,
    metric_options: Object.entries(METRIC_CONFIG)
      .filter(([key]) => key !== "avg_approval_time")
      .map(([key, cfg]) => ({ key, label: cfg.label, kind: cfg.kind })),
    time_filters: [{ key: "monthly", label: "Monthly" }],
  };
}

async function getDepartmentComparison(user, query = {}) {
  ensurePermission(user, PERMISSIONS.VIEW_DEPARTMENT_COMPARISON);
  ensureMonthlyTimeRange(query.time_range);
  const metricKey    = getMetricKey(query.metric);
  const scopeContext = getScopeContext(user);
  const monthStart   = parseMonthKey(query.month);
  const monthEnd     = addUtcMonths(monthStart, 1);
  const departments  = await listVisibleDepartments(user, scopeContext);

  const facts = await withAnalyticsCache(
    JSON.stringify({ type: "department_comparison", scope: scopeContext, month: monthKey(monthStart) }),
    () => queryTaskFacts({ scopeContext, startDate: monthStart, endDate: monthEnd }),
  );

  const groupedFacts = groupFactsBy(facts, (task) => task.department_id);

  return buildComparisonRows(
    departments.map((d) => ({ department_id: d.id, department_name: d.name })),
    groupedFacts,
    metricKey,
    "department_id",
    "department_name",
  );
}

async function getDepartmentTrend(user, query = {}) {
  ensureMonthlyTimeRange(query.time_range);
  const metricKey    = getMetricKey(query.metric);
  const scopeContext = getScopeContext(user);
  const monthsCount  = normalizeMonths(query.months);
  const top          = parseOptionalInteger(query.top, DEFAULT_TOP_SERIES);
  const currentMonth = parseMonthKey(query.month);
  const months       = buildMonthSequence(currentMonth, monthsCount);
  const rangeStart   = months[0].start;
  const rangeEnd     = addUtcMonths(currentMonth, 1);

  if (query.department_id) {
    const departmentId = resolveDepartmentEntityId(user, scopeContext, String(query.department_id));
    const departments  = await listVisibleDepartments(user, scopeContext);
    const department   = departments.find((d) => d.id === departmentId);
    if (!department) throw new AppError(404, "Department not found");

    const facts = await withAnalyticsCache(
      JSON.stringify({ type: "department_trend_single", scope: scopeContext, departmentId, months: months.map((m) => m.key) }),
      () => queryTaskFacts({ scopeContext, startDate: rangeStart, endDate: rangeEnd, departmentId }),
    );

    const factsByMonth = groupFactsBy(facts, (task) => task.period_month);

    return {
      entity_id: department.id,
      name:      department.name,
      metric:    metricKey,
      series:    buildTrendPoints(months, factsByMonth, metricKey),
    };
  }

  ensurePermission(user, PERMISSIONS.VIEW_DEPARTMENT_COMPARISON);
  const departments = await listVisibleDepartments(user, scopeContext);

  const facts = await withAnalyticsCache(
    JSON.stringify({ type: "department_trend_top", scope: scopeContext, months: months.map((m) => m.key) }),
    () => queryTaskFacts({ scopeContext, startDate: rangeStart, endDate: rangeEnd }),
  );

  return buildTopSeries(
    departments.map((d) => ({ department_id: d.id, department_name: d.name })),
    months,
    facts,
    "department_id",
    "department_name",
    metricKey,
    top,
  );
}

async function getUserComparison(user, query = {}) {
  ensurePermission(user, PERMISSIONS.VIEW_USER_COMPARISON);
  ensureMonthlyTimeRange(query.time_range);
  const metricKey            = getMetricKey(query.metric);
  const scopeContext         = getScopeContext(user);
  const requestedDeptId      = query.department_id ? String(query.department_id).trim() : null;
  const departmentId         = requestedDeptId
    ? ensureDepartmentAccess(user, scopeContext, requestedDeptId)
    : scopeContext.department_id;
  const monthStart = parseMonthKey(query.month);
  const monthEnd   = addUtcMonths(monthStart, 1);
  const users      = await listVisibleUsers(scopeContext, departmentId);

  const facts = await withAnalyticsCache(
    JSON.stringify({ type: "user_comparison", scope: scopeContext, departmentId, month: monthKey(monthStart) }),
    () => queryTaskFacts({ scopeContext, startDate: monthStart, endDate: monthEnd, departmentId }),
  );

  const groupedFacts = groupFactsBy(facts, (task) => task.assigned_user_id);

  return buildComparisonRows(
    users.map((u) => ({ assigned_user_id: u.employee_id, assigned_user_name: u.name })),
    groupedFacts,
    metricKey,
    "assigned_user_id",
    "assigned_user_name",
  );
}

async function getUserTrend(user, query = {}) {
  ensureMonthlyTimeRange(query.time_range);
  const metricKey    = getMetricKey(query.metric);
  const scopeContext = getScopeContext(user);
  const monthsCount  = normalizeMonths(query.months);
  const top          = parseOptionalInteger(query.top, DEFAULT_TOP_SERIES);
  const currentMonth = parseMonthKey(query.month);
  const months       = buildMonthSequence(currentMonth, monthsCount);
  const rangeStart   = months[0].start;
  const rangeEnd     = addUtcMonths(currentMonth, 1);

  if (query.user_id) {
    const targetUser = await resolveUserEntity(user, scopeContext, String(query.user_id));

    const facts = await withAnalyticsCache(
      JSON.stringify({ type: "user_trend_single", scope: scopeContext, userId: targetUser.employee_id, months: months.map((m) => m.key) }),
      () => queryTaskFacts({ scopeContext, startDate: rangeStart, endDate: rangeEnd, assignedUserId: targetUser.employee_id }),
    );

    const factsByMonth = groupFactsBy(facts, (task) => task.period_month);

    return {
      entity_id: targetUser.employee_id,
      name:      targetUser.name,
      metric:    metricKey,
      series:    buildTrendPoints(months, factsByMonth, metricKey),
    };
  }

  ensurePermission(user, PERMISSIONS.VIEW_USER_COMPARISON);
  const requestedDeptId = query.department_id ? String(query.department_id).trim() : null;
  const departmentId    = requestedDeptId
    ? ensureDepartmentAccess(user, scopeContext, requestedDeptId)
    : scopeContext.department_id;
  const users = await listVisibleUsers(scopeContext, departmentId);

  const facts = await withAnalyticsCache(
    JSON.stringify({ type: "user_trend_top", scope: scopeContext, departmentId, months: months.map((m) => m.key) }),
    () => queryTaskFacts({ scopeContext, startDate: rangeStart, endDate: rangeEnd, departmentId }),
  );

  return buildTopSeries(
    users.map((u) => ({ assigned_user_id: u.employee_id, assigned_user_name: u.name })),
    months,
    facts,
    "assigned_user_id",
    "assigned_user_name",
    metricKey,
    top,
  );
}

async function getKpiBreakdown(user, query = {}) {
  ensureMonthlyTimeRange(query.time_range);
  const scopeContext        = getScopeContext(user);
  const entityType          = String(query.entity_type || "").trim().toLowerCase();
  const currentMonthStart   = parseMonthKey(query.month);
  const previousMonthStart  = addUtcMonths(currentMonthStart, -1);
  const nextMonthStart      = addUtcMonths(currentMonthStart, 1);

  if (!["department", "user"].includes(entityType)) {
    throw new AppError(400, "entity_type must be either 'department' or 'user'");
  }

  if (!String(query.entity_id || "").trim()) {
    throw new AppError(400, "entity_id is required");
  }

  if (entityType === "department") {
    const departmentId = resolveDepartmentEntityId(user, scopeContext, String(query.entity_id).trim());
    const departments  = await listVisibleDepartments(user, scopeContext);
    const department   = departments.find((d) => d.id === departmentId);
    if (!department) throw new AppError(404, "Department not found");

    const facts = await withAnalyticsCache(
      JSON.stringify({ type: "kpi_breakdown_department", scope: scopeContext, departmentId, month: monthKey(currentMonthStart) }),
      () => queryTaskFacts({ scopeContext, startDate: previousMonthStart, endDate: nextMonthStart, departmentId }),
    );

    const currentFacts   = facts.filter((t) => t.period_month === monthKey(currentMonthStart));
    const previousFacts  = facts.filter((t) => t.period_month === monthKey(previousMonthStart));
    const currentMetrics  = calculateAggregate(currentFacts);
    const previousMetrics = calculateAggregate(previousFacts);

    return {
      entity_type: "department",
      entity_id:   department.id,
      name:        department.name,
      month:       monthKey(currentMonthStart),
      current:     currentMetrics,
      previous:    previousMetrics,
      summary_cards:   buildSummaryCards(currentMetrics, previousMetrics),
      kpi_breakdown:   buildScoreBreakdown(currentMetrics),
    };
  }

  // entityType === "user"
  const targetUser = await resolveUserEntity(user, scopeContext, String(query.entity_id).trim());

  const facts = await withAnalyticsCache(
    JSON.stringify({ type: "kpi_breakdown_user", scope: scopeContext, userId: targetUser.employee_id, month: monthKey(currentMonthStart) }),
    () => queryTaskFacts({ scopeContext, startDate: previousMonthStart, endDate: nextMonthStart, assignedUserId: targetUser.employee_id }),
  );

  const currentFacts   = facts.filter((t) => t.period_month === monthKey(currentMonthStart));
  const previousFacts  = facts.filter((t) => t.period_month === monthKey(previousMonthStart));
  const currentMetrics  = calculateAggregate(currentFacts);
  const previousMetrics = calculateAggregate(previousFacts);

  return {
    entity_type: "user",
    entity_id:   targetUser.employee_id,
    name:        targetUser.name,
    month:       monthKey(currentMonthStart),
    current:     currentMetrics,
    previous:    previousMetrics,
    summary_cards:   buildSummaryCards(currentMetrics, previousMetrics),
    kpi_breakdown:   buildScoreBreakdown(currentMetrics),
  };
}

// ─── Executive Dashboard ─────────────────────────────────────────────────────

/**
 * Synthesize KPI data into CEO-level insights.
 *
 * Provides:
 * - Performance score with trend
 * - Business health (4 key indicators)
 * - Risk alerts based on thresholds
 * - No intermediate calculations shown
 */
async function getExecutiveData(user, query = {}) {
  ensureMonthlyTimeRange(query.time_range);
  const scopeContext = getScopeContext(user);
  const currentMonth = parseMonthKey(query.month);
  const previousMonth = addUtcMonths(currentMonth, -1);
  const currentEnd = addUtcMonths(currentMonth, 1);
  const previousEnd = addUtcMonths(previousMonth, 1);

  // Determine breakdown target based on view or explicit entity_id
  const entityType = String(query.entity_type || "user").trim().toLowerCase();
  const entityId = String(query.entity_id || user.employee_id).trim();

  let targetEntity = null;
  if (entityType === "department") {
    const deptId = resolveDepartmentEntityId(user, scopeContext, entityId);
    const depts = await listVisibleDepartments(user, scopeContext);
    targetEntity = depts.find((d) => d.id === deptId);
    if (!targetEntity) throw new AppError(404, "Department not found");
  } else {
    targetEntity = await resolveUserEntity(user, scopeContext, entityId);
  }

  // Fetch task facts for current and previous month
  const currentFacts = await withAnalyticsCache(
    JSON.stringify({
      type: "executive",
      entityType,
      entityId: targetEntity.id || targetEntity.employee_id,
      month: monthKey(currentMonth),
    }),
    () =>
      queryTaskFacts({
        scopeContext,
        startDate: currentMonth,
        endDate: currentEnd,
        ...(entityType === "department" ? { departmentId: targetEntity.id } : { assignedUserId: targetEntity.employee_id }),
      }),
  );

  const previousFacts = await queryTaskFacts({
    scopeContext,
    startDate: previousMonth,
    endDate: previousEnd,
    ...(entityType === "department" ? { departmentId: targetEntity.id } : { assignedUserId: targetEntity.employee_id }),
  });

  // Calculate metrics
  const currentMetrics = calculateAggregate(currentFacts);
  const previousMetrics = calculateAggregate(previousFacts);

  // Build executive summary
  const perfScore = currentMetrics.performance_score;
  const perfChange = calculateChange(currentMetrics.performance_score, previousMetrics.performance_score);

  let status = "healthy";
  if (perfScore === null) {
    status = "insufficient_data";
  } else if (perfScore < 50) {
    status = "critical";
  } else if (perfScore < 75) {
    status = "at_risk";
  }

  // Business health (4 key indicators)
  const businessHealth = [
    {
      key: "delivery",
      label: "Delivery Rate",
      value: currentMetrics.completion_rate,
      change_pct: calculateChange(currentMetrics.completion_rate, previousMetrics.completion_rate),
      is_alert: currentMetrics.completion_rate !== null && currentMetrics.completion_rate < 60,
    },
    {
      key: "delay",
      label: "Overdue Rate",
      value: currentMetrics.overdue_rate,
      change_pct: calculateChange(currentMetrics.overdue_rate, previousMetrics.overdue_rate),
      is_alert: currentMetrics.overdue_rate !== null && currentMetrics.overdue_rate > 20,
    },
    {
      key: "rework",
      label: "Rework Rate",
      value: currentMetrics.rejection_rate,
      change_pct: calculateChange(currentMetrics.rejection_rate, previousMetrics.rejection_rate),
      is_alert: currentMetrics.rejection_rate !== null && currentMetrics.rejection_rate > 15,
    },
    {
      key: "speed",
      label: "Approval Speed",
      value: currentMetrics.avg_approval_time, // in hours
      change_pct: calculateChange(currentMetrics.avg_approval_time, previousMetrics.avg_approval_time),
      is_alert: currentMetrics.avg_approval_time !== null && currentMetrics.avg_approval_time > 12,
    },
  ];

  // Risk synthesis
  const risks = [];
  if (currentMetrics.completion_rate !== null && currentMetrics.completion_rate < 60) {
    risks.push("Delivery rate falling below target — may miss commitments");
  }
  if (currentMetrics.overdue_rate !== null && currentMetrics.overdue_rate > 20) {
    risks.push("Execution delays escalating — investigate scheduling issues");
  }
  if (currentMetrics.rejection_rate !== null && currentMetrics.rejection_rate > 15) {
    risks.push("Quality issues rising — review approval process");
  }
  if (currentMetrics.avg_approval_time !== null && currentMetrics.avg_approval_time > 12) {
    risks.push("Approval workflow backed up — reduce handoff time");
  }

  return {
    entity_type: entityType,
    entity_id: targetEntity.id || targetEntity.employee_id,
    entity_name: targetEntity.name,
    month: monthKey(currentMonth),
    executive_summary: {
      performance_score: perfScore,
      change_pct: perfChange,
      status,
    },
    business_health: businessHealth,
    risks,
    total_tasks: currentMetrics.total_tasks,
    last_updated: nowUtc().toISOString(),
  };
}

module.exports = {
  getAnalyticsContext,
  getDepartmentComparison,
  getDepartmentTrend,
  getKpiBreakdown,
  getUserComparison,
  getUserTrend,
  getExecutiveData,
};