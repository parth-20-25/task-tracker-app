const pool = require("./db");
async function backfill() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await client.query(`
      UPDATE tasks t
      SET fixture_id = f.id,
          stage = COALESCE(NULLIF(ws.stage_name, ''), NULLIF(ws.name, ''), ws.id)
      FROM design.projects p
      JOIN design.scopes s ON s.project_id = p.id
      JOIN design.fixtures f ON f.scope_id = s.id
      LEFT JOIN workflow_stages ws ON true
      WHERE t.project_no = p.project_no
        AND t.department_id = p.department_id
        AND t.scope_name = s.scope_name
        AND t.quantity_index = f.fixture_no
        AND t.current_stage_id = ws.id
        AND (t.fixture_id IS NULL OR t.stage IS NULL);
    `);
    console.log('Backfilled rows:', res.rowCount);
    await client.query('COMMIT');
  } catch (err) {
    console.error(err);
    await client.query('ROLLBACK');
  } finally {
    client.release();
    pool.end();
  }
}
backfill();
