const { pool } = require("../db");

const OUTBOX_MAX_RETRIES = 10;

function normalizePayload(value) {
  return value && typeof value === "object" ? value : {};
}

function mapNotification(row) {
  if (!row) return null;
  const payload = normalizePayload(row.payload_json);
  return {
    ...payload,
    id: Number(row.id),
    eventType: row.event_type,
    entityType: row.entity_type,
    entityId: row.entity_id,
    title: row.title,
    body: row.body,
    deepLink: row.deep_link,
    priority: row.priority,
    recipientBackendUserId: row.backend_user_id || payload.recipientBackendUserId || null,
    createdAt: row.created_at,
  };
}

function mapDevice(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    device_id: row.device_id,
    user_id: row.user_id,
    device_name: row.device_name,
    windows_username: row.windows_username,
    token_hash: row.token_hash,
    agent_version: row.agent_version,
    enabled: row.enabled !== false,
    last_connected_at: row.last_connected_at,
    created_at: row.created_at,
    revoked_at: row.revoked_at,
    last_login_session_id: row.last_login_session_id || null,
    last_login_summary_at: row.last_login_summary_at || null,
  };
}

async function enqueueOutboxEvent({ eventType, entityType, entityId, actorUserId, payload, dedupeKey }, client = pool) {
  const result = await client.query(
    `
      INSERT INTO notification_outbox (
        event_type,
        entity_type,
        entity_id,
        actor_user_id,
        payload_json,
        dedupe_key
      )
      VALUES ($1, $2, $3, $4, $5::jsonb, $6)
      ON CONFLICT (dedupe_key) DO NOTHING
      RETURNING *
    `,
    [eventType, entityType, String(entityId), actorUserId || null, JSON.stringify(normalizePayload(payload)), dedupeKey],
  );
  return result.rows[0] || null;
}

async function claimPendingOutbox(limit = 25, client = pool) {
  const result = await client.query(
    `
      SELECT *
      FROM notification_outbox
      WHERE processed_at IS NULL
        AND retry_count < $2
      ORDER BY id ASC
      LIMIT $1
      FOR UPDATE SKIP LOCKED
    `,
    [limit, OUTBOX_MAX_RETRIES],
  );
  return result.rows;
}

async function markOutboxProcessed(outboxId, client = pool) {
  await client.query(
    `
      UPDATE notification_outbox
      SET processed_at = NOW(),
          processing_error = NULL
      WHERE id = $1
    `,
    [outboxId],
  );
}

async function markOutboxFailed(outboxId, error, client = pool) {
  await client.query(
    `
      UPDATE notification_outbox
      SET retry_count = retry_count + 1,
          processing_error = LEFT($2, 2000)
      WHERE id = $1
    `,
    [outboxId, error?.message || String(error || "Unknown notification worker error")],
  );
}

async function registerDesktopDevice({ deviceId, userId, deviceName, windowsUsername, tokenHash, agentVersion }, client = pool) {
  const result = await client.query(
    `
      INSERT INTO desktop_notification_devices (
        device_id,
        user_id,
        device_name,
        windows_username,
        token_hash,
        agent_version,
        enabled,
        revoked_at
      )
      VALUES ($1::uuid, $2, $3, $4, $5, $6, TRUE, NULL)
      ON CONFLICT (device_id) DO UPDATE
      SET user_id = EXCLUDED.user_id,
          device_name = EXCLUDED.device_name,
          windows_username = EXCLUDED.windows_username,
          token_hash = EXCLUDED.token_hash,
          agent_version = EXCLUDED.agent_version,
          enabled = TRUE,
          revoked_at = NULL
      RETURNING *
    `,
    [deviceId, userId, deviceName, windowsUsername || null, tokenHash, agentVersion || null],
  );
  return mapDevice(result.rows[0]);
}

async function findDeviceByDeviceId(deviceId, client = pool) {
  const result = await client.query(
    `
      SELECT *
      FROM desktop_notification_devices
      WHERE device_id = $1::uuid
      LIMIT 1
    `,
    [deviceId],
  );
  return mapDevice(result.rows[0]);
}

