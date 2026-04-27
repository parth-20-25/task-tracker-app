const { Pool } = require('pg');
const { env } = require('./config/env');
const pool = new Pool({
  user: env.db.user,
  host: env.db.host,
  database: env.db.database,
  password: env.db.password,
  port: env.db.port,
});

async function run() {
  try {
    // 1. Find fixtures that have a closed/approved concept task
    const tasksRes = await pool.query(`
      SELECT DISTINCT fixture_id 
      FROM tasks 
      WHERE LOWER(stage) = 'concept' 
        AND status = 'closed' 
        AND verification_status = 'approved'
        AND fixture_id IS NOT NULL
    `);
    
    console.log('Fixtures with closed Concept task:', tasksRes.rows.map(r => r.fixture_id));

    if (tasksRes.rows.length > 0) {
      const fixtureIds = tasksRes.rows.map(r => r.fixture_id);
      // 2. Check their progress rows for Concept
      const progressRes = await pool.query(`
        SELECT fixture_id, stage_name, status, completed_at 
        FROM fixture_workflow_progress 
        WHERE fixture_id = ANY($1) 
          AND LOWER(stage_name) = 'concept'
      `, [fixtureIds]);
      
      console.log('Progress records for those fixtures:', progressRes.rows);
    }
  } catch (e) {
    console.error(e);
  } finally {
    pool.end();
  }
}
run();
