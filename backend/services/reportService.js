const { pool } = require("../db");
const { AppError } = require("../lib/AppError");
const { logger } = require("../lib/logger");
const { instrumentModuleExports } = require("../lib/observability");
const { TASK_STATUSES } = require("../config/constants");
const { listTasksByAccess } = require("../repositories/tasksRepository");
const { getTaskAccess, getVisibleUserIds, isAdmin } = require("./accessControlService");

const REPORTABLE_STATUSES = new Set([
  TASK_STATUSES.ASSIGNED,
  TASK_STATUSES.IN_PROGRESS,
  TASK_STATUSES.ON_HOLD,
  TASK_STATUSES.UNDER_REVIEW,
  TASK_STATUSES.REWORK,
  TASK_STATUSES.CLOSED,
]);

function csvValue(value) {
  if (value === null || value === undefined) {
    return "";
  }

  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows, headers) {
  return [
    headers.map((header) => csvValue(header.label)).join(","),
    ...rows.map((row) => headers.map((header) => csvValue(row[header.key])).join(",")),
  ].join("\n");
}

function isOverdue(task) {
  return task.deadline && new Date(task.deadline) < new Date() && task.status !== TASK_STATUSES.CLOSED;
}

function normalizeStatusFilter(status) {
  if (!status || status === "all") {
    return null;
  }

  if (status === "review") {
    return TASK_STATUSES.UNDER_REVIEW;
  }

  if (!REPORTABLE_STATUSES.has(status)) {
    throw new AppError(400, "Invalid status filter");
  }

  return status;
}

