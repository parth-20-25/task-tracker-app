const {
  CONTROL_DEPARTMENT_ID,
  CONTROL_DEPARTMENT_NAME,
  CONTROL_DESIGN_STAGES,
  CONTROL_DESIGN_TEMPLATE_NAME,
  CONTROL_SUB_DEPARTMENTS,
} = require("../lib/controlWorkflow");

async function ensureControlWorkflowSchema(client) {
  await client.query(`SET search_path TO public`);

  await client.query(`
    INSERT INTO departments (id, name, parent_department, is_active)
    VALUES ($1, $2, NULL, TRUE)
    ON CONFLICT (id) DO UPDATE
    SET name = EXCLUDED.name,
        is_active = TRUE
  `, [CONTROL_DEPARTMENT_ID, CONTROL_DEPARTMENT_NAME]);

  await client.query(`
    INSERT INTO department_subdivisions (department_id, subdivision_name, is_active)
    SELECT $1, seed.subdivision_name, TRUE
    FROM (VALUES ${CONTROL_SUB_DEPARTMENTS.map((_, index) => `($${index + 2})`).join(", ")}) AS seed(subdivision_name)
    ON CONFLICT (department_id, subdivision_name) DO UPDATE
    SET is_active = TRUE,
        updated_at = NOW()
  `, [CONTROL_DEPARTMENT_ID, ...CONTROL_SUB_DEPARTMENTS]);

  await client.query(`
    CREATE TABLE IF NOT EXISTS workflow_templates (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      department_id TEXT NOT NULL REFERENCES departments(id),
      template_name TEXT NOT NULL,
      description TEXT,
      default_priority TEXT,
      default_proof_required BOOLEAN NOT NULL DEFAULT TRUE,
      default_approval_required BOOLEAN NOT NULL DEFAULT TRUE,
      default_due_days INTEGER,
      escalation_level INTEGER NOT NULL DEFAULT 0,
      eligible_role_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by VARCHAR(50),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (department_id, template_name)
    )
  `);

  await client.query(`
    ALTER TABLE workflow_templates
    ADD COLUMN IF NOT EXISTS sub_department_id UUID REFERENCES department_subdivisions(id),
    ADD COLUMN IF NOT EXISTS workflow_family TEXT NOT NULL DEFAULT 'task'
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_workflow_templates_sub_department_active
    ON workflow_templates (sub_department_id, is_active, template_name)
    WHERE sub_department_id IS NOT NULL
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS workflow_template_stages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      template_id UUID NOT NULL REFERENCES workflow_templates(id) ON DELETE CASCADE,
      stage_name TEXT NOT NULL,
      sequence_order INTEGER NOT NULL,
      is_required BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT workflow_template_stages_template_order_unique UNIQUE (template_id, sequence_order),
      CONSTRAINT workflow_template_stages_template_name_unique UNIQUE (template_id, stage_name)
    )
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_workflow_template_stages_template_order
    ON workflow_template_stages (template_id, sequence_order)
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS project_workflows (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID NOT NULL REFERENCES design.projects(id) ON DELETE CASCADE,
      department_id TEXT NOT NULL REFERENCES departments(id),
      sub_department_id UUID NOT NULL REFERENCES department_subdivisions(id),
      template_id UUID NOT NULL REFERENCES workflow_templates(id),
      assigned_user_id VARCHAR(50) REFERENCES users(employee_id),
      assigned_by VARCHAR(50) REFERENCES users(employee_id),
      assigned_at TIMESTAMPTZ,
      current_stage_id UUID NULL,
      status TEXT NOT NULL DEFAULT 'active',
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT project_workflows_status_check CHECK (status IN ('active', 'completed', 'cancelled'))
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS project_control_records (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID NOT NULL REFERENCES design.projects(id) ON DELETE CASCADE,
      sub_department_id UUID NOT NULL REFERENCES department_subdivisions(id),
      budget_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
      budget_currency TEXT NOT NULL DEFAULT 'INR',
      status TEXT NOT NULL DEFAULT 'active',
      created_by VARCHAR(50) REFERENCES users(employee_id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT project_control_records_budget_non_negative_check CHECK (budget_amount >= 0),
      CONSTRAINT project_control_records_status_check CHECK (status IN ('active', 'cancelled'))
    )
  `);

  await client.query(`
    ALTER TABLE project_workflows
    ALTER COLUMN assigned_user_id DROP NOT NULL
  `);

  await client.query(`
    ALTER TABLE project_workflows
    ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ
  `);

  await client.query(`
    UPDATE project_workflows
    SET assigned_at = COALESCE(assigned_at, started_at, created_at)
    WHERE assigned_user_id IS NOT NULL
      AND assigned_at IS NULL
  `);

  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'project_control_records_budget_non_negative_check'
      ) THEN
        ALTER TABLE project_control_records
        ADD CONSTRAINT project_control_records_budget_non_negative_check
        CHECK (budget_amount >= 0);
      END IF;
    END $$;
  `);

  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_project_control_records_active_unique
    ON project_control_records (project_id, sub_department_id)
    WHERE status = 'active'
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_project_control_records_sub_department_status
    ON project_control_records (sub_department_id, status, updated_at DESC)
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS project_workflow_stages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workflow_id UUID NOT NULL REFERENCES project_workflows(id) ON DELETE CASCADE,
      template_stage_id UUID REFERENCES workflow_template_stages(id) ON DELETE SET NULL,
      stage_name TEXT NOT NULL,
      sequence_order INTEGER NOT NULL,
      is_required BOOLEAN NOT NULL DEFAULT TRUE,
      status TEXT NOT NULL DEFAULT 'locked',
      current_document_path TEXT,
      started_at TIMESTAMPTZ,
      submitted_at TIMESTAMPTZ,
      approved_at TIMESTAMPTZ,
      approved_by VARCHAR(50) REFERENCES users(employee_id),
      due_date TIMESTAMPTZ,
      remarks TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT project_workflow_stages_status_check CHECK (
        status IN (
          'locked',
          'not_started',
          'in_progress',
          'submitted_for_approval',
          'revision_required',
          'approved',
          'blocked',
          'pre_completed',
          'skipped_by_override'
        )
      ),
      CONSTRAINT project_workflow_stages_workflow_order_unique UNIQUE (workflow_id, sequence_order)
    )
  `);

  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'project_workflows_current_stage_id_fkey'
      ) THEN
        ALTER TABLE project_workflows
        ADD CONSTRAINT project_workflows_current_stage_id_fkey
        FOREIGN KEY (current_stage_id) REFERENCES project_workflow_stages(id) ON DELETE SET NULL;
      END IF;
    END $$;
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS workflow_stage_revisions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workflow_stage_id UUID NOT NULL REFERENCES project_workflow_stages(id) ON DELETE CASCADE,
      workflow_id UUID NOT NULL REFERENCES project_workflows(id) ON DELETE CASCADE,
      revision_reason TEXT NOT NULL,
      manual_reason TEXT,
      description TEXT NOT NULL,
      due_date TIMESTAMPTZ NOT NULL,
      priority TEXT,
      status TEXT NOT NULL DEFAULT 'not_started',
      raised_by VARCHAR(50) NOT NULL REFERENCES users(employee_id),
      assigned_to VARCHAR(50) NOT NULL REFERENCES users(employee_id),
      started_at TIMESTAMPTZ,
      submitted_at TIMESTAMPTZ,
      approved_by VARCHAR(50) REFERENCES users(employee_id),
      approved_at TIMESTAMPTZ,
      remarks TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT workflow_stage_revisions_status_check CHECK (
        status IN ('not_started', 'in_progress', 'submitted_for_approval', 'approved')
      )
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS workflow_stage_submissions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workflow_stage_id UUID NOT NULL REFERENCES project_workflow_stages(id) ON DELETE CASCADE,
      workflow_id UUID NOT NULL REFERENCES project_workflows(id) ON DELETE CASCADE,
      revision_id UUID REFERENCES workflow_stage_revisions(id) ON DELETE SET NULL,
      submitted_by VARCHAR(50) NOT NULL REFERENCES users(employee_id),
      submitted_document_path TEXT NOT NULL,
      remarks TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      reviewed_by VARCHAR(50) REFERENCES users(employee_id),
      reviewed_at TIMESTAMPTZ,
      review_remarks TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT workflow_stage_submissions_status_check CHECK (status IN ('pending', 'approved', 'revision_required'))
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS workflow_document_path_history (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workflow_stage_id UUID NOT NULL REFERENCES project_workflow_stages(id) ON DELETE CASCADE,
      old_path TEXT,
      new_path TEXT NOT NULL,
      changed_by VARCHAR(50) NOT NULL REFERENCES users(employee_id),
      change_remarks TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS workflow_unlock_overrides (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workflow_stage_id UUID NOT NULL REFERENCES project_workflow_stages(id) ON DELETE CASCADE,
      workflow_id UUID NOT NULL REFERENCES project_workflows(id) ON DELETE CASCADE,
      unlocked_by VARCHAR(50) NOT NULL REFERENCES users(employee_id),
      reason TEXT NOT NULL,
      remarks TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_project_workflow_stages_workflow_status
    ON project_workflow_stages (workflow_id, status, sequence_order)
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_workflow_stage_submissions_pending
    ON workflow_stage_submissions (status, created_at)
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_workflow_stage_revisions_status_due
    ON workflow_stage_revisions (status, due_date)
  `);

  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_project_workflows_active_unique
    ON project_workflows (project_id, sub_department_id, template_id)
    WHERE status = 'active'
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_project_workflows_assigned_active
    ON project_workflows (sub_department_id, assigned_user_id, status)
    WHERE status = 'active'
  `);

  await seedControlDesignWorkflowTemplate(client);
}

