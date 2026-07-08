const { pool } = require("../db");
const { listTasksByAccess } = require("./tasksRepository");
const { userIdentifierMatchSql } = require("./sqlFragments");
const { isProjectAuthorityRole } = require("../services/accessControlService");
const { resolveAccessibleUserIds } = require("../services/visibilityResolutionService");

const ACTIVE_NOTIFICATION_STATUSES = new Set(["unread", "read"]);

function buildTaskAssigneeMatchSql(userAlias) {
  return `
    (
      ${userIdentifierMatchSql(userAlias, "COALESCE(t.assigned_user_id, t.assigned_to)")}
      OR ${userIdentifierMatchSql(userAlias, "t.assigned_to")}
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(COALESCE(t.assignee_ids, '[]'::jsonb)) AS task_assignee(employee_id)
        WHERE ${userIdentifierMatchSql(userAlias, "task_assignee.employee_id")}
        LIMIT 1
      )
    )
  `;
}

function buildAssigneeEmployeePredicate(employeeIdParam) {
  return `
    EXISTS (
      SELECT 1
      FROM users overdue_assignee
      WHERE overdue_assignee.employee_id = ${employeeIdParam}
        AND ${buildTaskAssigneeMatchSql("overdue_assignee")}
      LIMIT 1
    )
  `;
}

function buildAssigneeEmployeeArrayPredicate(employeeIdsParam) {
  return `
    EXISTS (
      SELECT 1
      FROM users overdue_assignee
      WHERE overdue_assignee.employee_id = ANY(${employeeIdsParam}::text[])
        AND ${buildTaskAssigneeMatchSql("overdue_assignee")}
      LIMIT 1
    )
  `;
}

function buildOverduePredicate(nowParam) {
  return `
    COALESCE(project.status, 'active') = 'active'
    AND t.deadline IS NOT NULL
    AND t.deadline < ${nowParam}::timestamptz
    AND (
      NULLIF(BTRIM(COALESCE(t.assigned_user_id, t.assigned_to, '')), '') IS NOT NULL
      OR jsonb_array_length(COALESCE(t.assignee_ids, '[]'::jsonb)) > 0
    )
    AND LOWER(COALESCE(t.status, '')) NOT IN ('closed', 'completed', 'approved', 'released', 'cancelled')
    AND LOWER(COALESCE(t.lifecycle_status, '')) NOT IN ('completed', 'cancelled')
    AND LOWER(COALESCE(t.verification_status, 'pending')) <> 'approved'
    AND t.approved_at IS NULL
    AND NOT (
      LOWER(COALESCE(t.status, '')) = 'under_review'
      AND t.submitted_at IS NOT NULL
      AND t.submitted_at <= t.deadline
      AND LOWER(COALESCE(t.verification_status, 'pending')) IN ('pending', 'manager_approved', 'quality_pending')
    )
  `;
}

function mapNotificationRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    task_id: row.task_id,
    project_id: row.project_id,
    recipient_user_id: row.recipient_user_id,
    notification_type: row.notification_type,
    title: row.title,
    message: row.message,
    severity: row.severity,
    status: row.status,
    triggered_at: row.triggered_at,
    acknowledged_at: row.acknowledged_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function appendFilter(clause, filter) {
  return clause && /\bWHERE\b/i.test(clause)
    ? `${clause}\n      AND ${filter}`
    : `WHERE ${filter}`;
}

async function listCurrentUserOverdueTasks(user, now = new Date(), client = pool) {
  const params = [now, user.employee_id];
  const clause = `
    WHERE ${buildOverduePredicate("$1")}
      AND ${buildAssigneeEmployeePredicate("$2")}
  `;

  return listTasksByAccess({ clause, params }, client);
}

async function listTeamOverdueTasks(user, now = new Date(), client = pool) {
  const params = [now];
  const filters = [buildOverduePredicate("$1")];

  params.push(user.employee_id);
  filters.push(`NOT ${buildAssigneeEmployeePredicate(`$${params.length}`)}`);

  if (!isProjectAuthorityRole(user)) {
    const visibleUserIds = await resolveAccessibleUserIds(user, client);
    const teamUserIds = visibleUserIds.filter((employeeId) => employeeId && employeeId !== user.employee_id);

    if (teamUserIds.length === 0) {
      return [];
    }

    params.push(teamUserIds);
    filters.push(buildAssigneeEmployeeArrayPredicate(`$${params.length}`));

    if (user.department_id) {
      params.push(user.department_id);
      filters.push(`t.department_id = $${params.length}`);
    }
  }

  return listTasksByAccess({ clause: appendFilter("", filters.join("\n      AND ")), params }, client);
}

