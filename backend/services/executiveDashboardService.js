const { pool } = require("../db");
const { AppError } = require("../lib/AppError");
const { resolveAccessibleDepartmentId } = require("../lib/departmentContext");
const { PROJECT_STATUSES, TASK_STATUSES, VERIFICATION_STATUSES, PERMISSIONS } = require("../config/constants");
const { hasPermission, isExecutiveDashboardRole } = require("./accessControlService");
const { hasOrgWideVisibility } = require("./visibilityResolutionService");
const {
  listProjectSummariesForUser,
} = require("../repositories/designProjectCatalogRepository");
const { userIdentifierMatchSql } = require("../repositories/sqlFragments");
const { instrumentModuleExports } = require("../lib/observability");

const ORGANIZATION_TIMEZONE = "Asia/Kolkata";
const KOLKATA_OFFSET_MINUTES = 330;
const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVE_PROJECT_STATUSES = new Set([PROJECT_STATUSES.ACTIVE]);
const TERMINAL_PROJECT_STATUSES = new Set([PROJECT_STATUSES.COMPLETED, PROJECT_STATUSES.RELEASED]);
const OPEN_TASK_STATUSES = new Set([
  TASK_STATUSES.ASSIGNED,
  TASK_STATUSES.IN_PROGRESS,
  TASK_STATUSES.ON_HOLD,
  TASK_STATUSES.UNDER_REVIEW,
  TASK_STATUSES.REWORK,
]);
const PAGE_SIZE_DEFAULT = 7;
const PAGE_SIZE_MAX = 50;

function normalizeKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function canSeeAllDepartments(user) {
  return hasOrgWideVisibility(user)
    || hasPermission(user, PERMISSIONS.VIEW_ALL_DEPARTMENTS_ANALYTICS);
}

function canViewExecutiveDashboard(user) {
  return isExecutiveDashboardRole(user);
}

function assertExecutiveDashboardAccess(user) {
  if (!user) {
    throw new AppError(401, "Unauthorized: User not authenticated");
  }

  if (canViewExecutiveDashboard(user)) {
    return;
  }

  throw new AppError(403, "Executive dashboard access requires Admin, CEO, or Director role");
}

function addDays(date, days) {
  return new Date(date.getTime() + days * DAY_MS);
}

function localParts(date) {
  const shifted = new Date(date.getTime() + KOLKATA_OFFSET_MINUTES * 60 * 1000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    dayOfWeek: shifted.getUTCDay(),
  };
}

function utcFromLocalMidnight(year, month, day) {
  return new Date(Date.UTC(year, month, day, 0, 0, 0, 0) - KOLKATA_OFFSET_MINUTES * 60 * 1000);
}

function startOfLocalDay(date) {
  const parts = localParts(date);
  return utcFromLocalMidnight(parts.year, parts.month, parts.day);
}

function startOfLocalWeek(date) {
  const parts = localParts(date);
  const localMidnight = utcFromLocalMidnight(parts.year, parts.month, parts.day);
  const daysSinceMonday = (parts.dayOfWeek + 6) % 7;
  return addDays(localMidnight, -daysSinceMonday);
}

function startOfLocalMonth(date) {
  const parts = localParts(date);
  return utcFromLocalMidnight(parts.year, parts.month, 1);
}

function addLocalMonths(date, months) {
  const parts = localParts(date);
  return utcFromLocalMidnight(parts.year, parts.month + months, 1);
}

function parseLocalDateBoundary(value, { endExclusive = false } = {}) {
  const raw = String(value || "").trim();
  if (!raw) {
    return null;
  }

  const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    const start = utcFromLocalMidnight(Number(year), Number(month) - 1, Number(day));
    return endExclusive ? addDays(start, 1) : start;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function getPeriodRange(periodInput = "this_week", nowInput = new Date(), customStartInput = null, customEndInput = null) {
  const now = nowInput instanceof Date ? nowInput : new Date(nowInput);
  const period = normalizeKey(periodInput) || "this_week";
  const currentWeekStart = startOfLocalWeek(now);

  if (period === "last_week") {
    const start = addDays(currentWeekStart, -7);
    const end = currentWeekStart;
    return {
      period: "last_week",
      label: "Last Week",
      start,
      end,
      previousStart: addDays(start, -7),
      previousEnd: start,
      timezone: ORGANIZATION_TIMEZONE,
    };
  }

  if (period === "this_month") {
    const start = startOfLocalMonth(now);
    const end = addLocalMonths(now, 1);
    const previousStart = addLocalMonths(start, -1);
    return {
      period: "this_month",
      label: "This Month",
      start,
      end,
      previousStart,
      previousEnd: start,
      timezone: ORGANIZATION_TIMEZONE,
    };
  }

  if (period === "custom") {
    const start = parseLocalDateBoundary(customStartInput);
    const end = parseLocalDateBoundary(customEndInput, { endExclusive: true });
    if (!start || !end || end <= start) {
      throw new AppError(400, "Custom dashboard range requires valid start and end dates");
    }
    const span = end.getTime() - start.getTime();
    return {
      period: "custom",
      label: "Custom Range",
      start,
      end,
      previousStart: new Date(start.getTime() - span),
      previousEnd: start,
      timezone: ORGANIZATION_TIMEZONE,
    };
  }

  const start = currentWeekStart;
  const end = addDays(start, 7);
  return {
    period: "this_week",
    label: "This Week",
    start,
    end,
    previousStart: addDays(start, -7),
    previousEnd: start,
    timezone: ORGANIZATION_TIMEZONE,
  };
}

function isInRange(value, start, end) {
  const date = value ? new Date(value) : null;
  return Boolean(date && !Number.isNaN(date.getTime()) && date >= start && date < end);
}

function toDate(value) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function maxDate(values) {
  return values
    .map(toDate)
    .filter(Boolean)
    .sort((left, right) => right.getTime() - left.getTime())[0] || null;
}

function clampPercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.min(100, Math.max(0, Math.round(numeric)));
}