async function touchDeviceConnected(deviceId, agentVersion = null, client = pool) {
  const result = await client.query(
    `
      UPDATE desktop_notification_devices
      SET last_connected_at = NOW(),
          agent_version = COALESCE($2, agent_version)
      WHERE device_id = $1::uuid
        AND enabled = TRUE
        AND revoked_at IS NULL
      RETURNING *
    `,
    [deviceId, agentVersion || null],
  );
  return mapDevice(result.rows[0]);
}

async function revokeDevice(deviceId, userId, client = pool) {
  const result = await client.query(
    `
      UPDATE desktop_notification_devices
      SET enabled = FALSE,
          revoked_at = COALESCE(revoked_at, NOW())
      WHERE device_id = $1::uuid
        AND user_id = $2
      RETURNING *
    `,
    [deviceId, userId],
  );
  return mapDevice(result.rows[0]);
}

async function createDesktopNotification(values, client = pool) {
  const result = await client.query(
    `
      INSERT INTO desktop_notifications (
        user_id,
        backend_user_id,
        event_type,
        entity_type,
        entity_id,
        title,
        body,
        deep_link,
        payload_json,
        priority,
        expires_at,
        dedupe_key
      )
      VALUES ($1, COALESCE($2::uuid, (SELECT id FROM users WHERE employee_id = $1)), $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12)
      ON CONFLICT (dedupe_key) DO UPDATE
      SET title = EXCLUDED.title,
          body = EXCLUDED.body,
          deep_link = EXCLUDED.deep_link,
          payload_json = EXCLUDED.payload_json,
          priority = EXCLUDED.priority,
          expires_at = EXCLUDED.expires_at
      RETURNING *
    `,
    [
      values.userId,
      values.backendUserId || null,
      values.eventType,
      values.entityType,
      String(values.entityId),
      values.title,
      values.body,
      values.deepLink,
      JSON.stringify(normalizePayload(values.payload)),
      values.priority || "normal",
      values.expiresAt || null,
      values.dedupeKey,
    ],
  );

  const notification = result.rows[0];
  if (values.deviceId) {
    await createDeliveryRowForDevice(notification.id, values.deviceId, client);
  } else {
    await createDeliveryRowsForNotification(notification.id, notification.user_id, client);
  }
  return mapNotification(notification);
}

async function createDeliveryRowsForNotification(notificationId, userId, client = pool) {
  await client.query(
    `
      INSERT INTO desktop_notification_deliveries (notification_id, device_id, delivery_status)
      SELECT $1, device_id, 'pending'
      FROM desktop_notification_devices
      WHERE user_id = $2
        AND enabled = TRUE
        AND revoked_at IS NULL
      ON CONFLICT (notification_id, device_id) DO NOTHING
    `,
    [notificationId, userId],
  );
}

async function createDeliveryRowForDevice(notificationId, deviceId, client = pool) {
  await client.query(
    `
      INSERT INTO desktop_notification_deliveries (notification_id, device_id, delivery_status)
      VALUES ($1, $2::uuid, 'pending')
      ON CONFLICT (notification_id, device_id) DO NOTHING
    `,
    [notificationId, deviceId],
  );
}

async function listUsersWithPermission(permissionId, client = pool) {
  const result = await client.query(
    `
      SELECT u.id, u.employee_id, u.name
      FROM users u
      LEFT JOIN roles r ON r.id = u.role
      LEFT JOIN role_permissions rp ON rp.role_id = u.role
      WHERE COALESCE(u.is_active, TRUE) = TRUE
        AND (
          rp.permission_id = $1
          OR COALESCE(r.permissions ->> $1, 'false') = 'true'
          OR COALESCE(r.permissions ->> 'all', 'false') = 'true'
        )
      GROUP BY u.id, u.employee_id, u.name
      ORDER BY u.employee_id
    `,
    [permissionId],
  );
  return result.rows;
}

async function getProjectReleasedNotificationContext(projectId, actorUserId, client = pool) {
  const result = await client.query(
    `
      SELECT
        p.id::text AS project_id,
        p.project_no,
        COALESCE(NULLIF(BTRIM(p.project_name), ''), p.project_no) AS project_name,
        COALESCE(p.customer_name, '') AS customer_name,
        COALESCE(p.status_changed_at, p.completed_at, p.updated_at, NOW()) AS released_at,
        COALESCE(actor.name, $2::text, '') AS released_by_name
      FROM design.projects p
      LEFT JOIN users actor ON actor.employee_id = $2
      WHERE p.id = $1::uuid
      LIMIT 1
    `,
    [String(projectId), actorUserId || null],
  );
  return result.rows[0] || null;
}
async function markDeliverySent(notificationId, deviceId, client = pool) {
  await client.query(
    `
      UPDATE desktop_notification_deliveries
      SET delivery_status = 'sent',
          sent_at = COALESCE(sent_at, NOW()),
          delivery_error = NULL
      WHERE notification_id = $1
        AND device_id = $2::uuid
    `,
    [notificationId, deviceId],
  );
}

