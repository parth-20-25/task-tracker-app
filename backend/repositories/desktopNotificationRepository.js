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
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11)
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
      SELECT u.employee_id, u.name
      FROM users u
      LEFT JOIN roles r ON r.id = u.role
      LEFT JOIN role_permissions rp ON rp.role_id = u.role
      WHERE COALESCE(u.is_active, TRUE) = TRUE
        AND (
          rp.permission_id = $1
          OR COALESCE(r.permissions ->> $1, 'false') = 'true'
          OR COALESCE(r.permissions ->> 'all', 'false') = 'true'
        )
      GROUP BY u.employee_id, u.name
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
  listPendingNotificationsForDevice,
  listUsersWithPermission,
  markDeliveryAcknowledged,
  markDeliveryDisplayed,
  markDeliverySent,
  markOutboxFailed,
  markOutboxProcessed,
  notifyDesktopNotification,
  registerDesktopDevice,
  revokeDevice,
  touchDeviceConnected,
};