function uniqueStrings(values) {
  return [...new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))];
}

function parsePgArray(value) {
  if (Array.isArray(value)) {
    return uniqueStrings(value);
  }
  if (typeof value !== "string") {
    return [];
  }
  return uniqueStrings(
    value
      .replace(/^{|}$/g, "")
      .split(",")
      .map((item) => item.replace(/^"|"$/g, "")),
  );
}

function normalizeAssigneeIds(value) {
  if (Array.isArray(value)) {
    return uniqueStrings(value);
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return uniqueStrings(parsed);
      }
    } catch (_error) {
      return uniqueStrings([value]);
    }
  }
  return [];
}

function departmentMatchesFilter(department, requested) {
  const requestedKey = normalizeKey(requested);
  return requestedKey
    && (
      normalizeKey(department.id) === requestedKey
      || normalizeKey(department.name) === requestedKey
    );
}

async function listDashboardDepartments(user, client = pool) {
  const allDepartments = canSeeAllDepartments(user);
  const params = [];
  let where = "WHERE COALESCE(is_active, TRUE) = TRUE";

  if (!allDepartments) {
    const departmentId = resolveAccessibleDepartmentId(user, user?.department_id, "A department is required for executive dashboard access");
    params.push(departmentId);
    where += ` AND id = $${params.length}`;
  }

  const result = await client.query(
    `
      SELECT id, name
      FROM departments
      ${where}
      ORDER BY
        CASE LOWER(id)
          WHEN 'design' THEN 0
          WHEN 'control' THEN 1
          ELSE 2
        END,
        name ASC,
        id ASC
    `,
    params,
  );

  const departments = result.rows.map((row) => ({
    id: row.id,
    label: row.name || row.id,
    name: row.name || row.id,
  }));

  if (departments.length > 0 || allDepartments || !user?.department_id) {
    return departments;
  }

  return [{
    id: user.department_id,
    label: user.department?.name || user.department_id,
    name: user.department?.name || user.department_id,
  }];
}

function resolveDepartmentSelection(user, requestedDepartment, departments) {
  const requested = normalizeKey(requestedDepartment);
  const allDepartments = canSeeAllDepartments(user);

  if (requested && requested !== "all" && requested !== "all_departments") {
    const matched = departments.find((department) => departmentMatchesFilter(department, requested));
    if (!matched) {
      throw new AppError(400, "Invalid department filter");
    }
    resolveAccessibleDepartmentId(user, matched.id, "You do not have permission to access another department");
    return {
      id: matched.id,
      label: matched.label,
      mode: "department",
    };
  }

  if (allDepartments) {
    return {
      id: null,
      label: "All Departments",
      mode: "all",
    };
  }

  const ownDepartment = departments.find((department) => department.id === user?.department_id) || departments[0];
  if (!ownDepartment) {
    throw new AppError(400, "A department is required for executive dashboard access");
  }
  return {
    id: ownDepartment.id,
    label: ownDepartment.label,
    mode: "department",
  };
}

function normalizeEnumParam(value, allowed, fallback, label) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return fallback;
  }

  const normalized = normalizeKey(raw);
  if (allowed.includes(normalized)) {
    return normalized;
  }

  throw new AppError(400, `Invalid ${label} filter`);
}

function normalizePositiveIntegerParam(value, fallback, label, max = null) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return fallback;
  }

  if (!/^\d+$/.test(raw)) {
    throw new AppError(400, `Invalid ${label}`);
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || (max !== null && parsed > max)) {
    throw new AppError(400, `Invalid ${label}`);
  }

  return parsed;
}

function normalizeDashboardQuery(query = {}, user, departments) {
  const selectedDepartment = resolveDepartmentSelection(user, query.department, departments);
  const period = normalizeEnumParam(query.period, ["this_week", "last_week", "this_month", "custom"], "this_week", "period");
  const periodRange = getPeriodRange(period, new Date(), query.start, query.end);
  const page = normalizePositiveIntegerParam(query.page, 1, "page");
  const pageSize = normalizePositiveIntegerParam(query.page_size ?? query.pageSize, PAGE_SIZE_DEFAULT, "page_size", PAGE_SIZE_MAX);

  return {
    selectedDepartment,
    periodRange,
    status: normalizeEnumParam(query.status, [
      "all",
      "in_progress",
      "pending_approval",
      "rework_required",
      "blocked",
      "overdue",
      "released",
      "not_started",
    ], "all", "status"),
    risk: normalizeEnumParam(query.risk, ["all", "low", "medium", "high"], "all", "risk"),
    search: String(query.search || "").trim(),
    page,
    pageSize,
  };
}

function isMissingOptionalSnapshotRelation(error) {
  if (error?.code !== "42P01") {
    return false;
  }

  const relation = String(error.relation || error.message || "");
  return relation.includes("workflow_completion_snapshots");
}

