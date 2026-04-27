const { Pool } = require("pg");
const { env } = require("./config/env");
const { ensureDesignDepartmentSchema } = require("./repositories/designSchemaRepository");
const { seedPermissions } = require("./repositories/permissionRepository");

const pool = new Pool({
  user: env.db.user,
  host: env.db.host,
  database: env.db.database,
  password: env.db.password,
  port: env.db.port,
});

async function runMigrations() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);

    // --- RBAC System Tables ---
    console.log("Creating RBAC tables...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS permissions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS role_permissions (
        role_id VARCHAR(20) REFERENCES roles(id) ON DELETE CASCADE,
        permission_id TEXT REFERENCES permissions(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (role_id, permission_id)
      )
    `);

    // --- Workflow Engine Tables ---
    console.log("Creating Workflow Engine tables...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS workflows (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        department_id TEXT REFERENCES departments(id),
        initial_stage_id TEXT,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(department_id)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS workflow_stages (
        id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
        stage_name TEXT NOT NULL,
        name TEXT NOT NULL,
        sequence_order INTEGER,
        description TEXT,
        is_final BOOLEAN NOT NULL DEFAULT FALSE,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_workflows_department_unique
      ON workflows (department_id)
      WHERE department_id IS NOT NULL
    `);

    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'fk_initial_stage'
        ) THEN
          ALTER TABLE workflows
          ADD CONSTRAINT fk_initial_stage
          FOREIGN KEY (initial_stage_id) REFERENCES workflow_stages(id);
        END IF;
      END $$;
    `);

    // Ignore if constraint already exists

    await client.query(`
      CREATE TABLE IF NOT EXISTS workflow_transitions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
        from_stage_id TEXT NOT NULL REFERENCES workflow_stages(id) ON DELETE CASCADE,
        to_stage_id TEXT NOT NULL REFERENCES workflow_stages(id) ON DELETE CASCADE,
        action_name TEXT NOT NULL,
        required_permission TEXT REFERENCES permissions(id),
        conditions JSONB DEFAULT '{}'::jsonb,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // --- Fixture Workflow Progress ---
    console.log("Creating fixture workflow progress table...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS fixture_workflow_progress (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        fixture_id UUID NOT NULL REFERENCES design.fixtures(id) ON DELETE CASCADE,
        department_id TEXT NOT NULL REFERENCES departments(id),
        stage_name TEXT NOT NULL,
        stage_order INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING',
        assigned_to VARCHAR(50),
        assigned_at TIMESTAMPTZ,
        started_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        duration_minutes INTEGER,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT fwp_status_check CHECK (status IN ('PENDING','IN_PROGRESS','APPROVED','REJECTED')),
        CONSTRAINT fwp_unique_fixture_stage UNIQUE (fixture_id, stage_name)
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_fwp_fixture_department
      ON fixture_workflow_progress (fixture_id, department_id)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_fwp_department_status
      ON fixture_workflow_progress (department_id, status)
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS fixture_workflow_stage_attempts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        fixture_id UUID NOT NULL REFERENCES design.fixtures(id) ON DELETE CASCADE,
        department_id TEXT NOT NULL REFERENCES departments(id),
        stage_name TEXT NOT NULL,
        attempt_no INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'IN_PROGRESS',
        assigned_to VARCHAR(50),
        assigned_at TIMESTAMPTZ,
        started_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        duration_minutes INTEGER,
        approved_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT fwsa_status_check CHECK (status IN ('IN_PROGRESS', 'COMPLETED', 'APPROVED', 'REJECTED')),
      CONSTRAINT fwsa_unique_fixture_stage_attempt UNIQUE (fixture_id, stage_name, attempt_no)
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS fixture_workflow (
      fixture_id UUID PRIMARY KEY,
      current_stage TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_fwsa_fixture_stage_attempt
      ON fixture_workflow_stage_attempts (fixture_id, stage_name, attempt_no)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_fwsa_department_status
      ON fixture_workflow_stage_attempts (department_id, status)
    `);

    // --- Modify Existing Tables ---
    console.log("Modifying existing tables...");
    await client.query(`
      ALTER TABLE fixture_workflow_progress
      ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ
    `);

    await client.query(`
      ALTER TABLE fixture_workflow_progress
      ADD COLUMN IF NOT EXISTS duration_minutes INTEGER
    `);

    await client.query(`
      UPDATE fixture_workflow_progress
      SET assigned_at = COALESCE(assigned_at, started_at)
      WHERE assigned_at IS NULL
        AND started_at IS NOT NULL
    `);

    await client.query(`
      UPDATE fixture_workflow_progress
      SET duration_minutes = GREATEST(
        1,
        ROUND(EXTRACT(EPOCH FROM (completed_at - COALESCE(assigned_at, started_at))) / 60.0)::INTEGER
      )
      WHERE duration_minutes IS NULL
        AND completed_at IS NOT NULL
        AND COALESCE(assigned_at, started_at) IS NOT NULL
        AND completed_at >= COALESCE(assigned_at, started_at)
    `);

    await client.query(`
      ALTER TABLE fixture_workflow_stage_attempts
      ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ
    `);

    await client.query(`
      ALTER TABLE fixture_workflow_stage_attempts
      ADD COLUMN IF NOT EXISTS duration_minutes INTEGER
    `);

    await client.query(`
      UPDATE fixture_workflow_stage_attempts
      SET assigned_at = COALESCE(assigned_at, started_at)
      WHERE assigned_at IS NULL
        AND started_at IS NOT NULL
    `);

    await client.query(`
      UPDATE fixture_workflow_stage_attempts
      SET duration_minutes = GREATEST(
        1,
        ROUND(EXTRACT(EPOCH FROM (completed_at - COALESCE(assigned_at, started_at))) / 60.0)::INTEGER
      )
      WHERE duration_minutes IS NULL
        AND completed_at IS NOT NULL
        AND COALESCE(assigned_at, started_at) IS NOT NULL
        AND completed_at >= COALESCE(assigned_at, started_at)
    `);

    await client.query(`
      ALTER TABLE workflow_stages
      ADD COLUMN IF NOT EXISTS stage_name TEXT
    `);

    await client.query(`
      UPDATE workflow_stages
      SET stage_name = COALESCE(NULLIF(stage_name, ''), NULLIF(name, ''), id)
      WHERE stage_name IS NULL OR stage_name = ''
    `);

    await client.query(`
      ALTER TABLE workflow_stages
      ADD COLUMN IF NOT EXISTS sequence_order INTEGER
    `);

    await client.query(`
      UPDATE workflow_stages
      SET sequence_order = COALESCE(sequence_order, 0)
      WHERE sequence_order IS NULL
    `);

    await client.query(`
      ALTER TABLE tasks
      ADD COLUMN IF NOT EXISTS workflow_id TEXT REFERENCES workflows(id),
      ADD COLUMN IF NOT EXISTS current_stage_id TEXT REFERENCES workflow_stages(id),
      ADD COLUMN IF NOT EXISTS lifecycle_status TEXT NOT NULL DEFAULT 'assigned',
      ADD COLUMN IF NOT EXISTS project_name TEXT,
      ADD COLUMN IF NOT EXISTS customer_name TEXT,
      ADD COLUMN IF NOT EXISTS instance_count INTEGER,
      ADD COLUMN IF NOT EXISTS rework_date DATE,
      ADD COLUMN IF NOT EXISTS assigned_user_id VARCHAR(50),
      ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS due_date TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS sla_due_date TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS rejection_count INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS project_id UUID,
      ADD COLUMN IF NOT EXISTS scope_id UUID,
      ADD COLUMN IF NOT EXISTS fixture_id UUID,
      ADD COLUMN IF NOT EXISTS fixture_no TEXT,
      ADD COLUMN IF NOT EXISTS stage TEXT
    `);

    await client.query(`
      UPDATE fixture_workflow_progress
      SET status = 'IN_PROGRESS'
      WHERE status = 'COMPLETED'
    `);

    await client.query(`
      ALTER TABLE fixture_workflow_progress
      DROP CONSTRAINT IF EXISTS fwp_status_check
    `);

    await client.query(`
      ALTER TABLE fixture_workflow_progress
      ADD CONSTRAINT fwp_status_check
      CHECK (status IN ('PENDING','IN_PROGRESS','APPROVED','REJECTED'))
    `);

    await client.query(`
      UPDATE tasks
      SET lifecycle_status = CASE
        WHEN status = 'closed' THEN 'completed'
        WHEN status = 'cancelled' THEN 'cancelled'
        WHEN status = 'rework' THEN 'rework'
        WHEN status IN ('in_progress', 'on_hold', 'under_review') THEN 'in_progress'
        ELSE 'assigned'
      END
      WHERE lifecycle_status IS NULL
         OR lifecycle_status = ''
    `);

    await client.query(`
      UPDATE tasks
      SET assigned_user_id = COALESCE(NULLIF(assigned_user_id, ''), assigned_to),
          due_date = COALESCE(due_date, deadline),
          sla_due_date = COALESCE(sla_due_date, due_date, deadline)
      WHERE assigned_user_id IS NULL
         OR assigned_user_id = ''
         OR due_date IS NULL
         OR sla_due_date IS NULL
    `);

    await client.query(`
      UPDATE tasks
      SET submitted_at = COALESCE(
        submitted_at,
        completed_at,
        CASE WHEN status IN ('under_review', 'rework', 'closed') THEN updated_at END,
        created_at
      )
      WHERE submitted_at IS NULL
        AND status IN ('under_review', 'rework', 'closed')
    `);

    await client.query(`
      UPDATE tasks
      SET approved_at = COALESCE(approved_at, closed_at, verified_at)
      WHERE approved_at IS NULL
        AND (
          status = 'closed'
          OR verification_status = 'approved'
          OR closed_at IS NOT NULL
          OR verified_at IS NOT NULL
        )
    `);

    await client.query(`
      UPDATE tasks t
      SET project_id = COALESCE(t.project_id, f.project_id),
          scope_id = COALESCE(t.scope_id, f.scope_id),
          fixture_no = COALESCE(NULLIF(t.fixture_no, ''), f.fixture_no)
      FROM design.fixtures f
      WHERE t.fixture_id = f.id
        AND (
          t.project_id IS NULL
          OR t.scope_id IS NULL
          OR COALESCE(t.fixture_no, '') = ''
        )
    `);

    await client.query(`
      UPDATE tasks t
      SET project_id = COALESCE(t.project_id, p.id),
          scope_id = COALESCE(t.scope_id, s.id),
          fixture_no = COALESCE(NULLIF(t.fixture_no, ''), f.fixture_no)
      FROM design.projects p
      JOIN design.scopes s
        ON s.project_id = p.id
      JOIN design.fixtures f
        ON f.scope_id = s.id
      WHERE t.project_id IS NULL
        AND t.scope_id IS NULL
        AND COALESCE(t.fixture_no, '') = ''
        AND p.department_id = t.department_id
        AND p.project_no = t.project_no
        AND s.scope_name = t.scope_name
        AND f.fixture_no = t.quantity_index
    `);

    await client.query(`
      UPDATE tasks
      SET rejection_count = GREATEST(
        COALESCE(rejection_count, 0),
        CASE
          WHEN status = 'rework' OR verification_status = 'rejected' THEN 1
          ELSE 0
        END
      )
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_task_per_stage
      ON tasks (fixture_id, stage)
      WHERE status NOT IN ('closed','cancelled')
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_tasks_approved_at
      ON tasks (approved_at)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_tasks_department_approved_at
      ON tasks (department_id, approved_at)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_tasks_assigned_user_approved_at
      ON tasks (assigned_user_id, approved_at)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_tasks_project_scope_fixture_identity
      ON tasks (project_id, scope_id, fixture_no)
    `);

    await client.query(`
      ALTER TABLE escalation_rules
      ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE
    `);

    // --- Additional Admin Tables ---
    console.log("Creating additional admin tables...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS shifts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        start_time TIME NOT NULL,
        end_time TIME NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS machines (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        department_id TEXT REFERENCES departments(id),
        location TEXT,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS projects (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_no TEXT NOT NULL,
        project_name TEXT NOT NULL DEFAULT '',
        customer_name TEXT NOT NULL DEFAULT '',
        instance_count INTEGER NOT NULL DEFAULT 0,
        rework_date DATE,
        project_description TEXT NOT NULL DEFAULT '',
        scope_name TEXT NOT NULL DEFAULT '',
        quantity_index TEXT NOT NULL DEFAULT '',
        department_id TEXT NOT NULL REFERENCES departments(id),
        uploaded_by VARCHAR(50),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      DROP INDEX IF EXISTS public.idx_projects_department_unique_record
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_projects_department_project_scope
      ON projects (department_id, project_no, scope_name)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_projects_department_created_at
      ON projects (department_id, created_at DESC)
    `);

    await client.query(`
      ALTER TABLE projects
      ADD COLUMN IF NOT EXISTS project_name TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS customer_name TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS scope_name TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS quantity_index TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS instance_count INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS rework_date DATE
    `);

    await ensureDesignDepartmentSchema(client);

    await client.query(`
      CREATE TABLE IF NOT EXISTS issues (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        created_by VARCHAR(50) NOT NULL REFERENCES users(employee_id),
        assigned_to VARCHAR(50) NOT NULL REFERENCES users(employee_id),
        department_id TEXT REFERENCES departments(id),
        priority TEXT NOT NULL DEFAULT 'MEDIUM',
        status TEXT NOT NULL DEFAULT 'OPEN',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT issues_priority_check CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH')),
        CONSTRAINT issues_status_check CHECK (status IN ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'))
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_issues_created_by_created_at
      ON issues (created_by, created_at DESC)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_issues_assigned_to_created_at
      ON issues (assigned_to, created_at DESC)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_issues_department_status
      ON issues (department_id, status)
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS issue_comments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        issue_id UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
        user_id VARCHAR(50) NOT NULL REFERENCES users(employee_id),
        message TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_issue_comments_issue_created_at
      ON issue_comments (issue_id, created_at ASC)
    `);

    // --- Task Execution Tracking ---
    console.log("Creating task execution tracking tables...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS task_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        step_name TEXT,
        status TEXT,
        updated_by VARCHAR(50),
        user_employee_id VARCHAR(50),
        action TEXT NOT NULL,
        notes TEXT,
        timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`ALTER TABLE task_logs ADD COLUMN IF NOT EXISTS step_name TEXT`);
    await client.query(`ALTER TABLE task_logs ADD COLUMN IF NOT EXISTS status TEXT`);
    await client.query(`ALTER TABLE task_logs ADD COLUMN IF NOT EXISTS updated_by VARCHAR(50)`);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_task_logs_task_timestamp
      ON task_logs (task_id, timestamp DESC)
    `);

    await client.query(`
      CREATE OR REPLACE FUNCTION prevent_task_logs_mutation()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'task_logs is append-only';
      END;
      $$ LANGUAGE plpgsql
    `);

    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_trigger
          WHERE tgname = 'trg_task_logs_append_only'
        ) THEN
          CREATE TRIGGER trg_task_logs_append_only
          BEFORE UPDATE OR DELETE ON task_logs
          FOR EACH ROW
          EXECUTE FUNCTION prevent_task_logs_mutation();
        END IF;
      END $$;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS task_checklists (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        item TEXT NOT NULL,
        is_completed BOOLEAN NOT NULL DEFAULT FALSE,
        completed_at TIMESTAMPTZ,
        completed_by VARCHAR(50),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS jobs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        type TEXT NOT NULL,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        status TEXT NOT NULL DEFAULT 'pending',
        priority INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        started_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        failed_at TIMESTAMPTZ,
        error_message TEXT
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_jobs_status_priority_created
      ON jobs (status, priority DESC, created_at ASC)
    `);

    // --- Seed Initial Permissions ---
    console.log("Seeding initial permissions...");
    await seedPermissions(client);

    await client.query("COMMIT");
    console.log("Migrations completed successfully.");
  } catch (error) {
    await client.query("ROLLBACK");
    console.log("Migrations failed:", error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations().catch(err => {
  console.error(err);
  process.exit(1);
});