function parseDateStart(value) {
  if (!value) {
    return null;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseDateEnd(value) {
  if (!value) {
    return null;
  }

  const parsed = new Date(`${value}T23:59:59.999Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function addDateBounds(fieldName, startDate, endDate, params) {
  const clauses = [];

  if (startDate) {
    params.push(startDate);
    clauses.push(`${fieldName} >= $${params.length}`);
  }

  if (endDate) {
    params.push(endDate);
    clauses.push(`${fieldName} <= $${params.length}`);
  }

  return clauses.join(" AND ");
}

function formatReportDate(value) {
  if (!value) {
    return "";
  }

  const normalizedValue = String(value).trim();
  const isoDateMatch = normalizedValue.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T|\s)/);

  if (isoDateMatch) {
    const [, year, month, day] = isoDateMatch;
    return `${day}/${month}/${year}`;
  }

  const parsedDate = value instanceof Date ? value : new Date(normalizedValue);
  if (Number.isNaN(parsedDate.getTime())) {
    return normalizedValue;
  }

  const day = String(parsedDate.getUTCDate()).padStart(2, "0");
  const month = String(parsedDate.getUTCMonth() + 1).padStart(2, "0");
  const year = parsedDate.getUTCFullYear();
  return `${day}/${month}/${year}`;
}

function formatReworkHistory(reworkDates = []) {
  if (!Array.isArray(reworkDates) || reworkDates.length === 0) {
    return "";
  }

  return reworkDates
    .map((reworkDate) => formatReportDate(reworkDate))
    .filter(Boolean)
    .map((formattedDate, index, entries) => (
      index === entries.length - 1
        ? formattedDate
        : `~~${formattedDate}~~`
    ))
    .join("\n");
}

const NORMALIZED_STAGE_KEYS = ["concept", "dap", "finish3d", "finish2d"];
const EMPTY_NORMALIZED_STAGE = Object.freeze({
  assigned_at: null,
  completed_at: null,
  duration_minutes: null,
});

function cloneEmptyStage() {
  return {
    assigned_at: EMPTY_NORMALIZED_STAGE.assigned_at,
    completed_at: EMPTY_NORMALIZED_STAGE.completed_at,
    duration_minutes: EMPTY_NORMALIZED_STAGE.duration_minutes,
  };
}

function parseNormalizedDate(value) {
  if (!value) {
    return null;
  }

  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function dedupeStrings(values = []) {
  return [...new Set(
    values
      .map((value) => String(value || "").trim())
      .filter(Boolean),
  )];
}

function normalizeStagePayload(stage) {
  const assignedAt = stage?.assigned_at || null;
  const completedAt = stage?.completed_at || null;
  const assignedDate = parseNormalizedDate(assignedAt);
  const completedDate = parseNormalizedDate(completedAt);
  let durationMinutes = Number.isFinite(stage?.duration_minutes)
    ? Math.max(0, Math.round(Number(stage.duration_minutes)))
    : null;

  if (assignedDate && completedDate) {
    durationMinutes = Math.max(0, Math.round((completedDate.getTime() - assignedDate.getTime()) / 60000));
  }

  return {
    assigned_at: assignedAt,
    completed_at: completedAt,
    duration_minutes: durationMinutes,
  };
}

function buildFixtureKey(projectNo, scopeName, fixtureNo) {
  const normalizedProjectNo = String(projectNo || "").trim();
  const normalizedScopeName = String(scopeName || "").trim();
  const normalizedFixtureNo = String(fixtureNo || "").trim();

  if (!normalizedProjectNo || !normalizedScopeName || !normalizedFixtureNo) {
    throw new Error("Invalid fixture identity");
  }

  return `${normalizedProjectNo}::${normalizedScopeName}::${normalizedFixtureNo}`;
}

function deriveNormalizedStatus(row) {
  const taskStatus = String(row?.task_status || "").trim().toLowerCase();
  const workflowStatus = String(row?.workflow_status || row?.current_workflow_status || "").trim().toLowerCase();
  const now = Date.now();
  const deadline = parseNormalizedDate(row?.task_deadline || row?.deadline);
  const stages = row?.stages || {};
  const stageList = NORMALIZED_STAGE_KEYS.map((stageKey) => stages[stageKey] || cloneEmptyStage());
  const hasAssignedStage = stageList.some((stage) => Boolean(stage.assigned_at));
  const hasActiveStage = stageList.some((stage) => Boolean(stage.assigned_at) && !stage.completed_at);
  const allCompleted = hasAssignedStage && stageList.every((stage) => !stage.assigned_at || Boolean(stage.completed_at));
  const isRejected = taskStatus === "rework" || workflowStatus === "rejected" || String(row?.current_stage_status || "").trim().toUpperCase() === "REJECTED";

  if (taskStatus === "on_hold" || taskStatus === "paused") {
    return "HOLD";
  }

  if (deadline && deadline.getTime() < now && taskStatus !== "closed" && taskStatus !== "approved") {
    return "DELAY";
  }

  if (isRejected) {
    return "REWORK";
  }

  if (taskStatus === "closed" || taskStatus === "approved" || workflowStatus === "approved" || allCompleted) {
    return "COMPLETE";
  }

  if (taskStatus === "in_progress" || workflowStatus === "in_progress" || hasActiveStage) {
    return "IN_PROGRESS";
  }

  if (hasAssignedStage) {
    return "IN_PROGRESS";
  }

  return "ASSIGNED";
}

function normalizeScopeReportData(rawRows = []) {
  if (!Array.isArray(rawRows)) {
    return [];
  }

  return rawRows.reduce((normalizedRows, rawRow, index) => {
    try {
      const projectNo = String(rawRow?.project_no || "").trim();
      const scopeName = String(rawRow?.scope_name || "").trim();
      const fixtureNo = String(rawRow?.fixture_no || "").trim();
      const stages = rawRow?.stages || {};

      const normalizedRow = {
        fixture_key: buildFixtureKey(projectNo, scopeName, fixtureNo),
        project_no: projectNo,
        scope_name: scopeName,
        fixture_no: fixtureNo,
        op_no: String(rawRow?.op_no || "").trim(),
        part_name: String(rawRow?.part_name || "").trim(),
        fixture_type: String(rawRow?.fixture_type || "").trim(),
        remark: String(rawRow?.remark || rawRow?.remarks || "").trim(),
        qty: Number(rawRow?.qty) || 0,
        designer: String(rawRow?.designer || "").trim(),
        stages: {
          concept: normalizeStagePayload(stages.concept),
          dap: normalizeStagePayload(stages.dap),
          finish3d: normalizeStagePayload(stages.finish3d),
          finish2d: normalizeStagePayload(stages.finish2d),
        },
        proof_urls: dedupeStrings([
          ...(Array.isArray(rawRow?.task_proof_url_array) ? rawRow.task_proof_url_array : []),
          ...(Array.isArray(rawRow?.attachments) ? rawRow.attachments.map((attachment) => attachment?.file_url) : []),
          ...(Array.isArray(rawRow?.proof_urls) ? rawRow.proof_urls : []),
        ]),
        status: "ASSIGNED",
      };

      normalizedRow.status = deriveNormalizedStatus({
        ...rawRow,
        stages: normalizedRow.stages,
      });

      normalizedRows.push(normalizedRow);
    } catch (error) {
      logger.warn("Scope report normalization skipped invalid row", {
        index,
        error: error.message,
        project_no: rawRow?.project_no || null,
        scope_name: rawRow?.scope_name || null,
        fixture_no: rawRow?.fixture_no || null,
      });
    }

    return normalizedRows;
  }, []);
}

function validateNormalizedRow(row) {
  const errors = [];

  if (!row?.fixture_key) {
    errors.push("missing fixture_key");
  }

  if (!row?.stages || typeof row.stages !== "object") {
    errors.push("missing stage object");
  }

  NORMALIZED_STAGE_KEYS.forEach((stageKey) => {
    const stage = row?.stages?.[stageKey];

    if (!stage || typeof stage !== "object") {
      errors.push(`missing stage object: ${stageKey}`);
      return;
    }

    const assignedDate = parseNormalizedDate(stage.assigned_at);
    const completedDate = parseNormalizedDate(stage.completed_at);

    if (stage.assigned_at && !assignedDate) {
      errors.push(`invalid assigned_at for ${stageKey}`);
    }

    if (stage.completed_at && !completedDate) {
      errors.push(`invalid completed_at for ${stageKey}`);
    }

    if (assignedDate && completedDate && completedDate.getTime() < assignedDate.getTime()) {
      errors.push(`completed_at before assigned_at for ${stageKey}`);
    }
  });

  if (!Array.isArray(row?.proof_urls)) {
    errors.push("proof_urls must be an array");
  } else if (row.proof_urls.some((proofUrl) => proofUrl === null || proofUrl === undefined || String(proofUrl).trim() === "")) {
    errors.push("proof_urls contains null");
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

function buildReworkHistoryKey(row) {
  const departmentId = String(row.department_id || "").trim().toLowerCase();
  const projectNo = String(row.project_no || "").trim().toLowerCase();
  const scopeName = String(row.scope_name || "").trim().toLowerCase();
  const instanceCode = String(row.instance_code || row.quantity_index || "").trim().toLowerCase();

  if (!departmentId || !projectNo || !scopeName || !instanceCode) {
    return null;
  }

  return [departmentId, projectNo, scopeName, instanceCode].join("::");
}

function mapReportRow(row) {
  return {
    project_no: row.project_no || "",
    project_name: row.project_name || row.project_description || "",
    project_description: row.project_name || row.project_description || "",
    customer_name: row.customer_name || "",
    priority: row.priority || "",
    scope_name: row.scope_name || "",
    instance_code: row.instance_code || row.quantity_index || "",
    quantity_index: row.instance_count === null || row.instance_count === undefined || row.instance_count === ""
      ? row.instance_code || row.quantity_index || ""
      : String(row.instance_count),
    workflow_stage: row.workflow_stage || "",
    assigned_to_name: row.assignee_name || "",
    assignee_name: row.assignee_name || "",
    assigned_by_name: row.assigned_by_name || "",
    status: row.status || "",
    planned_hours: row.planned_hours === null || row.planned_hours === undefined ? 0 : Number(row.planned_hours),
    start_time: row.start_time ? new Date(row.start_time).toISOString() : "",
    end_time: row.end_time ? new Date(row.end_time).toISOString() : "",
    department_id: row.department_id || "",
    department_name: row.department_name || "",
    rework_history: "",
  };
}

async function buildReworkHistoryMap(reportRows) {
  const keyedRows = reportRows.filter((row) => buildReworkHistoryKey(row));

  if (keyedRows.length === 0) {
    return new Map();
  }

  const departmentIds = [...new Set(keyedRows.map((row) => String(row.department_id).trim()).filter(Boolean))];
  const projectNos = [...new Set(keyedRows.map((row) => String(row.project_no).trim()).filter(Boolean))];
  const scopeNames = [...new Set(keyedRows.map((row) => String(row.scope_name).trim()).filter(Boolean))];
  const instanceCodes = [...new Set(
    keyedRows.map((row) => String(row.instance_code || row.quantity_index || "").trim()).filter(Boolean),
  )];

  if (departmentIds.length === 0 || projectNos.length === 0 || scopeNames.length === 0 || instanceCodes.length === 0) {
    return new Map();
  }

  const result = await pool.query(
    `
      SELECT
        dp.department_id,
        dp.project_no,
        ds.scope_name,
        di.instance_code,
        dr.planned_date,
        dr.created_at
      FROM design.reworks dr
      JOIN design.instances di
        ON di.id = dr.instance_id
      JOIN design.scopes ds
        ON ds.id = di.scope_id
      JOIN design.projects dp
        ON dp.id = ds.project_id
      WHERE dp.department_id = ANY($1::text[])
        AND dp.project_no = ANY($2::text[])
        AND ds.scope_name = ANY($3::text[])
        AND di.instance_code = ANY($4::text[])
      ORDER BY dr.planned_date ASC, dr.created_at ASC
    `,
    [departmentIds, projectNos, scopeNames, instanceCodes],
  );

  return result.rows.reduce((historyMap, row) => {
    const key = buildReworkHistoryKey(row);

    if (!key) {
      return historyMap;
    }

    const history = historyMap.get(key) || [];
    history.push(row.planned_date);
    historyMap.set(key, history);
    return historyMap;
  }, new Map());
}

function buildReportAccessClause(user, params) {
  if (isAdmin(user)) {
    return "";
  }

  const visibleUserIds = getVisibleUserIds(user);

  if (visibleUserIds.length === 0) {
    return "1 = 0";
  }

  params.push(visibleUserIds);
  return `
    (
      COALESCE(t.assigned_user_id, t.assigned_to) = ANY($${params.length}::text[])
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(COALESCE(t.assignee_ids, '[]'::jsonb)) AS task_assignee(employee_id)
        WHERE task_assignee.employee_id = ANY($${params.length}::text[])
      )
    )
  `;
}

async function listTaskReportRows(user, filters = {}) {
  const params = [];
  const whereClauses = [];
  const startDate = filters.start_date ? parseDateStart(filters.start_date) : null;
  const endDate = filters.end_date ? parseDateEnd(filters.end_date) : null;

  if (filters.start_date && !startDate) {
    throw new AppError(400, "Invalid start_date");
  }

  if (filters.end_date && !endDate) {
    throw new AppError(400, "Invalid end_date");
  }

  if (startDate && endDate && startDate.getTime() > endDate.getTime()) {
    throw new AppError(400, "start_date must be before or equal to end_date");
  }

  const accessClause = buildReportAccessClause(user, params);

  if (accessClause) {
    whereClauses.push(accessClause);
  }

  whereClauses.push("t.status <> 'cancelled'");

  if (filters.department_id && filters.department_id !== "all") {
    if (!isAdmin(user) && filters.department_id !== user.department_id) {
      throw new AppError(403, "You do not have permission to access another department's reports");
    }

    if (isAdmin(user)) {
      params.push(filters.department_id);
      whereClauses.push(`t.department_id = $${params.length}`);
    }
  }

  const normalizedStatus = normalizeStatusFilter(filters.status);
  if (normalizedStatus) {
    params.push(normalizedStatus);
    whereClauses.push(`t.status = $${params.length}`);
  }

  if (startDate || endDate) {
    const startedClauses = addDateBounds("t.started_at", startDate, endDate, params);
    const assignedClauses = addDateBounds("t.assigned_at", startDate, endDate, params);
    const dateChecks = [];

    if (startedClauses) {
      dateChecks.push(`(t.started_at IS NOT NULL AND ${startedClauses})`);
    }

    if (assignedClauses) {
      dateChecks.push(`(t.assigned_at IS NOT NULL AND ${assignedClauses})`);
    }

    if (dateChecks.length > 0) {
      whereClauses.push(`(${dateChecks.join(" OR ")})`);
    }
  }

  const result = await pool.query(
    `
      SELECT
        COALESCE(t.project_no, '') AS project_no,
        COALESCE(t.project_name, '') AS project_name,
        COALESCE(t.project_description, '') AS project_description,
        COALESCE(t.customer_name, '') AS customer_name,
        COALESCE(t.priority, '') AS priority,
        COALESCE(t.scope_name, '') AS scope_name,
        COALESCE(t.quantity_index, '') AS instance_code,
        COALESCE(t.quantity_index, '') AS quantity_index,
        t.instance_count AS instance_count,
        COALESCE(stage.name, '') AS workflow_stage,
        COALESCE(assignee.name, t.assigned_to, '') AS assignee_name,
        COALESCE(assigner.name, t.assigned_by, '') AS assigned_by_name,
        CASE WHEN t.status = 'under_review' THEN 'review' ELSE t.status END AS status,
        ROUND(COALESCE(t.planned_minutes, 0)::numeric / 60, 2) AS planned_hours,
        t.started_at AS start_time,
        COALESCE(t.completed_at, t.closed_at) AS end_time,
        COALESCE(t.department_id, '') AS department_id,
        COALESCE(task_department.name, t.department_id, '') AS department_name
      FROM tasks t
      LEFT JOIN workflow_stages stage ON stage.id = t.current_stage_id
      LEFT JOIN users assignee ON assignee.employee_id = t.assigned_to
      LEFT JOIN departments task_department ON task_department.id = t.department_id
      LEFT JOIN users assigner ON assigner.employee_id = t.assigned_by
      ${whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : ""}
      ORDER BY COALESCE(t.assigned_at, t.created_at) DESC, t.id DESC
    `,
    params,
  );

  const reportRows = result.rows.map(mapReportRow);
  const reworkHistoryMap = await buildReworkHistoryMap(reportRows);

  return reportRows.map((row) => ({
    ...row,
    rework_history: formatReworkHistory(reworkHistoryMap.get(buildReworkHistoryKey(row)) || []),
  }));
}

async function exportTaskReport(user, filters = {}) {
  const rows = await listTaskReportRows(user, filters);

  return {
    filename: `tasks-report-${new Date().toISOString().slice(0, 10)}.csv`,
    csv: toCsv(rows, [
      { key: "project_no", label: "Project No" },
      { key: "project_name", label: "Project Name" },
      { key: "customer_name", label: "Customer Name" },
      { key: "priority", label: "Priority" },
      { key: "scope_name", label: "Scope Name" },
      { key: "instance_code", label: "Instance Code" },
      { key: "workflow_stage", label: "Workflow Stage" },
      { key: "assigned_by_name", label: "Assigned By" },
      { key: "assigned_to_name", label: "Assigned To" },
      { key: "status", label: "Status" },
      { key: "rework_history", label: "Rework History" },
    ]),
  };
}

async function listWorkflowCompletionSummary(user) {
  const params = [];
  const whereClauses = [];
  const accessClause = buildReportAccessClause(user, params);

  if (accessClause) {
    whereClauses.push(accessClause);
  }

  whereClauses.push("t.status <> 'cancelled'");
  whereClauses.push("COALESCE(t.project_no, '') <> ''");
  whereClauses.push("COALESCE(t.scope_name, '') <> ''");

  const result = await pool.query(
    `
      SELECT
        t.id,
        COALESCE(t.department_id, '') AS department_id,
        COALESCE(department.name, t.department_id, '') AS department_name,
        COALESCE(t.project_no, '') AS project_no,
        COALESCE(t.project_name, t.project_description, '') AS project_name,
        COALESCE(t.customer_name, '') AS customer_name,
        COALESCE(t.scope_name, '') AS scope_name,
        COALESCE(fixture.fixture_no, NULLIF(t.quantity_index, '')) AS fixture_no,
        COALESCE(fixture.fixture_no, NULLIF(t.quantity_index, ''), t.instance_count::text, t.id::text) AS instance_key,
        COALESCE(t.lifecycle_status, 'assigned') AS lifecycle_status,
        COALESCE(current_stage.sequence_order, 0) AS current_stage_order,
        COALESCE(first_stage.sequence_order, 0) AS first_stage_order,
        COALESCE(last_stage.sequence_order, 0) AS last_stage_order
      FROM tasks t
      LEFT JOIN departments department
        ON department.id = t.department_id
      LEFT JOIN design.projects project
        ON project.project_no = NULLIF(t.project_no, '')
        AND project.department_id = t.department_id
      LEFT JOIN design.scopes project_scope
        ON project_scope.project_id = project.id
        AND project_scope.scope_name = NULLIF(t.scope_name, '')
      LEFT JOIN design.fixtures fixture
        ON fixture.id = t.fixture_id
        OR (
          t.fixture_id IS NULL
          AND fixture.scope_id = project_scope.id
          AND fixture.fixture_no = NULLIF(t.quantity_index, '')
        )
      LEFT JOIN workflow_stages current_stage
        ON current_stage.id = t.current_stage_id
      LEFT JOIN LATERAL (
        SELECT sequence_order
        FROM workflow_stages stage
        WHERE stage.workflow_id = t.workflow_id
          AND stage.is_active = TRUE
        ORDER BY stage.sequence_order ASC, stage.created_at ASC
        LIMIT 1
      ) first_stage ON TRUE
      LEFT JOIN LATERAL (
        SELECT sequence_order
        FROM workflow_stages stage
        WHERE stage.workflow_id = t.workflow_id
          AND stage.is_active = TRUE
        ORDER BY stage.sequence_order DESC, stage.created_at DESC
        LIMIT 1
      ) last_stage ON TRUE
      ${whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : ""}
      ORDER BY t.project_no ASC, t.scope_name ASC, t.instance_count ASC NULLS LAST, t.id ASC
    `,
    params,
  );

  const projectMap = new Map();

  for (const row of result.rows) {
    const projectKey = `${row.department_id}::${row.project_no}`;
    const scopeKey = `${projectKey}::${row.scope_name}`;
    const instanceKey = `${scopeKey}::${row.instance_key}`;
    const instanceComplete = row.lifecycle_status === "completed" && Number(row.current_stage_order) === Number(row.last_stage_order);
    const movedBeyondFirstStage = Number(row.current_stage_order) > Number(row.first_stage_order);
    const instanceStarted = movedBeyondFirstStage || !["assigned", null, undefined].includes(row.lifecycle_status);

    let project = projectMap.get(projectKey);
    if (!project) {
      project = {
        project_key: projectKey,
        department_id: row.department_id,
        department_name: row.department_name,
        project_no: row.project_no,
        project_name: row.project_name,
        customer_name: row.customer_name,
        total_instances: 0,
        completed_instances: 0,
        total_scopes: 0,
        completed_scopes: 0,
        all_instances_completed: true,
        any_instance_started: false,
        any_instance_beyond_first_stage: false,
        scopes: [],
      };
      projectMap.set(projectKey, project);
    }

    let scope = project.scopes.find((entry) => entry.scope_key === scopeKey);
    if (!scope) {
      scope = {
        scope_key: scopeKey,
        scope_name: row.scope_name,
        total_instances: 0,
        completed_instances: 0,
        is_complete: true,
        any_instance_started: false,
        any_instance_beyond_first_stage: false,
      };
      project.scopes.push(scope);
    }

    const normalizedFixtureNo = typeof row.fixture_no === "string" && row.fixture_no.trim()
      ? row.fixture_no.trim()
      : null;

    if (normalizedFixtureNo) {
      if (scope.fixture_no_conflict) {
        scope.fixture_no = null;
      } else if (!scope.fixture_no) {
        scope.fixture_no = normalizedFixtureNo;
      } else if (scope.fixture_no !== normalizedFixtureNo) {
        scope.fixture_no = null;
        scope.fixture_no_conflict = true;
      }
    }

    project.total_instances += 1;
    scope.total_instances += 1;

    if (instanceComplete) {
      project.completed_instances += 1;
      scope.completed_instances += 1;
    } else {
      project.all_instances_completed = false;
      scope.is_complete = false;
    }

    if (instanceStarted) {
      project.any_instance_started = true;
      scope.any_instance_started = true;
    }

    if (movedBeyondFirstStage) {
      project.any_instance_beyond_first_stage = true;
      scope.any_instance_beyond_first_stage = true;
    }
  }

  const projects = [...projectMap.values()].map((project) => {
    const scopes = project.scopes.map((scope) => {
      const isComplete = scope.completed_instances === scope.total_instances;
      const status = isComplete
        ? "GREEN"
        : scope.any_instance_started
          ? "YELLOW"
          : "RED";

      return {
        scope_key: scope.scope_key,
        scope_name: scope.scope_name,
        total_instances: scope.total_instances,
        completed_instances: scope.completed_instances,
        any_instance_started: scope.any_instance_started,
        any_instance_beyond_first_stage: scope.any_instance_beyond_first_stage,
        fixture_no: scope.fixture_no || null,
        is_complete: isComplete,
        status,
      };
    });
    const completedScopes = scopes.filter((scope) => scope.is_complete).length;
    const isComplete = completedScopes === scopes.length && scopes.length > 0;
    const status = isComplete
      ? "GREEN"
      : project.any_instance_started
        ? "YELLOW"
        : "RED";

    return {
      project_key: project.project_key,
      department_id: project.department_id,
      department_name: project.department_name,
      project_no: project.project_no,
      project_name: project.project_name,
      customer_name: project.customer_name,
      total_instances: project.total_instances,
      completed_instances: project.completed_instances,
      total_scopes: scopes.length,
      completed_scopes: completedScopes,
      is_complete: isComplete,
      status,
      any_instance_started: project.any_instance_started,
      any_instance_beyond_first_stage: project.any_instance_beyond_first_stage,
      scopes,
    };
  });

  return projects;
}

async function buildReport(user, reportType) {
  const tasks = await listTasksByAccess(getTaskAccess(user));
  const baseRows = tasks.map((task) => ({
    id: task.id,
    identifier: task.title,
    department: task.department_id,
    assignee: task.assignee?.name || task.assigned_to,
    workflow_stage: task.workflow_stage || task.current_stage_id || "",
    priority: task.priority,
    status: task.status,
    verification_status: task.verification_status,
    planned_minutes: task.planned_minutes,
    actual_minutes: task.actual_minutes,
    deadline: task.deadline ? new Date(task.deadline).toISOString() : "",
    created_at: task.created_at ? new Date(task.created_at).toISOString() : "",
    closed_at: task.closed_at ? new Date(task.closed_at).toISOString() : "",
    delay_minutes: isOverdue(task)
      ? Math.max(0, Math.round((Date.now() - new Date(task.deadline).getTime()) / 60000))
      : 0,
    machine: task.machine_name || task.machine_id || "",
    location: task.location_tag || "",
  }));

  const rows = reportType === "delay"
    ? baseRows.filter((row) => row.delay_minutes > 0)
    : reportType === "daily"
      ? baseRows.filter((row) => new Date(row.created_at).toDateString() === new Date().toDateString())
      : baseRows;

  const headers = [
    { key: "id", label: "Task ID" },
    { key: "identifier", label: "Task ID" },
    { key: "department", label: "Department" },
    { key: "assignee", label: "Assignee" },
    { key: "workflow_stage", label: "Workflow Stage" },
    { key: "priority", label: "Priority" },
    { key: "status", label: "Status" },
    { key: "verification_status", label: "Approval" },
    { key: "planned_minutes", label: "Planned Minutes" },
    { key: "actual_minutes", label: "Actual Minutes" },
    { key: "delay_minutes", label: "Delay Minutes" },
    { key: "machine", label: "Machine" },
    { key: "location", label: "Location" },
    { key: "deadline", label: "Deadline" },
    { key: "closed_at", label: "Closed At" },
  ];

  return {
    filename: `${reportType || "performance"}-report.csv`,
    csv: toCsv(rows, headers),
  };
}

module.exports = instrumentModuleExports("service.reportService", {
  buildReport,
  exportTaskReport,
  formatReworkHistory,
  listTaskReportRows,
  listWorkflowCompletionSummary,
  normalizeScopeReportData,
  validateNormalizedRow,
});