function buildProjectSupplementsQuery({ includeSnapshots = true } = {}) {
  const snapshotSelect = includeSnapshots
    ? "snapshot_rollup.last_snapshot_at"
    : "NULL::timestamptz AS last_snapshot_at";
  const snapshotJoin = includeSnapshots ? `
      LEFT JOIN LATERAL (
        SELECT MAX(snapshot.captured_at) AS last_snapshot_at
        FROM design.workflow_completion_snapshots snapshot
        WHERE snapshot.project_id = p.id
      ) snapshot_rollup ON TRUE` : "";

  return `
      SELECT
        p.id::text AS project_id,
        p.status_changed_at,
        p.completed_at AS project_completed_at,
        p.updated_at AS project_updated_at,
        p.project_leader_id,
        project_leader.name AS project_leader_name,
        p.team_lead_id,
        team_lead.name AS direct_team_lead_name,
        task_rollup.effective_due_at,
        task_rollup.last_task_at,
        task_rollup.pending_approval_count,
        task_rollup.pending_over_24_count,
        task_rollup.pending_over_48_count,
        task_rollup.rework_count,
        task_rollup.active_task_count,
        task_rollup.pending_approval_with_names,
        workflow_rollup.current_stage,
        workflow_rollup.current_stage_order,
        workflow_rollup.current_assignee_names,
        workflow_rollup.two_d_owner_names,
        workflow_rollup.three_d_owner_names,
        workflow_rollup.control_owner_names,
        workflow_rollup.last_workflow_at,
        audit_rollup.last_audit_at,
        ${snapshotSelect},
        fixture_rollup.last_fixture_at
      FROM design.projects p
      LEFT JOIN users project_leader
        ON ${userIdentifierMatchSql("project_leader", "p.project_leader_id")}
      LEFT JOIN users team_lead
        ON ${userIdentifierMatchSql("team_lead", "p.team_lead_id")}
      LEFT JOIN LATERAL (
        SELECT
          MIN(COALESCE(t.due_date, t.sla_due_date, t.deadline)) FILTER (
            WHERE COALESCE(t.status, '') NOT IN ('closed', 'cancelled')
          ) AS effective_due_at,
          MAX(GREATEST(
            COALESCE(t.updated_at, t.created_at),
            COALESCE(t.submitted_at, t.created_at),
            COALESCE(t.approved_at, t.created_at),
            COALESCE(t.completed_at, t.created_at),
            COALESCE(t.closed_at, t.created_at)
          )) AS last_task_at,
          COUNT(DISTINCT t.id) FILTER (
            WHERE t.status = 'under_review'
              AND COALESCE(t.verification_status, 'pending') = 'pending'
          )::integer AS pending_approval_count,
          COUNT(DISTINCT t.id) FILTER (
            WHERE t.status = 'under_review'
              AND COALESCE(t.verification_status, 'pending') = 'pending'
              AND COALESCE(t.submitted_at, t.completed_at, t.updated_at, t.created_at) <= NOW() - INTERVAL '24 hours'
          )::integer AS pending_over_24_count,
          COUNT(DISTINCT t.id) FILTER (
            WHERE t.status = 'under_review'
              AND COALESCE(t.verification_status, 'pending') = 'pending'
              AND COALESCE(t.submitted_at, t.completed_at, t.updated_at, t.created_at) <= NOW() - INTERVAL '48 hours'
          )::integer AS pending_over_48_count,
          COUNT(DISTINCT t.id) FILTER (
            WHERE t.status = 'rework'
               OR COALESCE(t.verification_status, '') = 'rejected'
               OR COALESCE(t.rejection_count, 0) > 0
          )::integer AS rework_count,
          COUNT(DISTINCT t.id) FILTER (
            WHERE t.status IN ('assigned', 'in_progress', 'on_hold', 'under_review', 'rework')
          )::integer AS active_task_count,
          ARRAY_REMOVE(ARRAY_AGG(DISTINCT pending_assignee.name) FILTER (
            WHERE t.status = 'under_review'
              AND COALESCE(t.verification_status, 'pending') = 'pending'
              AND pending_assignee.name IS NOT NULL
          ), NULL) AS pending_approval_with_names
        FROM tasks t
        LEFT JOIN users pending_assignee
          ON ${userIdentifierMatchSql("pending_assignee", "t.assigned_to")}
        WHERE t.project_id = p.id
          AND COALESCE(t.status, '') <> 'cancelled'
      ) task_rollup ON TRUE
      LEFT JOIN LATERAL (
        SELECT MAX(f.updated_at) AS last_fixture_at
        FROM design.fixtures f
        WHERE f.project_id = p.id
      ) fixture_rollup ON TRUE
      LEFT JOIN LATERAL (
        WITH progress_rows AS (
          SELECT
            fwp.stage_name,
            fwp.stage_order,
            fwp.status,
            fwp.assigned_to,
            assignee.name AS assigned_name,
            GREATEST(
              COALESCE(fwp.updated_at, '-infinity'::timestamptz),
              COALESCE(fwp.completed_at, '-infinity'::timestamptz),
              COALESCE(fwp.assigned_at, '-infinity'::timestamptz),
              COALESCE(fwp.started_at, '-infinity'::timestamptz)
            ) AS touched_at
          FROM design.fixtures f
          JOIN fixture_workflow_progress fwp
            ON fwp.fixture_id = f.id
            AND fwp.department_id = p.department_id
          LEFT JOIN users assignee
            ON ${userIdentifierMatchSql("assignee", "fwp.assigned_to")}
          WHERE f.project_id = p.id
        ),
        current_stage AS (
          SELECT stage_name, stage_order
          FROM progress_rows
          WHERE COALESCE(status, '') <> 'APPROVED'
          ORDER BY stage_order ASC NULLS LAST, stage_name ASC
          LIMIT 1
        )
        SELECT
          current_stage.stage_name AS current_stage,
          current_stage.stage_order AS current_stage_order,
          ARRAY_REMOVE(ARRAY_AGG(DISTINCT progress_rows.assigned_name) FILTER (
            WHERE progress_rows.assigned_name IS NOT NULL
              AND COALESCE(progress_rows.status, '') <> 'APPROVED'
          ), NULL) AS current_assignee_names,
          ARRAY_REMOVE(ARRAY_AGG(DISTINCT progress_rows.assigned_name) FILTER (
            WHERE progress_rows.assigned_name IS NOT NULL
              AND LOWER(COALESCE(progress_rows.stage_name, '')) LIKE '%2d%'
          ), NULL) AS two_d_owner_names,
          ARRAY_REMOVE(ARRAY_AGG(DISTINCT progress_rows.assigned_name) FILTER (
            WHERE progress_rows.assigned_name IS NOT NULL
              AND LOWER(COALESCE(progress_rows.stage_name, '')) LIKE '%3d%'
          ), NULL) AS three_d_owner_names,
          ARRAY_REMOVE(ARRAY_AGG(DISTINCT progress_rows.assigned_name) FILTER (
            WHERE progress_rows.assigned_name IS NOT NULL
              AND LOWER(COALESCE(progress_rows.stage_name, '')) NOT LIKE '%2d%'
              AND LOWER(COALESCE(progress_rows.stage_name, '')) NOT LIKE '%3d%'
          ), NULL) AS control_owner_names,
          MAX(NULLIF(progress_rows.touched_at, '-infinity'::timestamptz)) AS last_workflow_at
        FROM progress_rows
        LEFT JOIN current_stage ON TRUE
        GROUP BY current_stage.stage_name, current_stage.stage_order
      ) workflow_rollup ON TRUE
      LEFT JOIN LATERAL (
        SELECT MAX(a.timestamp) AS last_audit_at
        FROM audit_logs a
        WHERE a.target_id = p.id::text
           OR a.metadata ->> 'project_id' = p.id::text
      ) audit_rollup ON TRUE
      ${snapshotJoin}
      WHERE p.id::text = ANY($1::text[])
    `;
}

