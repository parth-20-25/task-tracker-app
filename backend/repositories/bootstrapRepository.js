const bcrypt = require("bcrypt");
const { departments, roles } = require("../seedData");
const { PERMISSIONS, ROLE_DEFAULT_PERMISSIONS } = require("../config/constants");
const { assignPermissionsToRole, seedPermissions } = require("./permissionRepository");
const { ensurePerformanceAnalyticsTables } = require("./performanceAnalyticsRepository");

function buildSeedRolePermissions(role) {
  if (role.permissions?.all === true) {
    return Object.values(PERMISSIONS).reduce((permissionMap, permissionId) => {
      permissionMap[permissionId] = true;
      return permissionMap;
    }, {});
  }

  const defaultPermissionIds = ROLE_DEFAULT_PERMISSIONS[role.id];

  if (!Array.isArray(defaultPermissionIds) || defaultPermissionIds.length === 0) {
    return role.permissions || {};
  }

  return defaultPermissionIds.reduce((permissionMap, permissionId) => {
    permissionMap[permissionId] = true;
    return permissionMap;
  }, {});
}

async function safeCreateIndex(client, statement, indexName) {
  try {
    await client.query(statement);
  } catch (error) {
    console.warn(`Index skipped${indexName ? ` (${indexName})` : ""}: ${error.message}`);
  }
}