async function markDeliveryDisplayed(notificationId, deviceId, displayedAt = new Date(), client = pool) {
  const result = await client.query(
    `
      UPDATE desktop_notification_deliveries
      SET delivery_status = 'displayed',
          displayed_at = COALESCE(displayed_at, $3::timestamptz),
          sent_at = COALESCE(sent_at, $3::timestamptz)
      WHERE notification_id = $1
        AND device_id = $2::uuid
      RETURNING *
    `,
    [notificationId, deviceId, displayedAt],
  );
  return result.rows[0] || null;
}

async function markDeliveryAcknowledged(notificationId, deviceId, acknowledgedAt = new Date(), client = pool) {
  const result = await client.query(
    `
      UPDATE desktop_notification_deliveries
      SET delivery_status = 'acknowledged',
          acknowledged_at = COALESCE(acknowledged_at, $3::timestamptz),
          displayed_at = COALESCE(displayed_at, $3::timestamptz),
          sent_at = COALESCE(sent_at, $3::timestamptz)
      WHERE notification_id = $1
        AND device_id = $2::uuid
      RETURNING *
    `,
    [notificationId, deviceId, acknowledgedAt],
  );
  return result.rows[0] || null;
}

async function getNotificationById(notificationId, client = pool) {
  const result = await client.query(
    `SELECT * FROM desktop_notifications WHERE id = $1 LIMIT 1`,
    [notificationId],
  );
  return mapNotification(result.rows[0]);
}

async function listPendingNotificationsForDevice({ userId, deviceId, limit = 100 }, client = pool) {
  const result = await client.query(
    `
      SELECT n.*
      FROM desktop_notifications n
      JOIN desktop_notification_deliveries d
        ON d.notification_id = n.id
       AND d.device_id = $2::uuid
      WHERE n.user_id = $1
        AND (n.expires_at IS NULL OR n.expires_at > NOW())
        AND d.displayed_at IS NULL
        AND d.acknowledged_at IS NULL
        AND (d.snoozed_until IS NULL OR d.snoozed_until <= NOW())
        AND (
          n.entity_type <> 'task'
          OR EXISTS (
            SELECT 1
            FROM tasks t
            WHERE t.id::text = n.entity_id
              AND COALESCE(t.assigned_user_id, t.assigned_to) = n.user_id
              AND LOWER(COALESCE(t.status, '')) NOT IN ('closed', 'completed', 'cancelled')
              AND COALESCE(t.approved_at, NULL) IS NULL
          )
        )
      ORDER BY n.id ASC
      LIMIT $3
    `,
    [userId, deviceId, Math.min(Number(limit) || 100, 100)],
  );
  return result.rows.map(mapNotification);
}

async function markDeliveryReceived(notificationId, deviceId, deliveredAt = new Date(), client = pool) {
  const result = await client.query(
    `
      UPDATE desktop_notification_deliveries
      SET delivery_status = CASE WHEN displayed_at IS NULL THEN 'delivered' ELSE delivery_status END,
          delivered_at = COALESCE(delivered_at, $3::timestamptz),
          sent_at = COALESCE(sent_at, $3::timestamptz),
          delivery_error = NULL
      WHERE notification_id = $1
        AND device_id = $2::uuid
      RETURNING *
    `,
    [notificationId, deviceId, deliveredAt],
  );
  return result.rows[0] || null;
}

async function markDeliverySnoozed(notificationId, deviceId, snoozedUntil, client = pool) {
  const result = await client.query(
    `
      UPDATE desktop_notification_deliveries
      SET snoozed_until = $3::timestamptz
      WHERE notification_id = $1
        AND device_id = $2::uuid
      RETURNING *
    `,
    [notificationId, deviceId, snoozedUntil],
  );
  return result.rows[0] || null;
}