async function queryProjectSupplements(projectIds, client = pool) {
  if (!projectIds.length) {
    return new Map();
  }

  let rows;
  try {
    rows = (await client.query(buildProjectSupplementsQuery({ includeSnapshots: true }), [projectIds])).rows;
  } catch (error) {
    if (!isMissingOptionalSnapshotRelation(error)) {
      throw error;
    }
    rows = (await client.query(buildProjectSupplementsQuery({ includeSnapshots: false }), [projectIds])).rows;
  }

  return new Map(rows.map((row) => [row.project_id, row]));
}
async function queryCompletionEvents(projectIds, client = pool) {
  if (!projectIds.length) {
    return new Map();
  }

  const queryWithSnapshots = `
    SELECT project_id, event_at
    FROM (
      SELECT p.id::text AS project_id, p.completed_at AS event_at
      FROM design.projects p
      WHERE p.id::text = ANY($1::text[])
        AND p.completed_at IS NOT NULL

      UNION ALL

      SELECT a.target_id AS project_id, a.timestamp AS event_at
      FROM audit_logs a
      WHERE a.target_id = ANY($1::text[])
        AND a.target_type = 'design_project'
        AND a.action_type IN ('PROJECT_RELEASED')

      UNION ALL

      SELECT snapshot.project_id::text AS project_id, snapshot.captured_at AS event_at
      FROM design.workflow_completion_snapshots snapshot
      WHERE snapshot.project_id::text = ANY($1::text[])
        AND snapshot.trigger IN ('project_release', 'workflow_release')
    ) events
    WHERE event_at IS NOT NULL
    ORDER BY project_id ASC, event_at ASC
  `;

  const queryWithoutSnapshots = `
    SELECT project_id, event_at
    FROM (
      SELECT p.id::text AS project_id, p.completed_at AS event_at
      FROM design.projects p
      WHERE p.id::text = ANY($1::text[])
        AND p.completed_at IS NOT NULL

      UNION ALL

      SELECT a.target_id AS project_id, a.timestamp AS event_at
      FROM audit_logs a
      WHERE a.target_id = ANY($1::text[])
        AND a.target_type = 'design_project'
        AND a.action_type IN ('PROJECT_RELEASED')
    ) events
    WHERE event_at IS NOT NULL
    ORDER BY project_id ASC, event_at ASC
  `;

  let rows;
  try {
    rows = (await client.query(queryWithSnapshots, [projectIds])).rows;
  } catch (error) {
    if (!isMissingOptionalSnapshotRelation(error)) {
      throw error;
    }
    rows = (await client.query(queryWithoutSnapshots, [projectIds])).rows;
  }

  const eventsByProject = new Map();
  for (const row of rows) {
    if (!eventsByProject.has(row.project_id)) {
      eventsByProject.set(row.project_id, []);
    }
    eventsByProject.get(row.project_id).push(toDate(row.event_at));
  }
  return eventsByProject;
}