async function seedControlDesignWorkflowTemplate(client) {
  const templateResult = await client.query(`
    WITH control_design AS (
      SELECT id
      FROM department_subdivisions
      WHERE department_id = $1
        AND LOWER(BTRIM(subdivision_name)) = LOWER($2)
      LIMIT 1
    )
    INSERT INTO workflow_templates (
      department_id,
      sub_department_id,
      workflow_family,
      template_name,
      description,
      default_priority,
      default_proof_required,
      default_approval_required,
      default_due_days,
      escalation_level,
      eligible_role_ids,
      is_active,
      created_by,
      created_at,
      updated_at
    )
    SELECT
      $1,
      control_design.id,
      'control_project',
      $2,
      'Control Design project workflow with one accountable owner and approval gated milestones.',
      'medium',
      TRUE,
      TRUE,
      NULL,
      1,
      '[]'::jsonb,
      TRUE,
      'system',
      NOW(),
      NOW()
    FROM control_design
    ON CONFLICT (department_id, template_name) DO UPDATE
    SET sub_department_id = EXCLUDED.sub_department_id,
        workflow_family = EXCLUDED.workflow_family,
        description = EXCLUDED.description,
        default_priority = EXCLUDED.default_priority,
        default_proof_required = EXCLUDED.default_proof_required,
        default_approval_required = EXCLUDED.default_approval_required,
        default_due_days = EXCLUDED.default_due_days,
        escalation_level = EXCLUDED.escalation_level,
        is_active = TRUE,
        updated_at = NOW()
    RETURNING id
  `, [CONTROL_DEPARTMENT_ID, CONTROL_DESIGN_TEMPLATE_NAME]);

  const templateId = templateResult.rows[0]?.id;
  if (!templateId) {
    return;
  }

  for (const [index, stageName] of CONTROL_DESIGN_STAGES.entries()) {
    await client.query(`
      INSERT INTO workflow_template_stages (
        template_id,
        stage_name,
        sequence_order,
        is_required,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, TRUE, NOW(), NOW())
      ON CONFLICT (template_id, stage_name) DO UPDATE
      SET sequence_order = EXCLUDED.sequence_order,
          is_required = TRUE,
          updated_at = NOW()
    `, [templateId, stageName, index + 1]);
  }
}

module.exports = {
  ensureControlWorkflowSchema,
  seedControlDesignWorkflowTemplate,
};
