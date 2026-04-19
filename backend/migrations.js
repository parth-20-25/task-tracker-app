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

    // --- Modify Existing Tables ---
    console.log("Modifying existing tables...");
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
      ADD COLUMN IF NOT EXISTS rework_date DATE
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
      CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_department_unique_record
      ON projects (department_id, project_no, scope_name, quantity_index)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_projects_department_created_at
      ON projects (department_id, created_at DESC)
    `);

    await client.query(`
      ALTER TABLE projects
      ADD COLUMN IF NOT EXISTS project_name TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS customer_name TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS instance_count INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS rework_date DATE
    `);

    await ensureDesignDepartmentSchema(client);

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