async function queryOpenApprovalTasks(projectIds, client = pool) {
  if (!projectIds.length) {
    return [];
  }

  const result = await client.query(
    `
      SELECT
        t.id,
        t.project_id::text AS project_id,
        t.department_id,
        t.assigned_to,
        t.assignee_ids,
        t.approval_stage,
        t.created_at,
        t.updated_at,
        t.submitted_at,
        t.completed_at
      FROM tasks t
      WHERE t.project_id::text = ANY($1::text[])
        AND t.status = 'under_review'
        AND COALESCE(t.verification_status, 'pending') = 'pending'
    `,
    [projectIds],
  );

  return result.rows;
}

function isActiveProject(project) {
  return ACTIVE_PROJECT_STATUSES.has(String(project.project_status || PROJECT_STATUSES.ACTIVE));
}

function isTerminalProject(project) {
  return TERMINAL_PROJECT_STATUSES.has(String(project.project_status || PROJECT_STATUSES.ACTIVE));
}

function getCompletionEventInRange(projectId, eventsByProject, start, end) {
  return (eventsByProject.get(projectId) || []).find((eventAt) => isInRange(eventAt, start, end)) || null;
}

function isApprovalAssignedToUser(task, user) {
  const employeeId = String(user?.employee_id || "").trim();
  if (!employeeId) {
    return false;
  }
  const assigneeIds = normalizeAssigneeIds(task.assignee_ids);
  return task.assigned_to === employeeId || assigneeIds.includes(employeeId);
}

function canApprovalTaskBeApprovedByUser(task, user) {
  const qualityApproval = normalizeKey(task.approval_stage) === "quality";
  const permission = qualityApproval ? PERMISSIONS.APPROVE_QUALITY : PERMISSIONS.APPROVE_COMPLETED_TASK;

  if (!hasPermission(user, permission)) {
    return false;
  }

  if (!canSeeAllDepartments(user) && user?.department_id !== task.department_id) {
    return false;
  }

  if (!hasPermission(user, PERMISSIONS.SELF_APPROVE) && isApprovalAssignedToUser(task, user)) {
    return false;
  }

  return true;
}

function namesPreview(names, fallback = "Unassigned") {
  const values = uniqueStrings(names);
  if (!values.length) {
    return fallback;
  }
  if (values.length <= 2) {
    return values.join(", ");
  }
  return `${values.slice(0, 2).join(", ")} +${values.length - 2}`;
}

function buildProjectModels(projectSummaries, supplementsByProject, eventsByProject, periodRange, now) {
  return projectSummaries.map((project) => {
    const supplement = supplementsByProject.get(project.project_id) || {};
    const completedInPeriod = getCompletionEventInRange(project.project_id, eventsByProject, periodRange.start, periodRange.end);
    const completedInPreviousPeriod = getCompletionEventInRange(
      project.project_id,
      eventsByProject,
      periodRange.previousStart,
      periodRange.previousEnd,
    );
    const progress = isTerminalProject(project) ? 100 : clampPercent(project.completion_percent);
    const dueAt = toDate(supplement.effective_due_at);
    const lastUpdated = maxDate([
      project.updated_at,
      supplement.project_updated_at,
      supplement.last_task_at,
      supplement.last_workflow_at,
      supplement.last_fixture_at,
      supplement.last_audit_at,
      supplement.last_snapshot_at,
    ]) || toDate(project.created_at);
    const active = isActiveProject(project);
    const pendingApprovalCount = Number(supplement.pending_approval_count || 0);
    const pendingOver24 = Number(supplement.pending_over_24_count || 0);
    const pendingOver48 = Number(supplement.pending_over_48_count || 0);
    const reworkCount = Number(supplement.rework_count || 0);
    const activeTaskCount = Number(supplement.active_task_count || project.active_tasks || 0);
    const stale = Boolean(lastUpdated && now.getTime() - lastUpdated.getTime() >= 7 * DAY_MS);
    const dueSoon = Boolean(dueAt && dueAt >= now && dueAt.getTime() - now.getTime() <= 7 * DAY_MS);
    const overdue = active && Boolean(dueAt && dueAt < now);
    const atRisk = active && !overdue && (
      pendingOver24 > 0
      || reworkCount > 0
      || stale
      || (dueSoon && progress < 100)
    );
    const notStarted = active && progress <= 0 && activeTaskCount === 0;
    const onTrack = active && !overdue && !atRisk && !notStarted;
    const twoDOwners = parsePgArray(supplement.two_d_owner_names);
    const threeDOwners = parsePgArray(supplement.three_d_owner_names);
    const currentAssignees = parsePgArray(supplement.current_assignee_names);
    const controlOwners = parsePgArray(supplement.control_owner_names);
    const approvalWith = parsePgArray(supplement.pending_approval_with_names);
    const primaryOwnerNames = uniqueStrings([
      supplement.project_leader_name,
      supplement.direct_team_lead_name,
      project.team_lead_name,
      project.uploaded_by_name,
      ...currentAssignees,
    ]);
    const missingOwner = active && primaryOwnerNames.length === 0 && !project.team_lead_id && !supplement.project_leader_id;
    const risk = overdue || pendingOver48 > 0 || reworkCount > 0
      ? "high"
      : atRisk
        ? "medium"
        : "low";
    const status = (() => {
      if (isTerminalProject(project)) return "released";
      if (overdue) return "overdue";
      if (pendingApprovalCount > 0) return "pending_approval";
      if (reworkCount > 0) return "rework_required";
      if (notStarted) return "not_started";
      return "in_progress";
    })();

    return {
      ...project,
      progress,
      due_at: dueAt ? dueAt.toISOString() : null,
      last_updated_at: lastUpdated ? lastUpdated.toISOString() : null,
      current_stage: supplement.current_stage || project.overall_stage?.label || (notStarted ? "Not Started" : "In Progress"),
      current_assignee: namesPreview(currentAssignees),
      two_d_owner: namesPreview(twoDOwners),
      three_d_owner: namesPreview(threeDOwners),
      control_owner: namesPreview(controlOwners, namesPreview(primaryOwnerNames)),
      project_owner: namesPreview(primaryOwnerNames),
      approval_with: namesPreview(approvalWith, pendingApprovalCount > 0 ? "Pending approval" : "None"),
      completed_in_period_at: completedInPeriod ? completedInPeriod.toISOString() : null,
      completed_in_previous_period_at: completedInPreviousPeriod ? completedInPreviousPeriod.toISOString() : null,
      is_active_project: active,
      is_terminal_project: isTerminalProject(project),
      is_overdue: overdue,
      is_at_risk: atRisk,
      is_on_track: onTrack,
      is_not_started: notStarted,
      is_stale: stale,
      missing_owner: missingOwner,
      pending_approval_count: pendingApprovalCount,
      pending_over_24_count: pendingOver24,
      pending_over_48_count: pendingOver48,
      rework_count: reworkCount,
      active_task_count: activeTaskCount,
      status,
      risk,
    };
  });
}

