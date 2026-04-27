const { pool } = require("../db");

function roundNumber(value, decimals = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return null;
  }

  const factor = 10 ** decimals;
  return Math.round(Number(value) * factor) / factor;
}

async function ensurePerformanceAnalyticsTables(client = pool) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS user_performance (
      user_id VARCHAR(50) PRIMARY KEY REFERENCES users(employee_id) ON DELETE CASCADE,
      department_id TEXT NOT NULL REFERENCES departments(id),
      approved_tasks INTEGER NOT NULL DEFAULT 0,
      on_time_count INTEGER NOT NULL DEFAULT 0,
      overdue_count INTEGER NOT NULL DEFAULT 0,
      rework_count INTEGER NOT NULL DEFAULT 0,
      score NUMERIC(12, 2) NOT NULL DEFAULT 0,
      rank INTEGER,
      last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS department_performance (
      department_id TEXT PRIMARY KEY REFERENCES departments(id) ON DELETE CASCADE,
      total_tasks INTEGER NOT NULL DEFAULT 0,
      approved_tasks INTEGER NOT NULL DEFAULT 0,
      completion_rate NUMERIC(8, 2),
      rework_rate NUMERIC(8, 2),
      overdue_rate NUMERIC(8, 2),
      avg_completion_time NUMERIC(12, 2),
      score NUMERIC(12, 2),
      rank INTEGER,
      last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      timed_approved_tasks INTEGER NOT NULL DEFAULT 0,
      overdue_tasks INTEGER NOT NULL DEFAULT 0,
      rework_tasks INTEGER NOT NULL DEFAULT 0,
      eligible_users INTEGER NOT NULL DEFAULT 0
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS performance_analytics_state (
      scope_key TEXT PRIMARY KEY,
      last_refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_user_performance_department_rank
    ON user_performance (department_id, rank, score DESC)
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_user_performance_last_updated
    ON user_performance (last_updated DESC)
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_department_performance_rank
    ON department_performance (rank, score DESC)
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_department_performance_last_updated
    ON department_performance (last_updated DESC)
  `);
}

async function refreshPerformanceAnalytics(
  {
    departmentId = null,
    minimumApprovedTasks = 5,
    overduePenaltyFactor = 1,
  } = {},
  client = pool,
) {
  const params = [departmentId, minimumApprovedTasks, overduePenaltyFactor];

  await client.query(
    `
      DELETE FROM user_performance
      WHERE ($1::text IS NULL OR department_id = $1::text)
    `,
    [departmentId],
  );

  await client.query(
    `
      WITH active_departments AS (
        SELECT d.id
        FROM departments d
        WHERE COALESCE(d.is_active, TRUE) = TRUE
          AND ($1::text IS NULL OR d.id = $1::text)
      ),
      active_users AS (
        SELECT
          u.employee_id AS user_id,
          u.department_id
        FROM users u
        JOIN active_departments d
          ON d.id = u.department_id
        WHERE COALESCE(u.is_active, TRUE) = TRUE
      ),
      approved_tasks AS (
        SELECT
          au.user_id,
          au.department_id,
          CASE
            WHEN t.due_date IS NOT NULL
              AND COALESCE(t.approved_at, t.closed_at, t.verified_at) <= t.due_date
            THEN 1
            ELSE 0
          END AS is_on_time,
          CASE
            WHEN t.due_date IS NOT NULL
              AND COALESCE(t.approved_at, t.closed_at, t.verified_at) > t.due_date
            THEN 1
            ELSE 0
          END AS is_overdue,
          CASE
            WHEN COALESCE(t.rejection_count, 0) > 0 THEN 1
            ELSE 0
          END AS has_rework
        FROM tasks t
        JOIN active_users au
          ON au.user_id = COALESCE(NULLIF(t.assigned_user_id, ''), t.assigned_to)
         AND au.department_id = t.department_id
        WHERE t.status <> 'cancelled'
          AND COALESCE(t.approved_at, t.closed_at, t.verified_at) IS NOT NULL
          AND (
            t.status = 'closed'
            OR t.verification_status = 'approved'
            OR t.approved_at IS NOT NULL
          )
      ),
      aggregated AS (
        SELECT
          au.user_id,
          au.department_id,
          COUNT(at.user_id)::int AS approved_tasks,
          COALESCE(SUM(at.is_on_time), 0)::int AS on_time_count,
          COALESCE(SUM(at.is_overdue), 0)::int AS overdue_count,
          COALESCE(SUM(at.has_rework), 0)::int AS rework_count
        FROM active_users au
        LEFT JOIN approved_tasks at
          ON at.user_id = au.user_id
        GROUP BY au.user_id, au.department_id
        HAVING COUNT(at.user_id) >= $2::int
      ),
      scored AS (
        SELECT
          aggregated.*,
          (
            (approved_tasks * 10)
            + (on_time_count * 5)
            - (rework_count * 7)
            - (overdue_count * 8)
          )::numeric(12, 2) AS score
        FROM aggregated
      ),
      ranked AS (
        SELECT
          scored.*,
          DENSE_RANK() OVER (
            PARTITION BY scored.department_id
            ORDER BY scored.score DESC, scored.approved_tasks DESC, scored.on_time_count DESC, scored.user_id ASC
          ) AS department_rank
        FROM scored
      )
      INSERT INTO user_performance (
        user_id,
        department_id,
        approved_tasks,
        on_time_count,
        overdue_count,
        rework_count,
        score,
        rank,
        last_updated
      )
      SELECT
        user_id,
        department_id,
        approved_tasks,
        on_time_count,
        overdue_count,
        rework_count,
        score,
        department_rank,
        NOW()
      FROM ranked
    `,
    [departmentId, minimumApprovedTasks],
  );

  await client.query(
    `
      DELETE FROM department_performance
      WHERE ($1::text IS NULL OR department_id = $1::text)
    `,
    [departmentId],
  );

  await client.query(
    `
      WITH active_departments AS (
        SELECT d.id, d.name
        FROM departments d
        WHERE COALESCE(d.is_active, TRUE) = TRUE
          AND ($1::text IS NULL OR d.id = $1::text)
      ),
      active_users AS (
        SELECT
          u.employee_id AS user_id,
          u.department_id
        FROM users u
        JOIN active_departments d
          ON d.id = u.department_id
        WHERE COALESCE(u.is_active, TRUE) = TRUE
      ),
      active_department_ids AS (
        SELECT DISTINCT department_id
        FROM active_users
      ),
      approved_task_facts AS (
        SELECT
          t.department_id,
          CASE
            WHEN COALESCE(t.rejection_count, 0) > 0 THEN 1
            ELSE 0
          END AS has_rework,
          CASE
            WHEN t.due_date IS NOT NULL THEN 1
            ELSE 0
          END AS has_due_date,
          CASE
            WHEN t.due_date IS NOT NULL
              AND COALESCE(t.approved_at, t.closed_at, t.verified_at) > t.due_date
            THEN 1
            ELSE 0
          END AS is_overdue,
          CASE
            WHEN COALESCE(t.actual_minutes, 0) > 0 THEN t.actual_minutes
            WHEN COALESCE(t.approved_at, t.closed_at, t.verified_at) IS NOT NULL
              AND COALESCE(t.started_at, t.assigned_at, t.created_at) IS NOT NULL
              AND COALESCE(t.approved_at, t.closed_at, t.verified_at) >= COALESCE(t.started_at, t.assigned_at, t.created_at)
            THEN GREATEST(
              1,
              ROUND(
                EXTRACT(EPOCH FROM (
                  COALESCE(t.approved_at, t.closed_at, t.verified_at)
                  - COALESCE(t.started_at, t.assigned_at, t.created_at)
                )) / 60.0
              )::int
            )
            ELSE NULL
          END AS completion_minutes
        FROM tasks t
        JOIN active_users au
          ON au.user_id = COALESCE(NULLIF(t.assigned_user_id, ''), t.assigned_to)
         AND au.department_id = t.department_id
        WHERE t.status <> 'cancelled'
          AND COALESCE(t.approved_at, t.closed_at, t.verified_at) IS NOT NULL
          AND (
            t.status = 'closed'
            OR t.verification_status = 'approved'
            OR t.approved_at IS NOT NULL
          )
      ),
      task_totals AS (
        SELECT
          au.department_id,
          COUNT(t.id)::int AS total_tasks
        FROM active_users au
        LEFT JOIN tasks t
          ON COALESCE(NULLIF(t.assigned_user_id, ''), t.assigned_to) = au.user_id
         AND t.department_id = au.department_id
         AND t.status <> 'cancelled'
        GROUP BY au.department_id
      ),
      approved_totals AS (
        SELECT
          department_id,
          COUNT(*)::int AS approved_tasks,
          COALESCE(SUM(has_rework), 0)::int AS rework_tasks,
          COALESCE(SUM(has_due_date), 0)::int AS timed_approved_tasks,
          COALESCE(SUM(is_overdue), 0)::int AS overdue_tasks,
          ROUND(AVG(completion_minutes)::numeric, 2) AS avg_completion_time
        FROM approved_task_facts
        GROUP BY department_id
      ),
      user_scores AS (
        SELECT
          up.department_id,
          COUNT(*)::int AS eligible_users,
          ROUND(AVG(up.score)::numeric, 2) AS average_user_score
        FROM user_performance up
        WHERE ($1::text IS NULL OR up.department_id = $1::text)
        GROUP BY up.department_id
      ),
      base AS (
        SELECT
          d.id AS department_id,
          COALESCE(tt.total_tasks, 0) AS total_tasks,
          COALESCE(at.approved_tasks, 0) AS approved_tasks,
          CASE
            WHEN COALESCE(tt.total_tasks, 0) = 0 THEN NULL
            ELSE ROUND((COALESCE(at.approved_tasks, 0)::numeric / tt.total_tasks) * 100, 2)
          END AS completion_rate,
          CASE
            WHEN COALESCE(at.approved_tasks, 0) = 0 THEN NULL
            ELSE ROUND((COALESCE(at.rework_tasks, 0)::numeric / at.approved_tasks) * 100, 2)
          END AS rework_rate,
          CASE
            WHEN COALESCE(at.timed_approved_tasks, 0) = 0 THEN NULL
            ELSE ROUND((COALESCE(at.overdue_tasks, 0)::numeric / at.timed_approved_tasks) * 100, 2)
          END AS overdue_rate,
          at.avg_completion_time,
          COALESCE(us.eligible_users, 0) AS eligible_users,
          COALESCE(at.timed_approved_tasks, 0) AS timed_approved_tasks,
          COALESCE(at.overdue_tasks, 0) AS overdue_tasks,
          COALESCE(at.rework_tasks, 0) AS rework_tasks,
          us.average_user_score
        FROM active_departments d
        JOIN active_department_ids active_ids
          ON active_ids.department_id = d.id
        LEFT JOIN task_totals tt
          ON tt.department_id = d.id
        LEFT JOIN approved_totals at
          ON at.department_id = d.id
        LEFT JOIN user_scores us
          ON us.department_id = d.id
        WHERE COALESCE(tt.total_tasks, 0) > 0
           OR COALESCE(us.eligible_users, 0) > 0
      ),
      scored AS (
        SELECT
          base.*,
          CASE
            WHEN base.average_user_score IS NULL THEN NULL
            ELSE ROUND((base.average_user_score - (COALESCE(base.overdue_rate, 0) * $2::numeric))::numeric, 2)
          END AS score
        FROM base
      ),
      ranked AS (
        SELECT
          scored.*,
          CASE
            WHEN scored.score IS NULL THEN NULL
            ELSE DENSE_RANK() OVER (
              ORDER BY scored.score DESC, scored.approved_tasks DESC, scored.completion_rate DESC NULLS LAST, scored.department_id ASC
            )
          END AS department_rank
        FROM scored
      )
      INSERT INTO department_performance (
        department_id,
        total_tasks,
        approved_tasks,
        completion_rate,
        rework_rate,
        overdue_rate,
        avg_completion_time,
        score,
        rank,
        last_updated,
        timed_approved_tasks,
        overdue_tasks,
        rework_tasks,
        eligible_users
      )
      SELECT
        department_id,
        total_tasks,
        approved_tasks,
        completion_rate,
        rework_rate,
        overdue_rate,
        avg_completion_time,
        score,
        department_rank,
        NOW(),
        timed_approved_tasks,
        overdue_tasks,
        rework_tasks,
        eligible_users
      FROM ranked
    `,
    [departmentId, overduePenaltyFactor],
  );

  const scopeKeys = departmentId ? [departmentId, "global"] : ["global"];
  for (const scopeKey of scopeKeys) {
    await client.query(
      `
        INSERT INTO performance_analytics_state (scope_key, last_refreshed_at)
        VALUES ($1::text, NOW())
        ON CONFLICT (scope_key) DO UPDATE
        SET last_refreshed_at = EXCLUDED.last_refreshed_at
      `,
      [scopeKey],
    );
  }
}

async function getPerformanceAnalyticsState(scopeKey = "global", client = pool) {
  const result = await client.query(
    `
      SELECT scope_key, last_refreshed_at
      FROM performance_analytics_state
      WHERE scope_key = $1::text
      LIMIT 1
    `,
    [scopeKey],
  );

  return result.rows[0] || null;
}

async function listUserPerformance(departmentId, client = pool) {
  const result = await client.query(
    `
      SELECT
        up.user_id,
        u.name AS user_name,
        up.department_id,
        d.name AS department_name,
        up.approved_tasks,
        up.on_time_count,
        up.overdue_count,
        up.rework_count,
        up.score,
        up.rank,
        up.last_updated
      FROM user_performance up
      JOIN users u
        ON u.employee_id = up.user_id
      JOIN departments d
        ON d.id = up.department_id
      WHERE ($1::text IS NULL OR up.department_id = $1::text)
      ORDER BY up.rank ASC NULLS LAST, up.score DESC, u.name ASC
    `,
    [departmentId || null],
  );

  return result.rows.map((row) => ({
    user_id: row.user_id,
    user_name: row.user_name,
    department_id: row.department_id,
    department_name: row.department_name,
    approved_tasks: Number(row.approved_tasks || 0),
    on_time_count: Number(row.on_time_count || 0),
    overdue_count: Number(row.overdue_count || 0),
    rework_count: Number(row.rework_count || 0),
    score: roundNumber(row.score),
    rank: row.rank === null || row.rank === undefined ? null : Number(row.rank),
    last_updated: row.last_updated,
  }));
}

async function findUserPerformance(userId, client = pool) {
  const result = await client.query(
    `
      SELECT
        up.user_id,
        u.name AS user_name,
        up.department_id,
        d.name AS department_name,
        up.approved_tasks,
        up.on_time_count,
        up.overdue_count,
        up.rework_count,
        up.score,
        up.rank,
        up.last_updated
      FROM user_performance up
      JOIN users u
        ON u.employee_id = up.user_id
      JOIN departments d
        ON d.id = up.department_id
      WHERE up.user_id = $1::text
      LIMIT 1
    `,
    [userId],
  );

  if (!result.rows[0]) {
    return null;
  }

  const row = result.rows[0];
  return {
    user_id: row.user_id,
    user_name: row.user_name,
    department_id: row.department_id,
    department_name: row.department_name,
    approved_tasks: Number(row.approved_tasks || 0),
    on_time_count: Number(row.on_time_count || 0),
    overdue_count: Number(row.overdue_count || 0),
    rework_count: Number(row.rework_count || 0),
    score: roundNumber(row.score),
    rank: row.rank === null || row.rank === undefined ? null : Number(row.rank),
    last_updated: row.last_updated,
  };
}

async function listDepartmentPerformance(departmentId = null, client = pool) {
  const result = await client.query(
    `
      SELECT
        dp.department_id,
        d.name AS department_name,
        dp.total_tasks,
        dp.approved_tasks,
        dp.completion_rate,
        dp.rework_rate,
        dp.overdue_rate,
        dp.avg_completion_time,
        dp.score,
        dp.rank,
        dp.last_updated,
        dp.eligible_users
      FROM department_performance dp
      JOIN departments d
        ON d.id = dp.department_id
      WHERE ($1::text IS NULL OR dp.department_id = $1::text)
      ORDER BY dp.rank ASC NULLS LAST, dp.score DESC NULLS LAST, d.name ASC
    `,
    [departmentId],
  );

  return result.rows.map((row) => ({
    department_id: row.department_id,
    department_name: row.department_name,
    total_tasks: Number(row.total_tasks || 0),
    approved_tasks: Number(row.approved_tasks || 0),
    completion_rate: roundNumber(row.completion_rate),
    rework_rate: roundNumber(row.rework_rate),
    overdue_rate: roundNumber(row.overdue_rate),
    avg_completion_time: roundNumber(row.avg_completion_time),
    score: roundNumber(row.score),
    rank: row.rank === null || row.rank === undefined ? null : Number(row.rank),
    eligible_users: Number(row.eligible_users || 0),
    last_updated: row.last_updated,
  }));
}

async function getPerformanceOverview(departmentId = null, client = pool) {
  const result = await client.query(
    `
      SELECT
        COALESCE(SUM(total_tasks), 0)::int AS total_tasks,
        COALESCE(SUM(approved_tasks), 0)::int AS approved_tasks,
        COALESCE(SUM(rework_tasks), 0)::int AS rework_tasks,
        COALESCE(SUM(overdue_tasks), 0)::int AS overdue_tasks,
        COALESCE(SUM(timed_approved_tasks), 0)::int AS timed_approved_tasks,
        MAX(last_updated) AS last_updated
      FROM department_performance
      WHERE ($1::text IS NULL OR department_id = $1::text)
    `,
    [departmentId],
  );

  const row = result.rows[0] || {};
  const totalTasks = Number(row.total_tasks || 0);
  const approvedTasks = Number(row.approved_tasks || 0);
  const reworkTasks = Number(row.rework_tasks || 0);
  const overdueTasks = Number(row.overdue_tasks || 0);
  const timedApprovedTasks = Number(row.timed_approved_tasks || 0);

  return {
    total_tasks: totalTasks,
    approved_tasks: approvedTasks,
    approval_rate: totalTasks > 0 ? roundNumber((approvedTasks / totalTasks) * 100) : null,
    overdue_rate: timedApprovedTasks > 0 ? roundNumber((overdueTasks / timedApprovedTasks) * 100) : null,
    rework_rate: approvedTasks > 0 ? roundNumber((reworkTasks / approvedTasks) * 100) : null,
    last_updated: row.last_updated || null,
    has_data: totalTasks > 0,
  };
}

async function getUserDrilldownFacts(userId, client = pool) {
  const taskResult = await client.query(
    `
      SELECT
        t.id AS task_id,
        COALESCE(t.internal_identifier, t.description, CONCAT('Task #', t.id::text)) AS title,
        t.status,
        t.priority,
        t.project_name,
        t.scope_name,
        t.remarks,
        t.due_date,
        t.submitted_at,
        COALESCE(t.approved_at, t.closed_at, t.verified_at) AS approved_at,
        COALESCE(t.rejection_count, 0) AS rejection_count,
        CASE
          WHEN COALESCE(t.actual_minutes, 0) > 0 THEN t.actual_minutes
          WHEN COALESCE(t.approved_at, t.closed_at, t.verified_at) IS NOT NULL
            AND COALESCE(t.started_at, t.assigned_at, t.created_at) IS NOT NULL
            AND COALESCE(t.approved_at, t.closed_at, t.verified_at) >= COALESCE(t.started_at, t.assigned_at, t.created_at)
          THEN GREATEST(
            1,
            ROUND(
              EXTRACT(EPOCH FROM (
                COALESCE(t.approved_at, t.closed_at, t.verified_at)
                - COALESCE(t.started_at, t.assigned_at, t.created_at)
              )) / 60.0
            )::int
          )
          ELSE NULL
        END AS completion_minutes,
        CASE
          WHEN t.due_date IS NOT NULL
            AND COALESCE(t.approved_at, t.closed_at, t.verified_at) <= t.due_date
          THEN TRUE
          ELSE FALSE
        END AS is_on_time,
        CASE
          WHEN t.due_date IS NOT NULL
            AND COALESCE(t.approved_at, t.closed_at, t.verified_at) > t.due_date
          THEN TRUE
          ELSE FALSE
        END AS is_overdue,
        CASE
          WHEN t.due_date IS NOT NULL
            AND COALESCE(t.approved_at, t.closed_at, t.verified_at) > t.due_date
          THEN ROUND(
            EXTRACT(EPOCH FROM (
              COALESCE(t.approved_at, t.closed_at, t.verified_at) - t.due_date
            )) / 3600.0,
            2
          )
          ELSE NULL
        END AS delay_hours
      FROM tasks t
      JOIN users u
        ON u.employee_id = COALESCE(NULLIF(t.assigned_user_id, ''), t.assigned_to)
      WHERE u.employee_id = $1::text
        AND COALESCE(u.is_active, TRUE) = TRUE
        AND t.status <> 'cancelled'
        AND COALESCE(t.approved_at, t.closed_at, t.verified_at) IS NOT NULL
        AND (
          t.status = 'closed'
          OR t.verification_status = 'approved'
          OR t.approved_at IS NOT NULL
        )
      ORDER BY COALESCE(t.approved_at, t.closed_at, t.verified_at) DESC, t.id DESC
    `,
    [userId],
  );

  return taskResult.rows.map((row) => ({
    task_id: Number(row.task_id),
    title: row.title,
    status: row.status,
    priority: row.priority,
    project_name: row.project_name || null,
    scope_name: row.scope_name || null,
    remarks: row.remarks || null,
    due_date: row.due_date || null,
    submitted_at: row.submitted_at || null,
    approved_at: row.approved_at || null,
    rejection_count: Number(row.rejection_count || 0),
    completion_minutes: row.completion_minutes === null || row.completion_minutes === undefined
      ? null
      : Number(row.completion_minutes),
    is_on_time: row.is_on_time === true,
    is_overdue: row.is_overdue === true,
    delay_hours: row.delay_hours === null || row.delay_hours === undefined
      ? null
      : roundNumber(row.delay_hours),
  }));
}

module.exports = {
  ensurePerformanceAnalyticsTables,
  findUserPerformance,
  getPerformanceAnalyticsState,
  getPerformanceOverview,
  getUserDrilldownFacts,
  listDepartmentPerformance,
  listUserPerformance,
  refreshPerformanceAnalytics,
};
