async function backfillDesignProjectRelations(client) {
  await client.query(`
    WITH design_departments AS (
      SELECT d.id
      FROM departments d
      WHERE LOWER(BTRIM(COALESCE(d.name, ''))) = 'design'
         OR LOWER(BTRIM(COALESCE(d.id, ''))) = 'design'
    ),
    source_projects AS (
      SELECT DISTINCT ON (BTRIM(p.project_no), p.department_id)
        BTRIM(p.project_no) AS project_no,
        COALESCE(
          NULLIF(BTRIM(p.project_name), ''),
          NULLIF(BTRIM(p.project_description), ''),
          BTRIM(p.project_no)
        ) AS project_name,
        COALESCE(NULLIF(BTRIM(p.customer_name), ''), '') AS customer_name,
        p.uploaded_by,
        COALESCE(p.created_at, NOW()) AS created_at,
        COALESCE(p.updated_at, p.created_at, NOW()) AS updated_at,
        p.department_id
      FROM public.projects p
      JOIN design_departments dd
        ON dd.id = p.department_id
      WHERE NULLIF(BTRIM(p.project_no), '') IS NOT NULL
      ORDER BY
        BTRIM(p.project_no),
        p.department_id,
        p.updated_at DESC NULLS LAST,
        p.created_at DESC NULLS LAST,
        p.id DESC
    )
    INSERT INTO design.projects (
      project_no,
      project_name,
      customer_name,
      department_id,
      uploaded_by,
      created_by_user_id,
      created_at,
      updated_at
    )
    SELECT
      sp.project_no,
      sp.project_name,
      sp.customer_name,
      sp.department_id,
      sp.uploaded_by,
      sp.uploaded_by AS created_by_user_id,
      sp.created_at,
      sp.updated_at
    FROM source_projects sp
    ON CONFLICT (project_no, department_id) DO NOTHING
  `);

}

async function backfillDesignIntegrity(client) {
  await backfillDesignProjectRelations(client);

  await client.query(`
    UPDATE design.projects p
    SET department_id = u.department_id,
        updated_at = NOW()
    FROM users u
    WHERE p.uploaded_by = u.employee_id
      AND u.department_id IS NOT NULL
      AND (
        p.department_id IS NULL
        OR NULLIF(BTRIM(p.department_id), '') IS NULL
        OR NOT EXISTS (
          SELECT 1
          FROM departments d
          WHERE d.id = p.department_id
        )
      )
  `);

  await client.query(`
    UPDATE design.projects
    SET department_id = BTRIM(department_id),
        updated_at = NOW()
    WHERE department_id IS NOT NULL
      AND department_id <> BTRIM(department_id)
  `);

  await client.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM design.projects p
        LEFT JOIN departments d
          ON d.id = p.department_id
        WHERE NULLIF(BTRIM(COALESCE(p.department_id, '')), '') IS NULL
           OR d.id IS NULL
      ) THEN
        RAISE EXCEPTION 'design.projects contains rows with null or invalid department_id';
      END IF;

      IF EXISTS (
        SELECT 1
        FROM design.fixtures f
        WHERE f.project_id IS NULL
      ) THEN
        RAISE EXCEPTION 'design.fixtures contains rows with null project_id';
      END IF;
    END $$;
  `);
}

async function ensureColumnNotNull(client, tableName, columnName) {
  await client.query(`
    ALTER TABLE ${tableName}
    ALTER COLUMN ${columnName} SET NOT NULL
  `);
}

async function ensureDepartmentConstraint(client) {
  await client.query(`
    DO $$
    DECLARE
      department_attnum smallint;
    BEGIN
      SELECT attnum
      INTO department_attnum
      FROM pg_attribute
      WHERE attrelid = 'design.projects'::regclass
        AND attname = 'department_id'
        AND NOT attisdropped;

      IF department_attnum IS NULL THEN
        RAISE EXCEPTION 'design.projects.department_id is missing';
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'design.projects'::regclass
          AND contype = 'f'
          AND conkey = ARRAY[department_attnum]
      ) THEN
        ALTER TABLE design.projects
        ADD CONSTRAINT fk_project_department
        FOREIGN KEY (department_id) REFERENCES departments(id);
      END IF;
    END $$;
  `);
}

async function ensureFixtureProjectConstraint(client) {
  await client.query(`
    DO $$
    DECLARE
      project_attnum smallint;
    BEGIN
      SELECT attnum
      INTO project_attnum
      FROM pg_attribute
      WHERE attrelid = 'design.fixtures'::regclass
        AND attname = 'project_id'
        AND NOT attisdropped;

      IF project_attnum IS NULL THEN
        RAISE EXCEPTION 'design.fixtures.project_id is missing';
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'design.fixtures'::regclass
          AND contype = 'f'
          AND conkey = ARRAY[project_attnum]
      ) THEN
        ALTER TABLE design.fixtures
        ADD CONSTRAINT fk_fixture_project
        FOREIGN KEY (project_id) REFERENCES design.projects(id);
      END IF;
    END $$;
  `);
}

async function ensureFixtureBatchConstraint(client) {
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'design_fixtures_batch_id_fkey'
      ) THEN
        ALTER TABLE design.fixtures
        ADD CONSTRAINT design_fixtures_batch_id_fkey
        FOREIGN KEY (batch_id) REFERENCES design.upload_batches(id) ON DELETE SET NULL;
      END IF;
    END $$;
  `);
}