function percent(part, total) {
  if (!total) {
    return 0;
  }
  return Math.round((part / total) * 100);
}

function compareDelta(current, previous, noun = "vs last period") {
  const delta = current - previous;
  if (delta > 0) {
    return { direction: "up", text: `${delta} ${noun}` };
  }
  if (delta < 0) {
    return { direction: "down", text: `${Math.abs(delta)} ${noun}` };
  }
  return { direction: "neutral", text: `No change ${noun}` };
}

function buildKpis(projects, approvalTasks, user, periodRange, now = new Date()) {
  const activeProjects = projects.filter((project) => project.is_active_project);
  const completedThisPeriod = projects.filter((project) => project.completed_in_period_at);
  const completedPrevious = projects.filter((project) => project.completed_in_previous_period_at);
  const onTrack = projects.filter((project) => project.is_on_track);
  const atRisk = projects.filter((project) => project.is_at_risk);
  const overdue = projects.filter((project) => project.is_overdue);
  const pendingApprovals = approvalTasks.length;
  const pendingOver24 = approvalTasks.filter((task) => {
    const pendingSince = toDate(task.submitted_at || task.completed_at || task.updated_at || task.created_at);
    return Boolean(pendingSince && now.getTime() - pendingSince.getTime() >= DAY_MS);
  }).length;
  const completedComparison = compareDelta(completedThisPeriod.length, completedPrevious.length, periodRange.period === "this_week" ? "vs last week" : "vs previous period");

  return [
    {
      id: "total_active_projects",
      label: "Total Active Projects",
      value: activeProjects.length,
      detail: "Excludes on hold, released, and completed",
      tooltip: "Count of visible projects currently in the active project lifecycle state.",
      tone: "blue",
    },
    {
      id: "completed_this_period",
      label: `Projects Completed ${periodRange.period === "this_month" ? "This Month" : periodRange.period === "last_week" ? "Last Week" : "This Week"}`,
      value: completedThisPeriod.length,
      detail: completedComparison.text,
      trend: completedComparison.direction,
      tooltip: "Distinct projects with a completed_at value, project release audit, or workflow completion snapshot inside the selected period.",
      tone: "green",
      featured: true,
    },
    {
      id: "on_track",
      label: "On Track",
      value: onTrack.length,
      detail: `${percent(onTrack.length, activeProjects.length)}% of active projects`,
      tooltip: "Active projects that are not overdue, at risk, or not started.",
      tone: "green",
    },
    {
      id: "at_risk",
      label: "At Risk",
      value: atRisk.length,
      detail: `${percent(atRisk.length, activeProjects.length)}% of active projects`,
      tooltip: "Active projects with due-soon incomplete work, pending approvals over 24 hours, rework, blockers, or no recent activity.",
      tone: "amber",
    },
    {
      id: "pending_approval",
      label: "Pending Approval",
      value: pendingApprovals,
      detail: `${pendingOver24} over 24h`,
      tooltip: "Unresolved approval requests in the selected scope. Duplicate project joins are counted once per task.",
      tone: "blue",
    },
    {
      id: "overdue",
      label: "Overdue",
      value: overdue.length,
      detail: `${percent(overdue.length, activeProjects.length)}% of active projects`,
      tooltip: "Active projects whose effective due date is before the current time.",
      tone: "red",
    },
  ];
}