async function markDeliveryActioned(notificationId, deviceId, actionType, actionedAt = new Date(), client = pool) {
  const result = await client.query(
    `
      UPDATE desktop_notification_deliveries
      SET delivery_status = 'actioned',
          actioned_at = COALESCE(actioned_at, $4::timestamptz),
          action_type = COALESCE(action_type, $3),
          acknowledged_at = COALESCE(acknowledged_at, $4::timestamptz),
          displayed_at = COALESCE(displayed_at, $4::timestamptz),
          delivered_at = COALESCE(delivered_at, $4::timestamptz),
          sent_at = COALESCE(sent_at, $4::timestamptz)
      WHERE notification_id = $1
        AND device_id = $2::uuid
      RETURNING *
    `,
    [notificationId, deviceId, String(actionType || 'action'), actionedAt],
  );
  return result.rows[0] || null;
}

async function claimLoginSummarySession(deviceId, loginSessionId, client = pool) {
  const normalized = String(loginSessionId || '').trim().slice(0, 200);
  if (!normalized) return false;
  const result = await client.query(
    `
      UPDATE desktop_notification_devices
      SET last_login_session_id = $2,
          last_login_summary_at = NOW()
      WHERE device_id = $1::uuid
        AND last_login_session_id IS DISTINCT FROM $2
        AND enabled = TRUE
        AND revoked_at IS NULL
      RETURNING device_id
    `,
    [deviceId, normalized],
  );
  return result.rowCount === 1;
}

async function getCurrentTaskForUser(userId, client = pool) {
  const result = await client.query(
    `
      SELECT current_task.*, task.*
      FROM desktop_current_tasks current_task
      JOIN tasks task ON task.id = current_task.task_id
      WHERE current_task.user_id = $1
      LIMIT 1
    `,
    [userId],
  );
  return result.rows[0] || null;
}

async function selectCurrentTaskForUser(userId, taskId, client = pool) {
  const result = await client.query(
    `
      UPDATE tasks
      SET status = status,
          updated_at = NOW()
      WHERE id = $2::int
        AND COALESCE(assigned_user_id, assigned_to) = $1
        AND LOWER(COALESCE(status, '')) = 'in_progress'
      RETURNING *
    `,
    [userId, taskId],
  );
  return result.rows[0] || null;
}

async function continueCurrentTaskForUser(userId, taskId, client = pool) {
  const result = await client.query(
    `
      UPDATE desktop_current_tasks
      SET progress_due_at = NOW() + INTERVAL '2 hours',
          updated_at = NOW()
      WHERE user_id = $1
        AND task_id = $2::int
      RETURNING *
    `,
    [userId, taskId],
  );
  return result.rows[0] || null;
}

async function getDailyReminderTimes(client = pool) {
  const result = await client.query(
    `SELECT setting_value FROM desktop_notification_settings WHERE setting_key = 'daily_reminder_times' LIMIT 1`,
  );
  const value = result.rows[0]?.setting_value;
  return Array.isArray(value) && value.length > 0 ? value.map(String) : ['10:00', '15:00'];
}

async function listDesktopReminderCandidates(client = pool) {
  const result = await client.query(
    `
      SELECT
        task.*,
        users.id AS backend_user_id,
        users.employee_id,
        users.name AS assignee_name
      FROM tasks task
      JOIN users ON users.employee_id = COALESCE(task.assigned_user_id, task.assigned_to)
      WHERE COALESCE(users.is_active, TRUE) = TRUE
        AND LOWER(COALESCE(task.status, '')) IN ('created', 'pending', 'assigned', 'in_progress', 'on_hold', 'rework', 'update_required')
        AND COALESCE(task.verification_status, '') <> 'approved'
        AND COALESCE(task.due_date, task.deadline) IS NOT NULL
      ORDER BY task.id
    `,
  );
  return result.rows;
}