async function ensureFixtureIdentityIndex(client) {
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_design_fixtures_project_fixture_no_unique
    ON design.fixtures (project_id, fixture_no)
  `);
}

async function dropScopeArchitecture(client) {
  await client.query(`
    DROP INDEX IF EXISTS idx_design_fixtures_scope_fixture_no_unique;
    DROP INDEX IF EXISTS idx_design_fixtures_scope_id;
    DROP INDEX IF EXISTS idx_design_scopes_id_project_id;
    DROP INDEX IF EXISTS idx_design_scopes_project_id;
  `);

  await client.query(`
    ALTER TABLE IF EXISTS design.fixtures
    DROP CONSTRAINT IF EXISTS design_fixtures_scope_project_fkey,
    DROP CONSTRAINT IF EXISTS design_fixtures_scope_fixture_no_key,
    DROP CONSTRAINT IF EXISTS design_fixtures_scope_id_fkey
  `);

  await client.query(`
    ALTER TABLE IF EXISTS design.upload_batches
    DROP CONSTRAINT IF EXISTS design_upload_batches_scope_project_fkey,
    DROP CONSTRAINT IF EXISTS design_upload_batches_scope_id_fkey
  `);

  await client.query(`
    ALTER TABLE IF EXISTS design.fixtures
    DROP COLUMN IF EXISTS scope_id
  `);

  await client.query(`
    ALTER TABLE IF EXISTS design.upload_batches
    DROP COLUMN IF EXISTS scope_id
  `);

  await client.query(`
    DROP TABLE IF EXISTS design.scopes CASCADE
  `);
}

async function ensureDesignIntegrityDiagnostics(client) {
  await client.query(`
    CREATE OR REPLACE VIEW design.projects_without_fixtures AS
    SELECT p.id AS project_id
    FROM design.projects p
    LEFT JOIN design.fixtures f
      ON f.project_id = p.id
    WHERE f.id IS NULL
  `);
}

async function ensureDesignSubdivisionRoutingSchema(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS department_subdivisions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      department_id TEXT NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
      subdivision_name TEXT NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT department_subdivisions_unique_name UNIQUE (department_id, subdivision_name)
    )
  `);

  await client.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS subdivision_id UUID NULL
  `);

  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'users_subdivision_id_fkey'
      ) THEN
        ALTER TABLE users
        ADD CONSTRAINT users_subdivision_id_fkey
        FOREIGN KEY (subdivision_id) REFERENCES department_subdivisions(id) ON DELETE SET NULL;
      END IF;
    END $$;
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS design.project_subdivision_assignments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID NOT NULL REFERENCES design.projects(id) ON DELETE CASCADE,
      subdivision_id UUID NOT NULL REFERENCES department_subdivisions(id),
      assigned_leader_id VARCHAR(50) NOT NULL REFERENCES users(employee_id),
      assigned_by VARCHAR(50) REFERENCES users(employee_id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      is_active BOOLEAN NOT NULL DEFAULT TRUE
    )
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_department_subdivisions_department
    ON department_subdivisions (department_id, is_active)
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_users_subdivision
    ON users (subdivision_id)
    WHERE subdivision_id IS NOT NULL
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_design_project_subdivision_assignments_active
    ON design.project_subdivision_assignments (project_id, subdivision_id, assigned_leader_id)
    WHERE is_active = TRUE
  `);

  await client.query(`
    WITH design_department AS (
      SELECT id
      FROM departments
      WHERE LOWER(BTRIM(id)) = 'design'
         OR LOWER(BTRIM(name)) = 'design'
      ORDER BY CASE WHEN LOWER(BTRIM(id)) = 'design' THEN 0 ELSE 1 END
      LIMIT 1
    )
    INSERT INTO department_subdivisions (department_id, subdivision_name, is_active)
    SELECT design_department.id, seed.subdivision_name, TRUE
    FROM design_department
    CROSS JOIN (VALUES ('3D'), ('2D')) AS seed(subdivision_name)
    ON CONFLICT (department_id, subdivision_name) DO NOTHING
  `);
}