function buildNeedsAttention(projects, approvalTasks, now = new Date()) {
  const overdue = projects.filter((project) => project.is_overdue).length;
  const pending24 = approvalTasks.filter((task) => {
    const pendingSince = toDate(task.submitted_at || task.completed_at || task.updated_at || task.created_at);
    return Boolean(pendingSince && now.getTime() - pendingSince.getTime() >= DAY_MS);
  }).length;
  const stale = projects.filter((project) => project.is_stale && project.is_active_project).length;
  const missingOwners = projects.filter((project) => project.missing_owner).length;

  return [
    overdue > 0 ? {
      id: "overdue_projects",
      label: "Overdue Projects",
      count: overdue,
      description: "Past effective due date",
      action: { status: "overdue" },
    } : null,
    pending24 > 0 ? {
      id: "approvals_pending_24h",
      label: "Approvals Pending > 24h",
      count: pending24,
      description: "Requires review",
      action: { status: "pending_approval" },
    } : null,
    stale > 0 ? {
      id: "no_recent_update",
      label: "No Recent Update",
      count: stale,
      description: "No progress in 7+ days",
      action: { status: "all", risk: "medium" },
    } : null,
    missingOwners > 0 ? {
      id: "missing_owners",
      label: "Missing Owners",
      count: missingOwners,
      description: "Projects without assigned owners",
      action: { status: "all" },
    } : null,
  ].filter(Boolean);
}

function buildDepartmentOverview(projects, selectedDepartment, periodRange) {
  const completed = projects.filter((project) => project.completed_in_period_at).length;
  const delayed = projects.filter((project) => project.is_overdue || project.is_at_risk).length;
  const notStarted = projects.filter((project) => project.is_not_started).length;
  const active = Math.max(0, projects.length - completed - delayed - notStarted);
  const previousCompleted = projects.filter((project) => project.completed_in_previous_period_at).length;
  const comparison = compareDelta(completed, previousCompleted, periodRange.period === "this_week" ? "completion vs last week" : "completion vs previous period");
  const total = projects.length;

  return {
    title: `${selectedDepartment.label} Overview (${periodRange.label})`,
    total_projects: total,
    comparison,
    segments: [
      { id: "completed", label: "Completed", value: completed, percent: percent(completed, total), tone: "green" },
      { id: "active", label: "Active", value: active, percent: percent(active, total), tone: "blue" },
      { id: "delayed", label: "Delayed", value: delayed, percent: percent(delayed, total), tone: "red" },
      { id: "not_started", label: "Not Started", value: notStarted, percent: percent(notStarted, total), tone: "neutral" },
    ],
  };
}

function buildDepartmentComparison(projects, departments) {
  const departmentIds = new Set(projects.map((project) => project.department_id).filter(Boolean));
  const configuredDepartments = departments.filter((department) => departmentIds.has(department.id));
  const comparisonDepartments = configuredDepartments.length > 0
    ? configuredDepartments
    : departments;

  return comparisonDepartments.map((department) => {
    const rows = projects.filter((project) => project.department_id === department.id);
    const activeRows = rows.filter((project) => project.is_active_project);
    return {
      department_id: department.id,
      department_name: department.label,
      total_projects: rows.length,
      completed_this_period: rows.filter((project) => project.completed_in_period_at).length,
      on_track: rows.filter((project) => project.is_on_track).length,
      on_track_percent: percent(rows.filter((project) => project.is_on_track).length, activeRows.length),
      at_risk: rows.filter((project) => project.is_at_risk).length,
      at_risk_percent: percent(rows.filter((project) => project.is_at_risk).length, activeRows.length),
      overdue: rows.filter((project) => project.is_overdue).length,
      overdue_percent: percent(rows.filter((project) => project.is_overdue).length, activeRows.length),
    };
  });
}

function buildOwnerWorkload(projects, selectedDepartment) {
  const activeProjects = projects.filter((project) => project.is_active_project);
  const groups = new Map();

  for (const project of activeProjects) {
    const ownerKey = project.project_owner === "Unassigned" ? "__unassigned__" : project.project_owner;
    if (!groups.has(ownerKey)) {
      groups.set(ownerKey, {
        owner_id: ownerKey,
        owner_name: ownerKey === "__unassigned__" ? "Unassigned" : project.project_owner,
        active_projects: 0,
      });
    }
    groups.get(ownerKey).active_projects += 1;
  }

  const items = [...groups.values()]
    .sort((left, right) => right.active_projects - left.active_projects || left.owner_name.localeCompare(right.owner_name))
    .slice(0, 5);
  const maxCount = Math.max(1, ...items.map((item) => item.active_projects));

  return {
    title: selectedDepartment.mode === "all" ? "Owner Workload" : `Owner Workload - ${selectedDepartment.label}`,
    basis: "Relative active project count within the selected scope",
    items: items.map((item) => ({
      ...item,
      workload_percent: Math.round((item.active_projects / maxCount) * 100),
    })),
  };
}

function buildApprovalsSummary(approvalTasks, user, now = new Date()) {
  const myApproval = approvalTasks.filter((task) => canApprovalTaskBeApprovedByUser(task, user)).length;
  const over24 = approvalTasks.filter((task) => {
    const pendingSince = toDate(task.submitted_at || task.completed_at || task.updated_at || task.created_at);
    return Boolean(pendingSince && now.getTime() - pendingSince.getTime() >= DAY_MS);
  }).length;
  const over48 = approvalTasks.filter((task) => {
    const pendingSince = toDate(task.submitted_at || task.completed_at || task.updated_at || task.created_at);
    return Boolean(pendingSince && now.getTime() - pendingSince.getTime() >= 2 * DAY_MS);
  }).length;

  return {
    pending_my_approval: myApproval,
    pending_over_24h: over24,
    pending_over_48h: over48,
  };
}

