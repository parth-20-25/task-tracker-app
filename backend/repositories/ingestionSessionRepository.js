const { pool } = require("../db");
const { instrumentModuleExports } = require("../lib/observability");

const SESSION_TTL_HOURS = 72;

async function createIngestionSession(payload, client = pool) {
  const {
    department_id,
    created_by_employee_id,
    file_info,
    snapshot,
  } = payload;

  const result = await client.query(
    `
      INSERT INTO design.ingestion_sessions (
        department_id,
        created_by_employee_id,
        file_info,
        snapshot,
        status,
        expires_at
      )
      VALUES ($1, $2, $3::jsonb, $4::jsonb, 'draft', NOW() + ($5 * INTERVAL '1 hour'))
      RETURNING id, expires_at, created_at
    `,
    [
      department_id,
      created_by_employee_id,
      JSON.stringify(file_info || {}),
      JSON.stringify(snapshot || {}),
      SESSION_TTL_HOURS,
    ],
  );

  return result.rows[0];
}

async function getDraftIngestionSessionForUser(sessionId, departmentId, employeeId, client) {
  const result = await client.query(
    `
      SELECT *
      FROM design.ingestion_sessions
      WHERE id = $1
        AND created_by_employee_id = $2
        AND ($3::text IS NULL OR department_id IS NULL OR department_id = $3)
        AND status = 'draft'
        AND expires_at > NOW()
    `,
    [sessionId, employeeId, departmentId || null],
  );

  return result.rows[0] || null;
}

async function markIngestionSessionCommitted(sessionId, batchId, client) {
  await client.query(
    `
      UPDATE design.ingestion_sessions
      SET status = 'committed',
          committed_batch_id = $2,
          updated_at = NOW()
      WHERE id = $1
        AND status = 'draft'
    `,
    [sessionId, batchId],
  );
}

async function getIngestionSessionById(sessionId, client = pool) {
  const result = await client.query(
    `
      SELECT id, status, expires_at, file_info, snapshot, committed_batch_id, department_id
      FROM design.ingestion_sessions
      WHERE id = $1
    `,
    [sessionId],
  );

  return result.rows[0] || null;
}

async function finalizeIngestionSessionPreview(sessionId, { snapshot, file_info: fileInfo, department_id: departmentId }, client = pool) {
  await client.query(
    `
      UPDATE design.ingestion_sessions
      SET snapshot = $2::jsonb,
          file_info = COALESCE($3::jsonb, file_info),
          department_id = COALESCE($4::text, department_id),
          updated_at = NOW()
      WHERE id = $1
        AND status = 'draft'
    `,
    [
      sessionId,
      JSON.stringify(snapshot || {}),
      fileInfo ? JSON.stringify(fileInfo) : null,
      departmentId || null,
    ],
  );
}

module.exports = instrumentModuleExports("repository.ingestionSessionRepository", {
  createIngestionSession,
  getDraftIngestionSessionForUser,
  getIngestionSessionById,
  finalizeIngestionSessionPreview,
  markIngestionSessionCommitted,
});