async function ensureUsersTable(client) {
  await client.query(`SET search_path TO public`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      employee_id VARCHAR(50) UNIQUE NOT NULL,
      email TEXT,
      role VARCHAR(20) NOT NULL,
      parent_id VARCHAR(50),
      department_id TEXT,
      password_hash TEXT NOT NULL,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT`);
  await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS parent_id VARCHAR(50)`);
  await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`);

  await safeCreateIndex(client, `
    CREATE INDEX IF NOT EXISTS idx_users_parent_id
    ON users (parent_id)
  `, "idx_users_parent_id");
}

async function ensureTasksTable(client) {
  await client.query(`SET search_path TO public`); 
  await client.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id SERIAL PRIMARY KEY,
      internal_identifier TEXT,
      description TEXT,
      assigned_to VARCHAR(50),
      assigned_by VARCHAR(50),
      department_id TEXT,
      status VARCHAR(50),
      priority VARCHAR(50),
      deadline TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW(),
      verification_status VARCHAR(50)
    )
  `);

  const taskColumnStatements = [
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS started_at TIMESTAMP`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMP`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS proof_url TEXT[] DEFAULT '{}'::text[]`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS proof_type TEXT`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS remarks TEXT`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS internal_identifier TEXT`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assignee_ids JSONB NOT NULL DEFAULT '[]'::jsonb`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS planned_minutes INTEGER DEFAULT 0`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS actual_minutes INTEGER DEFAULT 0`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS kpi_target NUMERIC`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS kpi_status TEXT`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS machine_id TEXT`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS machine_name TEXT`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS location_tag TEXT`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurrence_rule TEXT`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS dependency_ids JSONB NOT NULL DEFAULT '[]'::jsonb`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS escalation_level INTEGER DEFAULT 0`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS next_escalation_at TIMESTAMP`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS last_escalated_at TIMESTAMP`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS requires_quality_approval BOOLEAN DEFAULT FALSE`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS approval_stage TEXT DEFAULT 'manager'`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS proof_name TEXT`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS proof_mime TEXT`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS proof_size INTEGER`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS closed_at TIMESTAMP`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS shift_id TEXT`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS project_no TEXT`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS project_description TEXT`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS project_name TEXT`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS customer_name TEXT`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS scope_name TEXT`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS quantity_index TEXT`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS instance_count INTEGER`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS rework_date DATE`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS lifecycle_status TEXT NOT NULL DEFAULT 'assigned'`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assigned_user_id VARCHAR(50)`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS due_date TIMESTAMPTZ`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS sla_due_date TIMESTAMPTZ`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS rejection_count INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS project_id UUID`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS scope_id UUID`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS fixture_id UUID`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS fixture_no TEXT`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS stage TEXT`,
  ];

  for (const statement of taskColumnStatements) {
    await client.query(statement);
  }

  await client.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'tasks'
          AND column_name = 'proof_url'
          AND udt_name = 'text'
      ) THEN
        ALTER TABLE tasks
        ALTER COLUMN proof_url TYPE TEXT[]
        USING CASE
          WHEN proof_url IS NULL OR btrim(proof_url) = '' THEN '{}'::text[]
          ELSE ARRAY[proof_url]
        END;
      END IF;
    END $$;
  `);

  await client.query(`ALTER TABLE tasks ALTER COLUMN proof_url SET DEFAULT '{}'::text[]`);

  await client.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'tasks'
          AND column_name = 'title'
      ) THEN
        UPDATE tasks
        SET internal_identifier = COALESCE(NULLIF(internal_identifier, ''), NULLIF(title, ''), CONCAT('TASK-', id::text))
        WHERE internal_identifier IS NULL OR internal_identifier = '';

        ALTER TABLE tasks DROP COLUMN title;
      END IF;
    END $$;
  `);

  await client.query(`
    UPDATE tasks
    SET project_name = COALESCE(NULLIF(project_name, ''), NULLIF(project_description, ''))
    WHERE project_name IS NULL OR project_name = ''
  `);

  await client.query(`
    UPDATE tasks
    SET instance_count = NULLIF(REGEXP_REPLACE(COALESCE(quantity_index, ''), '[^0-9-]', '', 'g'), '')::integer
    WHERE instance_count IS NULL
      AND COALESCE(quantity_index, '') ~ '^-?[0-9]+$'
  `);

  await safeCreateIndex(client, `
    CREATE INDEX IF NOT EXISTS idx_tasks_status_next_escalation_at
    ON tasks (status, next_escalation_at)
  `, "idx_tasks_status_next_escalation_at");

  await safeCreateIndex(client, `
    CREATE INDEX IF NOT EXISTS idx_tasks_status_deadline
    ON tasks (status, deadline)
  `, "idx_tasks_status_deadline");

  await safeCreateIndex(client, `
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_task_per_stage
    ON tasks (fixture_id, stage)
    WHERE status NOT IN ('closed','cancelled')
  `, "uniq_active_task_per_stage");

  await safeCreateIndex(client, `
    CREATE INDEX IF NOT EXISTS idx_tasks_approved_at
    ON tasks (approved_at)
  `, "idx_tasks_approved_at");

  await safeCreateIndex(client, `
    CREATE INDEX IF NOT EXISTS idx_tasks_department_approved_at
    ON tasks (department_id, approved_at)
  `, "idx_tasks_department_approved_at");

  await safeCreateIndex(client, `
    CREATE INDEX IF NOT EXISTS idx_tasks_assigned_user_approved_at
    ON tasks (assigned_user_id, approved_at)
  `, "idx_tasks_assigned_user_approved_at");

  await safeCreateIndex(client, `
    CREATE INDEX IF NOT EXISTS idx_tasks_project_scope_fixture_identity
    ON tasks (project_id, scope_id, fixture_no)
  `, "idx_tasks_project_scope_fixture_identity");

  await client.query(`
    UPDATE tasks
    SET assignee_ids = to_jsonb(ARRAY[assigned_to]::text[])
    WHERE jsonb_array_length(assignee_ids) = 0
      AND assigned_to IS NOT NULL
  `);

  await client.query(`
    UPDATE tasks
    SET assigned_at = COALESCE(assigned_at, created_at, NOW())
    WHERE assigned_at IS NULL
  `);

  await client.query(`
    UPDATE tasks
    SET assigned_user_id = COALESCE(NULLIF(assigned_user_id, ''), assigned_to)
    WHERE assigned_user_id IS NULL OR assigned_user_id = ''
  `);

  await client.query(`
  DO $$
  BEGIN
    IF EXISTS (
      SELECT 1 FROM information_schema.tables 
      WHERE table_schema = 'design' AND table_name = 'projects'
    )
    AND EXISTS (
      SELECT 1 FROM information_schema.tables 
      WHERE table_schema = 'design' AND table_name = 'scopes'
    )
    AND EXISTS (
      SELECT 1 FROM information_schema.tables 
      WHERE table_schema = 'design' AND table_name = 'fixtures'
    )
    THEN

      UPDATE tasks t
      SET project_id = COALESCE(t.project_id, p.id),
          scope_id = COALESCE(t.scope_id, s.id),
          fixture_no = COALESCE(NULLIF(t.fixture_no, ''), f.fixture_no)
      FROM design.projects p
      JOIN design.scopes s ON s.project_id = p.id
      JOIN design.fixtures f ON f.scope_id = s.id
      WHERE t.project_id IS NULL
        AND t.scope_id IS NULL
        AND COALESCE(t.fixture_no, '') = ''
        AND p.department_id = t.department_id
        AND p.project_no = t.project_no
        AND s.scope_name = t.scope_name
        AND f.fixture_no = t.quantity_index;

    END IF;
  END $$;
  `);
  // Duplicate unguarded update referencing design.* removed.
  // The guarded DO $$ block above performs this update only when design tables exist.

  await client.query(`
    UPDATE tasks
    SET due_date = COALESCE(due_date, deadline),
        sla_due_date = COALESCE(sla_due_date, due_date, deadline)
    WHERE due_date IS NULL
       OR sla_due_date IS NULL
  `);

  await client.query(`UPDATE tasks SET status = 'assigned' WHERE status = 'not_started'`);
  await client.query(`UPDATE tasks SET status = 'under_review' WHERE status = 'completed' AND verification_status = 'pending'`);
  await client.query(`UPDATE tasks SET status = 'closed', closed_at = COALESCE(closed_at, verified_at, completed_at, NOW()) WHERE status = 'completed' AND verification_status = 'approved'`);
  await client.query(`UPDATE tasks SET status = 'rework' WHERE verification_status = 'rejected'`);
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
    UPDATE tasks
    SET rejection_count = GREATEST(
      COALESCE(rejection_count, 0),
      CASE
        WHEN status = 'rework' OR verification_status = 'rejected' THEN 1
        ELSE 0
      END
    )
  `);

}