function buildTableRow(project) {
  return {
    project_id: project.project_id,
    project_no: project.project_no,
    project_name: project.project_name,
    customer_name: project.customer_name || "No customer",
    department_id: project.department_id,
    department_name: project.department_name || project.department_id,
    fixture_count: project.total_fixtures,
    two_d_owner: project.two_d_owner,
    three_d_owner: project.three_d_owner,
    control_owner: project.control_owner,
    project_owner: project.project_owner,
    current_stage: project.current_stage,
    current_control_stage: project.current_stage,
    current_assignee: project.current_assignee,
    assigned_to: project.current_assignee,
    approval_with: project.approval_with,
    progress: project.progress,
    status: project.status,
    risk: project.risk,
    due_at: project.due_at,
    last_updated_at: project.last_updated_at,
    is_overdue: project.is_overdue,
  };
}

function applyTableFilters(rows, { status, risk, search }) {
  const searchKey = String(search || "").trim().toLowerCase();
  return rows.filter((row) => {
    if (status !== "all" && row.status !== status) {
      return false;
    }
    if (risk !== "all" && row.risk !== risk) {
      return false;
    }
    if (searchKey) {
      const haystack = [
        row.project_no,
        row.project_name,
        row.customer_name,
        row.department_name,
        row.project_owner,
        row.current_stage,
        row.current_assignee,
      ].join(" ").toLowerCase();
      if (!haystack.includes(searchKey)) {
        return false;
      }
    }
    return true;
  });
}

function buildExecutiveDashboardModel({
  user,
  departments,
  projectSummaries,
  supplementsByProject,
  completionEventsByProject,
  approvalTasks,
  filters,
  now = new Date(),
}) {
  const allProjects = buildProjectModels(projectSummaries, supplementsByProject, completionEventsByProject, filters.periodRange, now);
  const projects = filters.selectedDepartment.id
    ? allProjects.filter((project) => project.department_id === filters.selectedDepartment.id)
    : allProjects;
  const scopedProjectIds = new Set(projects.map((project) => project.project_id));
  const scopedApprovalTasks = approvalTasks.filter((task) => scopedProjectIds.has(String(task.project_id)));
  const tableRows = projects.map(buildTableRow);
  const filteredRows = applyTableFilters(tableRows, filters);
  const pageCount = Math.ceil(filteredRows.length / filters.pageSize);
  const safePage = pageCount === 0 ? 1 : Math.min(filters.page, pageCount);
  const start = (safePage - 1) * filters.pageSize;

  return {
    timezone: ORGANIZATION_TIMEZONE,
    selected_department: filters.selectedDepartment,
    filters: {
      department: filters.selectedDepartment.id || "all",
      period: filters.periodRange.period,
      period_label: filters.periodRange.label,
      status: filters.status,
      risk: filters.risk,
      search: filters.search,
      start: filters.periodRange.start.toISOString(),
      end: filters.periodRange.end.toISOString(),
    },
    departments,
    kpis: buildKpis(projects, scopedApprovalTasks, user, filters.periodRange, now),
    needs_attention: buildNeedsAttention(projects, scopedApprovalTasks, now),
    overview: buildDepartmentOverview(projects, filters.selectedDepartment, filters.periodRange),
    department_comparison: buildDepartmentComparison(allProjects, departments),
    owner_workload: buildOwnerWorkload(projects, filters.selectedDepartment),
    approvals_summary: buildApprovalsSummary(scopedApprovalTasks, user, now),
    table: {
      rows: filteredRows.slice(start, start + filters.pageSize),
      page: safePage,
      page_size: filters.pageSize,
      total_rows: filteredRows.length,
      total_pages: pageCount,
    },
  };
}

async function getExecutiveDashboardForUser(user, query = {}, client = pool) {
  assertExecutiveDashboardAccess(user);

  const departments = await listDashboardDepartments(user, client);
  const filters = normalizeDashboardQuery(query, user, departments);
  const projectSummaries = await listProjectSummariesForUser(
    user,
    { departmentId: null },
    client,
  );
  const projectIds = projectSummaries.map((project) => project.project_id).filter(Boolean);
  const [supplementsByProject, completionEventsByProject, approvalTasks] = await Promise.all([
    queryProjectSupplements(projectIds, client),
    queryCompletionEvents(projectIds, client),
    queryOpenApprovalTasks(projectIds, client),
  ]);

  return buildExecutiveDashboardModel({
    user,
    departments,
    projectSummaries,
    supplementsByProject,
    completionEventsByProject,
    approvalTasks,
    filters,
    now: new Date(),
  });
}

module.exports = instrumentModuleExports("service.executiveDashboardService", {
  assertExecutiveDashboardAccess,
  buildExecutiveDashboardModel,
  canApprovalTaskBeApprovedByUser,
  canViewExecutiveDashboard,
  getExecutiveDashboardForUser,
  getPeriodRange,
  normalizeDashboardQuery,
  queryCompletionEvents,
  queryProjectSupplements,
});
