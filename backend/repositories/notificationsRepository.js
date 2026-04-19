const { pool } = require("../db");
const { isAdmin } = require("../services/accessControlService");

async function createNotification(notification, client = pool) {
  const result = await client.query(
    `
      INSERT INTO notifications (
        user_employee_id,
        department_id,
        title,
        body,
        type,
        target_type,
        target_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `,
    [
      notification.userEmployeeId || null,
      notification.departmentId || null,
      notification.title,
      notification.body,
      notification.type || "info",
      notification.targetType || null,
      notification.targetId ? String(notification.targetId) : null,
    ],
  );

  return result.rows[0];
}

async function listNotificationsForUser(user, client = pool) {
  const result = await client.query(
    `
      SELECT *
      FROM notifications
      WHERE user_employee_id = $1
         OR (user_employee_id IS NULL AND department_id = $2)
         OR (user_employee_id IS NULL AND department_id IS NULL AND $3 = TRUE)
      ORDER BY created_at DESC
      LIMIT 200
    `,
    [user.employee_id, user.department_id, isAdmin(user)],
  );

  return result.rows;
}

async function markNotificationRead(notificationId, user, client = pool) {
  const result = await client.query(
    `
      UPDATE notifications
      SET read_at = COALESCE(read_at, NOW())
      WHERE id = $1
        AND (
          user_employee_id = $2
          OR (user_employee_id IS NULL AND department_id = $3)
          OR (user_employee_id IS NULL AND department_id IS NULL AND $4 = TRUE)
        )
      RETURNING *
    `,
    [notificationId, user.employee_id, user.department_id, isAdmin(user)],
  );

  return result.rows[0] || null;
}

module.exports = {
  createNotification,
  listNotificationsForUser,
  markNotificationRead,
};