async function listActiveTaskIdsForUser(userId, client = pool) {
  const result = await client.query(
    `
      SELECT id
      FROM tasks
      WHERE COALESCE(assigned_user_id, assigned_to) = $1
        AND LOWER(COALESCE(status, '')) IN ('created', 'pending', 'assigned', 'in_progress', 'on_hold', 'rework', 'update_required')
        AND COALESCE(verification_status, '') <> 'approved'
        AND approved_at IS NULL
      ORDER BY COALESCE(due_date, deadline) NULLS LAST, id
    `,
    [userId],
  );
  return result.rows.map((row) => Number(row.id));
}
async function listDueCurrentTaskChecks(now = new Date(), client = pool) {
  const result = await client.query(
    `
      SELECT
        current_task.user_id,
        current_task.backend_user_id,
        current_task.task_id,
        current_task.selected_at,
        current_task.progress_due_at,
        task.*
      FROM desktop_current_tasks current_task
      JOIN tasks task ON task.id = current_task.task_id
      WHERE current_task.progress_due_at <= $1::timestamptz
        AND LOWER(COALESCE(task.status, '')) = 'in_progress'
      ORDER BY current_task.progress_due_at, current_task.task_id
    `,
    [now],
  );
  return result.rows;
}

async function listUsersNeedingCurrentTaskSelection(client = pool) {
  const result = await client.query(
    `
      SELECT
        users.employee_id,
        users.id AS backend_user_id,
        task.*
      FROM users
      JOIN tasks task ON COALESCE(task.assigned_user_id, task.assigned_to) = users.employee_id
      WHERE COALESCE(users.is_active, TRUE) = TRUE
        AND LOWER(COALESCE(task.status, '')) IN ('created', 'pending', 'assigned', 'on_hold', 'rework', 'update_required')
        AND COALESCE(task.verification_status, '') <> 'approved'
        AND NOT EXISTS (
          SELECT 1 FROM desktop_current_tasks current_task WHERE current_task.user_id = users.employee_id
        )
        AND users.employee_id IN (
          SELECT COALESCE(candidate.assigned_user_id, candidate.assigned_to)
          FROM tasks candidate
          WHERE LOWER(COALESCE(candidate.status, '')) IN ('created', 'pending', 'assigned', 'on_hold', 'rework', 'update_required')
            AND COALESCE(candidate.verification_status, '') <> 'approved'
          GROUP BY COALESCE(candidate.assigned_user_id, candidate.assigned_to)
          HAVING COUNT(*) > 1
        )
      ORDER BY users.employee_id, task.id
    `,
  );
  return result.rows;
}

async function countDeliveredOverdueReminders(taskId, stateVersion, client = pool) {
  const result = await client.query(
    `
      SELECT COUNT(DISTINCT notification.id)::int AS delivered_count
      FROM desktop_notifications notification
      JOIN desktop_notification_deliveries delivery ON delivery.notification_id = notification.id
      WHERE notification.event_type = 'TASK_OVERDUE'
        AND notification.entity_type = 'task'
        AND notification.entity_id = $1::text
        AND notification.payload_json ->> 'stateVersion' = $2
        AND delivery.delivered_at IS NOT NULL
    `,
    [String(taskId), String(stateVersion)],
  );
  return Number(result.rows[0]?.delivered_count || 0);
}

async function notifyDesktopNotification(notification, client = pool) {
  await client.query(
    `SELECT pg_notify('desktop_notifications', $1)`,
    [JSON.stringify({ notificationId: notification.id, userId: notification.userId || notification.user_id })],
  );
}

module.exports = {
  OUTBOX_MAX_RETRIES,
  claimPendingOutbox,
  createDeliveryRowForDevice,
  createDesktopNotification,
  enqueueOutboxEvent,
  findDeviceByDeviceId,
  getNotificationById,
  getProjectReleasedNotificationContext,
  claimLoginSummarySession,
  continueCurrentTaskForUser,
  countDeliveredOverdueReminders,
  getCurrentTaskForUser,
  getDailyReminderTimes,
  listActiveTaskIdsForUser,
  listDesktopReminderCandidates,
  listDueCurrentTaskChecks,
  listPendingNotificationsForDevice,
  listUsersNeedingCurrentTaskSelection,
  listUsersWithPermission,
  markDeliveryAcknowledged,
  markDeliveryActioned,
  markDeliveryDisplayed,
  markDeliveryReceived,
  markDeliverySent,
  markDeliverySnoozed,
  markOutboxFailed,
  markOutboxProcessed,
  notifyDesktopNotification,
  registerDesktopDevice,
  revokeDevice,
  selectCurrentTaskForUser,
  touchDeviceConnected,
};
