const { generateUUID } = require("../lib/uuid");
const { pool } = require("../db");
const { mapAuditLogRow } = require("./mappers");
const { buildUserColumns } = require("./sqlFragments");

async function createAuditLog({ userEmployeeId, actionType, targetType, targetId, metadata = {} }, client = pool) {
  await client.query(
    `
      INSERT INTO audit_logs (
        id,
        user_employee_id,
        action_type,
        target_type,
        target_id,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb)
    `,
    [generateUUID(), userEmployeeId, actionType, targetType, String(targetId), JSON.stringify(metadata)],
  );
}

async function listAuditLogs(client = pool) {
  const result = await client.query(
    `
      SELECT
        a.*,
        ${buildUserColumns({ userAlias: "u", roleAlias: "r", departmentAlias: "d", prefix: "user_" })}
      FROM audit_logs a
      LEFT JOIN users u ON u.employee_id = a.user_employee_id
      LEFT JOIN roles r ON r.id = u.role
      LEFT JOIN departments d ON d.id = u.department_id
      ORDER BY a.timestamp DESC
      LIMIT 200
    `,
  );

  return result.rows.map((row) => mapAuditLogRow(row));
}

module.exports = {
  createAuditLog,
  listAuditLogs,
};