function buildNotificationText(task, notificationType) {
  const projectNumber = task.project_no || task.project_code || "No project number";
  const projectName = task.project_name || "Unnamed project";
  const stageName = task.workflow_stage || task.stage || task.title || "Task";

  if (notificationType === "TEAM_OVERDUE_TASK") {
    const employeeName = task.assignee?.name || task.assignee_names || task.assigned_to || "Employee";
    const employeeId = task.assignee?.employee_id || task.assigned_user_id || task.assigned_to || "unknown";
    return {
      title: "Team Overdue Alert",
      message: `${employeeName} (${employeeId}) has overdue task ${stageName} for ${projectNumber} - ${projectName}.`,
    };
  }

  return {
    title: "Overdue Task Alert",
    message: `${stageName} for ${projectNumber} - ${projectName} is overdue.`,
  };
}

function getTaskProjectId(task) {
  const projectId = task.project_id || null;
  return projectId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(projectId)
    ? projectId
    : null;
}

function getNotificationSeverity(task, now = new Date()) {
  const deadlineMs = new Date(task.deadline).getTime();
  const overdueMinutes = Number.isFinite(deadlineMs)
    ? Math.max(0, Math.floor((now.getTime() - deadlineMs) / 60000))
    : 0;

  return overdueMinutes >= 24 * 60 ? "critical" : "warning";
}

function selectExistingNotification(rows) {
  const active = rows.find((row) => ACTIVE_NOTIFICATION_STATUSES.has(row.status));
  if (active) {
    return { row: active, suppress: false };
  }

  if (rows.length > 0) {
    return { row: rows[0], suppress: true };
  }

  return { row: null, suppress: false };
}

async function ensureOverdueNotificationsForTasks(tasks, options, client = pool) {
  const recipientUserId = String(options?.recipientUserId || "").trim();
  const notificationType = String(options?.notificationType || "").trim();
  const now = options?.now instanceof Date ? options.now : new Date();

  if (!recipientUserId || !notificationType || tasks.length === 0) {
    return new Map();
  }

  const taskIds = tasks.map((task) => Number(task.id)).filter((taskId) => Number.isInteger(taskId));
  if (taskIds.length === 0) {
    return new Map();
  }

  const existingResult = await client.query(
    `
      SELECT *
      FROM task_notifications
      WHERE task_id = ANY($1::int[])
        AND recipient_user_id = $2
        AND notification_type = $3
      ORDER BY created_at DESC
    `,
    [taskIds, recipientUserId, notificationType],
  );

  const existingByTask = new Map();
  for (const row of existingResult.rows) {
    const key = Number(row.task_id);
    if (!existingByTask.has(key)) {
      existingByTask.set(key, []);
    }
    existingByTask.get(key).push(row);
  }

  const notificationsByTask = new Map();

  for (const task of tasks) {
    const taskId = Number(task.id);
    const existing = selectExistingNotification(existingByTask.get(taskId) || []);

    if (existing.suppress) {
      continue;
    }

    const text = buildNotificationText(task, notificationType);
    const severity = getNotificationSeverity(task, now);
    let row = existing.row;

    if (row) {
      const updated = await client.query(
        `
          UPDATE task_notifications
          SET title = $2,
              message = $3,
              severity = $4,
              triggered_at = $5,
              updated_at = NOW()
          WHERE id = $1
          RETURNING *
        `,
        [row.id, text.title, text.message, severity, now],
      );
      row = updated.rows[0];
    } else {
      const inserted = await client.query(
        `
          INSERT INTO task_notifications (
            task_id,
            project_id,
            recipient_user_id,
            notification_type,
            title,
            message,
            severity,
            status,
            triggered_at,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, 'unread', $8, NOW(), NOW())
          RETURNING *
        `,
        [taskId, getTaskProjectId(task), recipientUserId, notificationType, text.title, text.message, severity, now],
      );
      row = inserted.rows[0];
    }

    const notification = mapNotificationRow(row);
    if (notification) {
      notificationsByTask.set(taskId, notification);
    }
  }

  return notificationsByTask;
}

async function acknowledgeNotificationForRecipient(notificationId, recipientUserId, client = pool) {
  const result = await client.query(
    `
      UPDATE task_notifications
      SET status = 'acknowledged',
          acknowledged_at = COALESCE(acknowledged_at, NOW()),
          updated_at = NOW()
      WHERE id = $1
        AND recipient_user_id = $2
      RETURNING *
    `,
    [notificationId, recipientUserId],
  );

  return mapNotificationRow(result.rows[0]);
}

module.exports = {
  acknowledgeNotificationForRecipient,
  ensureOverdueNotificationsForTasks,
  listCurrentUserOverdueTasks,
  listTeamOverdueTasks,
};