async function ensureReferenceTables(client) {
  await client.query(`SET search_path TO public`);
  await ensurePerformanceAnalyticsTables(client);

  await client.query(`
    CREATE TABLE IF NOT EXISTS roles (
      id VARCHAR(20) PRIMARY KEY,
      name TEXT NOT NULL,
      hierarchy_level INTEGER NOT NULL,
      permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
      scope TEXT NOT NULL,
      parent_role VARCHAR(20),
      is_active BOOLEAN NOT NULL DEFAULT TRUE
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS departments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      parent_department TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS workflow_definitions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      department_id TEXT NOT NULL,
      workflow_name TEXT NOT NULL,
      stage_name TEXT NOT NULL,
      stage_order INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(department_id, workflow_name, stage_name)
    )
  `);

  await client.query(`ALTER TABLE roles ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE`);
  await client.query(`ALTER TABLE departments ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      user_employee_id VARCHAR(50),
      action_type TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS task_activity_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      user_employee_id VARCHAR(50),
      action_type TEXT NOT NULL,
      notes TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

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

  await safeCreateIndex(client, `
    CREATE INDEX IF NOT EXISTS idx_issues_created_by_created_at
    ON issues (created_by, created_at DESC)
  `, "idx_issues_created_by_created_at");

  await safeCreateIndex(client, `
    CREATE INDEX IF NOT EXISTS idx_issues_assigned_to_created_at
    ON issues (assigned_to, created_at DESC)
  `, "idx_issues_assigned_to_created_at");

  await safeCreateIndex(client, `
    CREATE INDEX IF NOT EXISTS idx_issues_department_status
    ON issues (department_id, status)
  `, "idx_issues_department_status");

  await client.query(`
    CREATE TABLE IF NOT EXISTS issue_comments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      issue_id UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      user_id VARCHAR(50) NOT NULL REFERENCES users(employee_id),
      message TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await safeCreateIndex(client, `
    CREATE INDEX IF NOT EXISTS idx_issue_comments_issue_created_at
    ON issue_comments (issue_id, created_at ASC)
  `, "idx_issue_comments_issue_created_at");

  await client.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_employee_id VARCHAR(50),
      department_id TEXT,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'info',
      target_type TEXT,
      target_id TEXT,
      read_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

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
      stage_name TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL,
      order_index INTEGER NOT NULL DEFAULT 0,
      description TEXT,
      is_final BOOLEAN NOT NULL DEFAULT FALSE,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await safeCreateIndex(client, `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_workflows_department_unique
    ON workflows (department_id)
    WHERE department_id IS NOT NULL
  `, "idx_workflows_department_unique");

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

  await client.query(`
    CREATE TABLE IF NOT EXISTS workflow_transitions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
      from_stage_id TEXT NOT NULL REFERENCES workflow_stages(id) ON DELETE CASCADE,
      to_stage_id TEXT NOT NULL REFERENCES workflow_stages(id) ON DELETE CASCADE,
      action_name TEXT NOT NULL,
      required_permission TEXT REFERENCES permissions(id),
      conditions JSONB NOT NULL DEFAULT '{}'::jsonb,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS fixture_workflow_progress (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      fixture_id UUID NOT NULL,
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

  await safeCreateIndex(client, `
    CREATE INDEX IF NOT EXISTS idx_fwp_fixture_department
    ON fixture_workflow_progress (fixture_id, department_id)
  `, "idx_fwp_fixture_department");

  await safeCreateIndex(client, `
    CREATE INDEX IF NOT EXISTS idx_fwp_department_status
    ON fixture_workflow_progress (department_id, status)
  `, "idx_fwp_department_status");

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
    CREATE TABLE IF NOT EXISTS fixture_workflow_stage_attempts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      fixture_id UUID NOT NULL,
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

  await safeCreateIndex(client, `
    CREATE INDEX IF NOT EXISTS idx_fwsa_fixture_stage_attempt
    ON fixture_workflow_stage_attempts (fixture_id, stage_name, attempt_no)
  `, "idx_fwsa_fixture_stage_attempt");

  await safeCreateIndex(client, `
    CREATE INDEX IF NOT EXISTS idx_fwsa_department_status
    ON fixture_workflow_stage_attempts (department_id, status)
  `, "idx_fwsa_department_status");

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

  await safeCreateIndex(client, `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_transitions_unique_action
    ON workflow_transitions (workflow_id, from_stage_id, action_name)
  `, "idx_workflow_transitions_unique_action");

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
    UPDATE workflow_stages
    SET name = COALESCE(NULLIF(name, ''), stage_name, id)
    WHERE name IS NULL OR name = ''
  `);

  await client.query(`
    ALTER TABLE workflow_stages
    ADD COLUMN IF NOT EXISTS order_index INTEGER NOT NULL DEFAULT 0
  `);

  await client.query(`
    ALTER TABLE workflow_stages
    ADD COLUMN IF NOT EXISTS sequence_order INTEGER
  `);

  await client.query(`
    UPDATE workflow_stages
    SET sequence_order = COALESCE(sequence_order, order_index, 0)
    WHERE sequence_order IS NULL
  `);

  await client.query(`
    ALTER TABLE departments
    ADD COLUMN IF NOT EXISTS workflow_id TEXT REFERENCES workflows(id)
  `);

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

  await safeCreateIndex(client, `
    CREATE INDEX IF NOT EXISTS idx_task_logs_task_timestamp
    ON task_logs (task_id, timestamp DESC)
  `, "idx_task_logs_task_timestamp");

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
    CREATE TABLE IF NOT EXISTS task_attachments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      file_url TEXT NOT NULL,
      file_path TEXT,
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      uploaded_by VARCHAR(50),
      uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await client.query(`
    ALTER TABLE task_attachments
    ADD COLUMN IF NOT EXISTS file_path TEXT
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS escalation_rules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      priority TEXT NOT NULL,
      after_minutes INTEGER NOT NULL,
      notify_role TEXT
    )
  `);

  await client.query(`
    ALTER TABLE escalation_rules
    ADD COLUMN IF NOT EXISTS department_id TEXT REFERENCES departments(id)
  `);

  await client.query(`
    ALTER TABLE escalation_rules
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE
  `);

  await safeCreateIndex(client, `
    CREATE INDEX IF NOT EXISTS idx_escalation_rules_priority_after_minutes
    ON escalation_rules (priority, after_minutes)
  `, "idx_escalation_rules_priority_after_minutes");

  await safeCreateIndex(client, `
    CREATE INDEX IF NOT EXISTS idx_escalation_rules_department_priority_after_minutes
    ON escalation_rules (department_id, priority, after_minutes)
  `, "idx_escalation_rules_department_priority_after_minutes");

  await client.query(`
    CREATE TABLE IF NOT EXISTS kpi_definitions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      target_value NUMERIC
    )
  `);

  await client.query(`
    ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS workflow_id TEXT REFERENCES workflows(id)
  `);

  await client.query(`
    ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS current_stage_id TEXT REFERENCES workflow_stages(id)
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS shifts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      department_id TEXT REFERENCES departments(id),
      start_time TIME,
      end_time TIME,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await client.query(`ALTER TABLE shifts ADD COLUMN IF NOT EXISTS start_time TIME`);
  await client.query(`ALTER TABLE shifts ADD COLUMN IF NOT EXISTS end_time TIME`);
  await client.query(`ALTER TABLE shifts ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE`);
  await client.query(`ALTER TABLE shifts ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
  await client.query(`ALTER TABLE shifts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
  await client.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'shifts'
          AND column_name = 'starts_at'
      ) THEN
        UPDATE shifts
        SET start_time = COALESCE(start_time, starts_at);
      END IF;
    END $$;
  `);
  await client.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'shifts'
          AND column_name = 'ends_at'
      ) THEN
        UPDATE shifts
        SET end_time = COALESCE(end_time, ends_at);
      END IF;
    END $$;
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

  await client.query(`ALTER TABLE machines ADD COLUMN IF NOT EXISTS location TEXT`);
  await client.query(`ALTER TABLE machines ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE`);
  await client.query(`ALTER TABLE machines ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
  await client.query(`ALTER TABLE machines ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
  await client.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'machines'
          AND column_name = 'location_tag'
      ) THEN
        UPDATE machines
        SET location = COALESCE(location, location_tag);
      END IF;
    END $$;
  `);

  await safeCreateIndex(client, `
    CREATE INDEX IF NOT EXISTS idx_users_role_department
    ON users (role, department_id)
  `, "idx_users_role_department");

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

  await safeCreateIndex(client, `
    CREATE INDEX IF NOT EXISTS idx_projects_department_project_scope
    ON projects (department_id, project_no, scope_name)
  `, "idx_projects_department_project_scope");

  await safeCreateIndex(client, `
    CREATE INDEX IF NOT EXISTS idx_projects_department_created_at
      ON projects (department_id, created_at DESC)
    `, "idx_projects_department_created_at");

  await client.query(`
    ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS project_name TEXT NOT NULL DEFAULT ''
  `);

  await client.query(`
    ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS customer_name TEXT NOT NULL DEFAULT ''
  `);

  await client.query(`
    ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS scope_name TEXT NOT NULL DEFAULT ''
  `);

  await client.query(`
    ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS quantity_index TEXT NOT NULL DEFAULT ''
  `);

  await client.query(`
    ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS instance_count INTEGER NOT NULL DEFAULT 0
  `);

  await client.query(`
    ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS rework_date DATE
  `);

  await client.query(`
    UPDATE projects
    SET project_name = COALESCE(NULLIF(project_name, ''), NULLIF(project_description, ''))
    WHERE project_name IS NULL OR project_name = ''
  `);

  await client.query(`
    UPDATE projects
    SET instance_count = NULLIF(REGEXP_REPLACE(COALESCE(quantity_index, ''), '[^0-9-]', '', 'g'), '')::integer
    WHERE instance_count = 0
      AND COALESCE(quantity_index, '') ~ '^-?[0-9]+$'
  `);

}

async function seedReferenceData(client) {
  for (const role of roles) {
    const rolePermissions = buildSeedRolePermissions(role);

    await client.query(
      `
        INSERT INTO roles (id, name, hierarchy_level, permissions, scope, parent_role)
        VALUES ($1, $2, $3, $4::jsonb, $5, $6)
        ON CONFLICT (id) DO UPDATE
        SET name = EXCLUDED.name,
            hierarchy_level = EXCLUDED.hierarchy_level,
            permissions = EXCLUDED.permissions,
            scope = EXCLUDED.scope,
            parent_role = EXCLUDED.parent_role
      `,
      [role.id, role.name, role.hierarchy_level, JSON.stringify(rolePermissions), role.scope, role.parent_role],
    );
  }

  for (const department of departments) {
    await client.query(
      `
        INSERT INTO departments (id, name, parent_department)
        VALUES ($1, $2, $3)
        ON CONFLICT (id) DO UPDATE
        SET name = EXCLUDED.name,
            parent_department = EXCLUDED.parent_department
      `,
      [department.id, department.name, department.parent_department],
    );
  }

  const kpis = [
    ["on_time_closure", "On-time Closure", "Percent of tasks closed before deadline", 90],
    ["rework_rate", "Rework Rate", "Percent of reviewed tasks sent to rework", 5],
    ["overdue_open_tasks", "Open Overdue Tasks", "Number of open tasks past deadline", 0],
  ];

  for (const kpi of kpis) {
    await client.query(
      `
        INSERT INTO kpi_definitions (id, name, description, target_value)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (id) DO UPDATE
        SET name = EXCLUDED.name,
            description = EXCLUDED.description,
            target_value = EXCLUDED.target_value
      `,
      kpi,
    );
  }

}

async function seedPermissionsAndWorkflows(client) {
  await seedPermissions(client);

  for (const [roleId, permissionIds] of Object.entries(ROLE_DEFAULT_PERMISSIONS)) {
    await assignPermissionsToRole(roleId, permissionIds, client, {
      autoCreateMissingPermissions: true,
      source: "bootstrapRepository.seedPermissionsAndWorkflows",
    });
  }

  // Seed default Design workflow
  const designStages = [
    ["design", "Design Workflow", "Concept", 10],
    ["design", "Design Workflow", "DAP", 20],
    ["design", "Design Workflow", "3D Finish", 30],
    ["design", "Design Workflow", "2D Finish", 40],
    ["design", "Design Workflow", "Release", 50],
  ];

  for (const [deptId, workflowName, stageName, stageOrder] of designStages) {
    await client.query(
      `
        INSERT INTO workflow_definitions (department_id, workflow_name, stage_name, stage_order)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (department_id, workflow_name, stage_name) DO UPDATE
        SET stage_order = EXCLUDED.stage_order,
            updated_at = NOW()
      `,
      [deptId, workflowName, stageName, stageOrder]
    );
  }
}

async function seedUsersIfNeeded(client) {
  const existingUsers = await client.query(`SELECT COUNT(*)::int AS count FROM users`);

  if (existingUsers.rows[0].count > 0) {
    return;
  }

  const defaultPasswordHash = await bcrypt.hash("op123", 10);
  const seedUsers = [
    ["Admin User", "EMP001", "r1", null],
    ["Plant Head", "EMP002", "r2", "d1"],
    ["Line Manager D1", "EMP003", "r3", "d1"],
    ["Line Manager D2", "EMP004", "r3", "d2"],
    ["Shift Incharge D1", "EMP005", "r4", "d1"],
    ["Shift Incharge D2", "EMP006", "r4", "d2"],
    ["Quality Inspector", "EMP007", "r5", "d2"],
    ["Maintenance Engineer", "EMP008", "r6", "d3"],
    ["Operator D1", "EMP009", "r7", "d1"],
    ["Operator D2", "EMP010", "r7", "d2"],
  ];

  for (const [name, employeeId, roleId, departmentId] of seedUsers) {
    await client.query(
      `
        INSERT INTO users (name, employee_id, role, department_id, password_hash, is_active, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, TRUE, NOW(), NOW())
      `,
      [name, employeeId, roleId, departmentId, defaultPasswordHash],
    );
  }
}

async function normalizeSeedUserPasswords(client) {
  const result = await client.query(`
    SELECT employee_id
    FROM users
    ORDER BY employee_id
  `);

  const employeeIds = result.rows.map((row) => row.employee_id);
  const expectedEmployeeIds = ["EMP001", "EMP002", "EMP003", "EMP004", "EMP005", "EMP006", "EMP007", "EMP008", "EMP009", "EMP010"];

  if (employeeIds.length !== expectedEmployeeIds.length) {
    return;
  }

  if (employeeIds.some((employeeId, index) => employeeId !== expectedEmployeeIds[index])) {
    return;
  }

  const passwordState = await client.query(`
    SELECT COUNT(DISTINCT password_hash)::int AS distinct_hashes
    FROM users
  `);

  if (passwordState.rows[0].distinct_hashes !== 1) {
    return;
  }

  const defaultPasswordHash = await bcrypt.hash("op123", 10);

  await client.query(
    `
      UPDATE users
      SET password_hash = $1,
          updated_at = NOW()
      WHERE employee_id = ANY($2::varchar[])
    `,
    [defaultPasswordHash, expectedEmployeeIds],
  );
}

async function syncTaskWorkflowState(client) {
  await client.query(`
    UPDATE tasks
    SET lifecycle_status = CASE
      WHEN status = 'closed' THEN 'completed'
      WHEN status = 'cancelled' THEN 'cancelled'
      WHEN status = 'rework' THEN 'rework'
      WHEN status IN ('in_progress', 'on_hold', 'under_review') THEN 'in_progress'
      ELSE 'assigned'
    END,
        updated_at = NOW()
    WHERE lifecycle_status IS NULL
       OR lifecycle_status = ''
  `);

  await client.query(`
    WITH first_stages AS (
      SELECT DISTINCT ON (workflow_id)
        workflow_id,
        id AS first_stage_id
      FROM workflow_stages
      WHERE is_active = TRUE
      ORDER BY workflow_id, sequence_order ASC, created_at ASC
    )
    UPDATE tasks t
    SET current_stage_id = fs.first_stage_id,
        updated_at = NOW()
    FROM first_stages fs
    WHERE t.workflow_id = fs.workflow_id
      AND t.current_stage_id IS NULL
  `);
}

async function syncTaskEscalationSchedule(client) {
  await client.query(`
    UPDATE tasks t
    SET next_escalation_at = (
      t.deadline
      + make_interval(
        mins => COALESCE((
          SELECT er.after_minutes
          FROM escalation_rules er
          WHERE er.priority = t.priority
            AND COALESCE(er.is_active, TRUE) = TRUE
            AND (er.department_id = t.department_id OR er.department_id IS NULL)
        ORDER BY
            CASE WHEN er.department_id = t.department_id THEN 0 ELSE 1 END,
            er.after_minutes,
            er.id
          LIMIT 1
        ), 0)
      )
    )
    WHERE t.deadline IS NOT NULL
      AND t.status NOT IN ('closed', 'cancelled')
      AND EXISTS (
        SELECT 1
        FROM escalation_rules er
        WHERE er.priority = t.priority
          AND COALESCE(er.is_active, TRUE) = TRUE
          AND (er.department_id = t.department_id OR er.department_id IS NULL)
      )
      AND (
        t.next_escalation_at IS NULL
        OR t.last_escalated_at IS NULL
      )
  `);
}

module.exports = {
  ensureReferenceTables,
  ensureTasksTable,
  ensureUsersTable,
  normalizeSeedUserPasswords,
  seedPermissionsAndWorkflows,
  seedReferenceData,
  seedUsersIfNeeded,
  syncTaskEscalationSchedule,
  syncTaskWorkflowState,
};