async function ensureDesignDepartmentSchema(client) {
  await client.query(`
    CREATE SCHEMA IF NOT EXISTS design
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS design.projects (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_no TEXT NOT NULL,
      project_name TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      department_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      status_changed_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      plant TEXT,
      project_leader_id VARCHAR(50),
      team_lead_id VARCHAR(50),
      uploaded_by VARCHAR(50),
      created_by_user_id VARCHAR(50),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT design_projects_status_check CHECK (status IN ('active', 'on_hold', 'completed')),
      CONSTRAINT design_projects_project_no_department_key UNIQUE (project_no, department_id)
    )
  `);

  await client.query(`
    ALTER TABLE design.projects
    ADD COLUMN IF NOT EXISTS uploaded_by VARCHAR(50),
    ADD COLUMN IF NOT EXISTS created_by_user_id VARCHAR(50),
    ADD COLUMN IF NOT EXISTS plant TEXT,
    ADD COLUMN IF NOT EXISTS project_leader_id VARCHAR(50),
    ADD COLUMN IF NOT EXISTS team_lead_id VARCHAR(50),
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',
    ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  `);

  await client.query(`
    UPDATE design.projects
    SET status = 'active'
    WHERE status IS NULL
       OR status NOT IN ('active', 'on_hold', 'completed')
  `);

  await client.query(`
    UPDATE design.projects
    SET created_by_user_id = uploaded_by
    WHERE created_by_user_id IS NULL
      AND uploaded_by IS NOT NULL
  `);

  // Prevent accidental or malicious updates to created_by_user_id after initial set.
  // Backfill must run before this trigger is installed (one-time migration backfill).
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_proc WHERE proname = 'prevent_created_by_update'
      ) THEN
        CREATE OR REPLACE FUNCTION prevent_created_by_update()
        RETURNS trigger AS $prevent_created_by_update$
        BEGIN
          IF TG_OP = 'UPDATE' THEN
            IF OLD.created_by_user_id IS NOT NULL
               AND (OLD.created_by_user_id IS DISTINCT FROM NEW.created_by_user_id) THEN
              RAISE EXCEPTION 'created_by_user_id is immutable and cannot be changed after creation';
            END IF;
          END IF;
          RETURN NEW;
        END;
        $prevent_created_by_update$ LANGUAGE plpgsql;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'trg_prevent_created_by_update'
      ) THEN
        CREATE TRIGGER trg_prevent_created_by_update
        BEFORE UPDATE ON design.projects
        FOR EACH ROW
        EXECUTE FUNCTION prevent_created_by_update();
      END IF;
    END $$;
  `);

  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'design_projects_status_check'
      ) THEN
        ALTER TABLE design.projects
        ADD CONSTRAINT design_projects_status_check
        CHECK (status IN ('active', 'on_hold', 'completed'));
      END IF;
    END $$;
  `);

  await client.query(`
    DROP TABLE IF EXISTS design.reworks CASCADE
  `);

  await client.query(`
    DROP TABLE IF EXISTS design.instances CASCADE
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS design.fixtures (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID NOT NULL,
      fixture_no TEXT NOT NULL,
      op_no TEXT,
      part_name TEXT NOT NULL,
      fixture_type TEXT NOT NULL,
      remark TEXT,
      qty INTEGER NOT NULL,
      image_1_url TEXT,
      image_2_url TEXT,
      ingestion_source TEXT,
      is_workflow_complete BOOLEAN NOT NULL DEFAULT FALSE,
      revision_no INTEGER NOT NULL DEFAULT 0,
      is_legacy_workflow BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT design_fixtures_project_fixture_no_key UNIQUE (project_id, fixture_no)
    )
  `);

  await client.query(`
    ALTER TABLE design.fixtures
    ADD COLUMN IF NOT EXISTS project_id UUID,
    ADD COLUMN IF NOT EXISTS remark TEXT,
    ADD COLUMN IF NOT EXISTS image_1_url TEXT,
    ADD COLUMN IF NOT EXISTS image_2_url TEXT,
    ADD COLUMN IF NOT EXISTS ingestion_source TEXT,
    ADD COLUMN IF NOT EXISTS is_workflow_complete BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS revision_no INTEGER,
    ADD COLUMN IF NOT EXISTS is_legacy_workflow BOOLEAN,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  `);

  await client.query(`
    ALTER TABLE design.fixtures
    ALTER COLUMN op_no DROP NOT NULL
  `);

  await client.query(`
    UPDATE design.fixtures
    SET revision_no = 0
    WHERE revision_no IS NULL
  `);

  await client.query(`
    UPDATE design.fixtures
    SET is_legacy_workflow = TRUE
    WHERE is_legacy_workflow IS NULL
  `);

  await client.query(`
    ALTER TABLE design.fixtures
    ALTER COLUMN revision_no SET DEFAULT 0,
    ALTER COLUMN revision_no SET NOT NULL,
    ALTER COLUMN is_legacy_workflow SET DEFAULT FALSE,
    ALTER COLUMN is_legacy_workflow SET NOT NULL
  `);

  await client.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'design_fixtures_ingestion_source_check'
      ) THEN
        ALTER TABLE design.fixtures
        DROP CONSTRAINT design_fixtures_ingestion_source_check;
      END IF;

      ALTER TABLE design.fixtures
      ADD CONSTRAINT design_fixtures_ingestion_source_check
      CHECK (
        ingestion_source IS NULL
        OR ingestion_source IN ('excel_upload', 'manual_paste', 'native_workspace')
      );
    END $$;
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS design.upload_batches (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID NOT NULL,
      uploaded_by VARCHAR(50),
      uploaded_by_user_id VARCHAR(50),
      uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      total_rows INTEGER NOT NULL DEFAULT 0,
      accepted_rows INTEGER NOT NULL DEFAULT 0,
      rejected_rows INTEGER NOT NULL DEFAULT 0
    )
  `);

  // Ensure a lifecycle/status column for operational batch continuity
  await client.query(`
    ALTER TABLE design.upload_batches
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
  `);

  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'design_upload_batches_status_check'
      ) THEN
        ALTER TABLE design.upload_batches
        ADD CONSTRAINT design_upload_batches_status_check
        CHECK (status IN ('active', 'archived', 'closed'));
      END IF;
    END $$;
  `);

  // Collapse any accidental multiple active batches per project: keep the most recent active and archive the rest
  await client.query(`
    WITH active_batches AS (
      SELECT id, project_id,
             ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY uploaded_at DESC, id DESC) AS rn
      FROM design.upload_batches
      WHERE COALESCE(status, 'active') = 'active'
    )
    UPDATE design.upload_batches ub
    SET status = 'archived'
    FROM active_batches ab
    WHERE ub.id = ab.id
      AND ab.rn > 1
  `);

  // Guarantee at most one active upload_batch per project (partial unique index)
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_design_upload_batches_unique_active_project
    ON design.upload_batches (project_id)
    WHERE status = 'active'
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_design_upload_batches_status
    ON design.upload_batches (status)
  `);

  await client.query(`
    ALTER TABLE design.upload_batches
    ADD COLUMN IF NOT EXISTS uploaded_by_user_id VARCHAR(50)
  `);

  await client.query(`
    UPDATE design.upload_batches
    SET uploaded_by_user_id = uploaded_by
    WHERE uploaded_by_user_id IS NULL
      AND uploaded_by IS NOT NULL
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS fixture_workflow_revisions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      fixture_id UUID NOT NULL REFERENCES design.fixtures(id) ON DELETE CASCADE,
      department_id TEXT NOT NULL REFERENCES departments(id),
      revision_no INTEGER NOT NULL,
      stage_name TEXT,
      stage_version INTEGER NOT NULL DEFAULT 0,
      revision_code TEXT,
      reason_type TEXT,
      revision_type TEXT NOT NULL,
      revision_reason TEXT,
      revision_remarks TEXT,
      reverted_from_stage TEXT NOT NULL,
      reverted_to_stage TEXT NOT NULL,
      requested_by VARCHAR(50) NOT NULL,
      approved_by VARCHAR(50),
      changed_by VARCHAR(50) NOT NULL,
      changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      CONSTRAINT fixture_workflow_revisions_type_check CHECK (
        revision_type IN (
          'CUSTOMER_CHANGE',
          'CUSTOMER_TRIAL_CHANGE',
          'CUSTOMER_REVISION',
          'INTERNAL_DESIGN_CHANGE',
          'MANUFACTURING_ISSUE',
          'QUALITY_CORRECTION',
          'COST_OPTIMIZATION',
          'APPROVAL_REJECTION',
          'PROCUREMENT_CONSTRAINT',
          'MANUAL_OVERRIDE',
          'OTHER'
        )
      ),
      CONSTRAINT fixture_workflow_revisions_fixture_revision_key UNIQUE (fixture_id, revision_no)
    )
  `);

  await client.query(`
    ALTER TABLE fixture_workflow_revisions
    ADD COLUMN IF NOT EXISTS stage_name TEXT,
    ADD COLUMN IF NOT EXISTS stage_version INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS revision_code TEXT,
    ADD COLUMN IF NOT EXISTS reason_type TEXT
  `);

  await client.query(`
    ALTER TABLE fixture_workflow_revisions
    DROP CONSTRAINT IF EXISTS fixture_workflow_revisions_type_check
  `);

  await client.query(`
    ALTER TABLE fixture_workflow_revisions
    ADD CONSTRAINT fixture_workflow_revisions_type_check CHECK (
      revision_type IN (
        'CUSTOMER_CHANGE',
        'CUSTOMER_TRIAL_CHANGE',
        'CUSTOMER_REVISION',
        'INTERNAL_DESIGN_CHANGE',
        'MANUFACTURING_ISSUE',
        'QUALITY_CORRECTION',
        'COST_OPTIMIZATION',
        'APPROVAL_REJECTION',
        'PROCUREMENT_CONSTRAINT',
        'MANUAL_OVERRIDE',
        'OTHER'
      )
    )
  `);

  await client.query(`
    ALTER TABLE fixture_workflow_revisions
    ALTER COLUMN revision_reason DROP NOT NULL
  `);

  await client.query(`
    UPDATE fixture_workflow_revisions
    SET reason_type = COALESCE(reason_type, revision_type),
        revision_code = COALESCE(revision_code, CONCAT('R ', LPAD(COALESCE(revision_no, 0)::text, 2, '0'))),
        stage_version = COALESCE(stage_version, 0)
    WHERE reason_type IS NULL
       OR revision_code IS NULL
       OR stage_version IS NULL
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_fixture_workflow_revisions_fixture_stage_version
    ON fixture_workflow_revisions(fixture_id, stage_name, stage_version DESC, changed_at DESC)
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS design.fixture_stage_contributions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      fixture_id UUID NOT NULL REFERENCES design.fixtures(id) ON DELETE CASCADE,
      department_id TEXT NOT NULL REFERENCES departments(id),
      stage_name TEXT NOT NULL,
      revision_code TEXT NOT NULL,
      stage_revision_no INTEGER NOT NULL DEFAULT 0,
      employee_id VARCHAR(50) NOT NULL REFERENCES users(employee_id),
      contribution_percent NUMERIC(5, 2) NOT NULL,
      contribution_kind TEXT NOT NULL DEFAULT 'ACTUAL',
      transfer_reason TEXT,
      transferred_by VARCHAR(50) REFERENCES users(employee_id),
      transferred_at TIMESTAMPTZ,
      changed_by VARCHAR(50) NOT NULL REFERENCES users(employee_id),
      changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      previous_stage TEXT,
      stage_instance_id UUID,
      stage_attempt_no INTEGER,
      workflow_revision_id UUID REFERENCES fixture_workflow_revisions(id) ON DELETE SET NULL,
      superseded_by UUID,
      superseded_at TIMESTAMPTZ,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      CONSTRAINT fixture_stage_contributions_percent_check CHECK (
        contribution_percent >= 0 AND contribution_percent <= 100
      ),
      CONSTRAINT fixture_stage_contributions_kind_check CHECK (
        contribution_kind IN ('ACTUAL', 'REMAINING')
      )
    )
  `);

  await client.query(`
    ALTER TABLE design.fixture_stage_contributions
    ADD COLUMN IF NOT EXISTS revision_code TEXT,
    ADD COLUMN IF NOT EXISTS stage_revision_no INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS contribution_kind TEXT NOT NULL DEFAULT 'ACTUAL',
    ADD COLUMN IF NOT EXISTS transfer_reason TEXT,
    ADD COLUMN IF NOT EXISTS transferred_by VARCHAR(50),
    ADD COLUMN IF NOT EXISTS transferred_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS changed_by VARCHAR(50),
    ADD COLUMN IF NOT EXISTS changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS previous_stage TEXT,
    ADD COLUMN IF NOT EXISTS stage_instance_id UUID,
    ADD COLUMN IF NOT EXISTS stage_attempt_no INTEGER,
    ADD COLUMN IF NOT EXISTS workflow_revision_id UUID,
    ADD COLUMN IF NOT EXISTS superseded_by UUID,
    ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb
  `);

  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fixture_stage_contributions_stage_instance_fkey'
      ) THEN
        ALTER TABLE design.fixture_stage_contributions
        ADD CONSTRAINT fixture_stage_contributions_stage_instance_fkey
        FOREIGN KEY (stage_instance_id) REFERENCES fixture_workflow_stage_attempts(id) ON DELETE SET NULL;
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fixture_stage_contributions_superseded_by_fkey'
      ) THEN
        ALTER TABLE design.fixture_stage_contributions
        ADD CONSTRAINT fixture_stage_contributions_superseded_by_fkey
        FOREIGN KEY (superseded_by) REFERENCES design.fixture_stage_contributions(id) ON DELETE SET NULL;
      END IF;
    END $$;
  `);

  await client.query(`
    ALTER TABLE design.fixtures
    ADD COLUMN IF NOT EXISTS batch_id UUID
  `);

  await client.query(`
    ALTER TABLE design.fixtures
    ADD COLUMN IF NOT EXISTS removed_from_latest_ingestion BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS ingestion_archived_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS is_outsourced BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS vendor_name TEXT,
    ADD COLUMN IF NOT EXISTS outsourced_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS outsourced_by VARCHAR(50)
  `);

  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'design_fixtures_outsource_vendor_check'
      ) THEN
        ALTER TABLE design.fixtures
        ADD CONSTRAINT design_fixtures_outsource_vendor_check
        CHECK (
          is_outsourced = FALSE
          OR (vendor_name IS NOT NULL AND BTRIM(vendor_name) <> '')
        );
      END IF;
    END $$;
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_design_fixtures_removed_from_ingestion
    ON design.fixtures (project_id, removed_from_latest_ingestion)
    WHERE removed_from_latest_ingestion = TRUE
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS design.upload_errors (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      batch_id UUID NOT NULL REFERENCES design.upload_batches(id) ON DELETE CASCADE,
      row_number INTEGER NOT NULL,
      error_message TEXT NOT NULL
    )
  `);

  await client.query(`
    ALTER TABLE design.upload_errors
    ADD COLUMN IF NOT EXISTS excel_row INTEGER,
    ADD COLUMN IF NOT EXISTS row_reference TEXT,
    ADD COLUMN IF NOT EXISTS raw_data JSONB
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS design.upload_row_corrections (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      batch_id UUID NOT NULL REFERENCES design.upload_batches(id) ON DELETE CASCADE,
      row_reference TEXT NOT NULL,
      row_number INTEGER,
      excel_row INTEGER,
      correction_reason TEXT,
      correction_result TEXT NOT NULL DEFAULT 'accepted',
      original_data JSONB NOT NULL DEFAULT '{}'::jsonb,
      corrected_data JSONB NOT NULL DEFAULT '{}'::jsonb,
      corrected_by VARCHAR(50) NOT NULL,
      corrected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_design_upload_row_corrections_batch_id
    ON design.upload_row_corrections (batch_id, corrected_at DESC)
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_design_projects_project_no
    ON design.projects (project_no)
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_design_fixtures_project_id
    ON design.fixtures (project_id)
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_design_fixtures_batch_id
    ON design.fixtures (batch_id)
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_design_fixtures_legacy_workflow
    ON design.fixtures (is_legacy_workflow)
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_design_upload_batches_uploaded_by_user
    ON design.upload_batches (uploaded_by_user_id)
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_design_upload_batches_project_uploader
    ON design.upload_batches (project_id, uploaded_by_user_id, uploaded_by)
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_design_projects_department_uploader
    ON design.projects (department_id, uploaded_by)
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_design_projects_department_status
    ON design.projects (department_id, status, updated_at DESC)
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_fixture_workflow_revisions_fixture_changed
    ON fixture_workflow_revisions (fixture_id, changed_at DESC)
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_fixture_stage_contrib_fixture_stage_revision
    ON design.fixture_stage_contributions (fixture_id, stage_name, revision_code)
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_fixture_stage_contrib_employee
    ON design.fixture_stage_contributions (employee_id, changed_at DESC)
    WHERE superseded_by IS NULL
  `);

  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_design_upload_batches_id_project_id
    ON design.upload_batches (id, project_id)
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS design.ingestion_sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      department_id TEXT REFERENCES departments(id),
      created_by_employee_id VARCHAR(50) NOT NULL REFERENCES users(employee_id),
      file_info JSONB NOT NULL DEFAULT '{}'::jsonb,
      snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'draft',
      committed_batch_id UUID REFERENCES design.upload_batches(id) ON DELETE SET NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT design_ingestion_sessions_status_check CHECK (
        status IN ('draft', 'committed', 'abandoned')
      )
    )
  `);

  await client.query(`
    ALTER TABLE design.ingestion_sessions
    ALTER COLUMN department_id DROP NOT NULL
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_design_ingestion_sessions_expires
    ON design.ingestion_sessions (expires_at)
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_design_ingestion_sessions_creator_status
    ON design.ingestion_sessions (created_by_employee_id, department_id, status)
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS design.stage_completion_weights (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      department_id TEXT NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
      stage_key TEXT NOT NULL,
      weight_percent NUMERIC(6,3) NOT NULL CHECK (weight_percent > 0),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT design_stage_completion_weights_unique UNIQUE (department_id, stage_key)
    )
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_design_stage_completion_weights_department
    ON design.stage_completion_weights (department_id)
    WHERE is_active = TRUE
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS design.workflow_completion_snapshots (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      fixture_id UUID REFERENCES design.fixtures(id) ON DELETE CASCADE,
      project_id UUID REFERENCES design.projects(id) ON DELETE CASCADE,
      scope TEXT NOT NULL,
      trigger TEXT NOT NULL DEFAULT 'manual',
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT design_workflow_completion_snapshots_scope_check
        CHECK (scope IN ('fixture', 'project'))
    )
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_design_workflow_completion_snapshots_fixture
    ON design.workflow_completion_snapshots (fixture_id, captured_at DESC)
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_design_workflow_completion_snapshots_project
    ON design.workflow_completion_snapshots (project_id, captured_at DESC)
  `);

  await backfillDesignIntegrity(client);
  await dropScopeArchitecture(client);

  await ensureDepartmentConstraint(client);
  await ensureFixtureProjectConstraint(client);
  await ensureFixtureBatchConstraint(client);
  await ensureFixtureIdentityIndex(client);

  await ensureColumnNotNull(client, "design.projects", "department_id");
  await ensureColumnNotNull(client, "design.fixtures", "project_id");

  await ensureDesignIntegrityDiagnostics(client);
  await ensureDesignSubdivisionRoutingSchema(client);
}

module.exports = {
  backfillDesignIntegrity,
  backfillDesignProjectRelations,
  ensureDesignDepartmentSchema,
  ensureDesignSubdivisionRoutingSchema,
};
