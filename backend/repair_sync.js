const { Pool } = require('pg');
const { env } = require('./config/env');
const pool = new Pool({
  user: env.db.user,
  host: env.db.host,
  database: env.db.database,
  password: env.db.password,
  port: env.db.port,
});

const ORDERED_STAGES = ["concept", "dap", "3d_finish", "2d_finish", "release"];

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Fetch all active tasks for fixtures
    const tasksRes = await client.query(`
      SELECT fixture_id, stage, status, verification_status 
      FROM tasks 
      WHERE fixture_id IS NOT NULL 
        AND status = 'closed' 
        AND verification_status = 'approved'
    `);

    // Group by fixture
    const fixtures = {};
    for (const row of tasksRes.rows) {
      if (!fixtures[row.fixture_id]) fixtures[row.fixture_id] = [];
      fixtures[row.fixture_id].push(row);
    }

    for (const [fixtureId, tasks] of Object.entries(fixtures)) {
      // Find the furthest completed stage
      let furthestStageIdx = -1;
      for (const t of tasks) {
        const idx = ORDERED_STAGES.indexOf(String(t.stage || '').toLowerCase());
        if (idx > furthestStageIdx) furthestStageIdx = idx;
      }

      if (furthestStageIdx >= 0) {
        // Mark all stages up to furthestStageIdx as COMPLETED
        for (let i = 0; i <= furthestStageIdx; i++) {
          const stageName = ORDERED_STAGES[i];
          await client.query(`
            UPDATE fixture_workflow_progress 
            SET status = 'COMPLETED', completed_at = COALESCE(completed_at, NOW())
            WHERE fixture_id = $1 AND LOWER(stage_name) = LOWER($2)
          `, [fixtureId, stageName]);
        }

        // Mark the next stage as IN_PROGRESS if exists
        if (furthestStageIdx + 1 < ORDERED_STAGES.length) {
          const nextStageName = ORDERED_STAGES[furthestStageIdx + 1];
          await client.query(`
            UPDATE fixture_workflow_progress 
            SET status = 'IN_PROGRESS', started_at = COALESCE(started_at, NOW())
            WHERE fixture_id = $1 AND LOWER(stage_name) = LOWER($2) AND completed_at IS NULL
          `, [fixtureId, nextStageName]);
          
          await client.query(`
             INSERT INTO fixture_workflow (fixture_id, current_stage, updated_at) 
             VALUES ($1, $2, NOW()) 
             ON CONFLICT (fixture_id) DO UPDATE 
             SET current_stage = EXCLUDED.current_stage, updated_at = NOW()
          `, [fixtureId, nextStageName]);
        } else {
           await client.query(`
             INSERT INTO fixture_workflow (fixture_id, current_stage, updated_at) 
             VALUES ($1, 'completed', NOW()) 
             ON CONFLICT (fixture_id) DO UPDATE 
             SET current_stage = EXCLUDED.current_stage, updated_at = NOW()
          `, [fixtureId]);
        }
      }
    }

    await client.query('COMMIT');
    console.log('Repair completed successfully.');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Repair failed:', e);
  } finally {
    client.release();
    pool.end();
  }
}
run();
