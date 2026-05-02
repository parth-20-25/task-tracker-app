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
      created_at,
      updated_at
    )
    SELECT
      sp.project_no,
      sp.project_name,
      sp.customer_name,
      sp.department_id,
      sp.uploaded_by,
      sp.created_at,
      sp.updated_at
    FROM source_projects sp
    ON CONFLICT (project_no, department_id) DO NOTHING
  `);

  await client.query(`
    WITH design_departments AS (
      SELECT d.id
      FROM departments d
      WHERE LOWER(BTRIM(COALESCE(d.name, ''))) = 'design'
         OR LOWER(BTRIM(COALESCE(d.id, ''))) = 'design'
    ),
    source_scopes AS (
      SELECT DISTINCT
        dp.id AS project_id,
        COALESCE(NULLIF(BTRIM(p.scope_name), ''), 'General') AS scope_name
      FROM public.projects p
      JOIN design_departments dd
        ON dd.id = p.department_id
      JOIN design.projects dp
        ON dp.project_no = BTRIM(p.project_no)
       AND dp.department_id = p.department_id
      WHERE NULLIF(BTRIM(p.project_no), '') IS NOT NULL
    )
    INSERT INTO design.scopes (
      project_id,
      scope_name
    )
    SELECT
      ss.project_id,
      ss.scope_name
    FROM source_scopes ss
    ON CONFLICT (project_id, scope_name) DO NOTHING
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
    UPDATE design.upload_batches ub
    SET project_id = s.project_id
    FROM design.scopes s
    WHERE ub.scope_id = s.id
      AND ub.project_id IS DISTINCT FROM s.project_id
  `);

  await client.query(`
    UPDATE design.fixtures f
    SET project_id = s.project_id
    FROM design.scopes s
    WHERE f.scope_id = s.id
      AND f.project_id IS DISTINCT FROM s.project_id
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
        FROM design.scopes s
        WHERE s.project_id IS NULL
      ) THEN
        RAISE EXCEPTION 'design.scopes contains rows with null project_id';
      END IF;

      IF EXISTS (
        SELECT 1
        FROM design.fixtures f
        WHERE f.project_id IS NULL
           OR f.scope_id IS NULL
      ) THEN
        RAISE EXCEPTION 'design.fixtures contains rows with null project_id or scope_id';
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

async function ensureScopeProjectConstraint(client) {
  await client.query(`
    DO $$
    DECLARE
      project_attnum smallint;
    BEGIN
      SELECT attnum
      INTO project_attnum
      FROM pg_attribute
      WHERE attrelid = 'design.scopes'::regclass
        AND attname = 'project_id'
        AND NOT attisdropped;

      IF project_attnum IS NULL THEN
        RAISE EXCEPTION 'design.scopes.project_id is missing';
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'design.scopes'::regclass
          AND contype = 'f'
          AND conkey = ARRAY[project_attnum]
      ) THEN
        ALTER TABLE design.scopes
        ADD CONSTRAINT fk_scope_project
        FOREIGN KEY (project_id) REFERENCES design.projects(id);
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

async function ensureFixtureScopeProjectConstraint(client) {
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'design_fixtures_scope_project_fkey'
      ) THEN
        ALTER TABLE design.fixtures
        ADD CONSTRAINT design_fixtures_scope_project_fkey
        FOREIGN KEY (scope_id, project_id)
        REFERENCES design.scopes(id, project_id)
        ON DELETE CASCADE;
      END IF;
    END $$;
  `);
}

async function ensureUploadBatchScopeProjectConstraint(client) {
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'design_upload_batches_scope_project_fkey'
      ) THEN
        ALTER TABLE design.upload_batches
        ADD CONSTRAINT design_upload_batches_scope_project_fkey
        FOREIGN KEY (scope_id, project_id)
        REFERENCES design.scopes(id, project_id)
        ON DELETE CASCADE;
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
    CREATE UNIQUE INDEX IF NOT EXISTS idx_design_fixtures_scope_fixture_no_unique
    ON design.fixtures (scope_id, fixture_no)
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
      uploaded_by VARCHAR(50),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT design_projects_project_no_department_key UNIQUE (project_no, department_id)
    )
  `);

  await client.query(`
    ALTER TABLE design.projects
    ADD COLUMN IF NOT EXISTS uploaded_by VARCHAR(50),
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS design.scopes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID NOT NULL,
      scope_name TEXT NOT NULL,
      CONSTRAINT design_scopes_project_scope_name_key UNIQUE (project_id, scope_name)
    )
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
      scope_id UUID NOT NULL REFERENCES design.scopes(id) ON DELETE CASCADE,
      fixture_no TEXT NOT NULL,
      op_no TEXT NOT NULL,
      part_name TEXT NOT NULL,
      fixture_type TEXT NOT NULL,
      remark TEXT,
      qty INTEGER NOT NULL,
      image_1_url TEXT,
      image_2_url TEXT,
      ingestion_source TEXT,
      is_workflow_complete BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT design_fixtures_scope_fixture_no_key UNIQUE (scope_id, fixture_no)
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
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  `);

  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'design_fixtures_ingestion_source_check'
      ) THEN
        ALTER TABLE design.fixtures
        ADD CONSTRAINT design_fixtures_ingestion_source_check
        CHECK (
          ingestion_source IS NULL
          OR ingestion_source IN ('excel_upload', 'manual_paste')
        );
      END IF;
    END $$;
  `);

  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'design_fixtures_scope_fixture_no_key'
      ) THEN
        ALTER TABLE design.fixtures
        ADD CONSTRAINT design_fixtures_scope_fixture_no_key
        UNIQUE (scope_id, fixture_no);
      END IF;
    END $$;
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS design.upload_batches (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID NOT NULL,
      scope_id UUID NOT NULL REFERENCES design.scopes(id) ON DELETE CASCADE,
      uploaded_by VARCHAR(50),
      uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      total_rows INTEGER NOT NULL DEFAULT 0,
      accepted_rows INTEGER NOT NULL DEFAULT 0,
      rejected_rows INTEGER NOT NULL DEFAULT 0
    )
  `);

  await client.query(`
    ALTER TABLE design.fixtures
    ADD COLUMN IF NOT EXISTS batch_id UUID
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
    CREATE INDEX IF NOT EXISTS idx_design_scopes_project_id
    ON design.scopes (project_id)
  `);

  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_design_scopes_id_project_id
    ON design.scopes (id, project_id)
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_design_fixtures_scope_id
    ON design.fixtures (scope_id)
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
    CREATE UNIQUE INDEX IF NOT EXISTS idx_design_upload_batches_id_project_id
    ON design.upload_batches (id, project_id)
  `);

  await backfillDesignIntegrity(client);

  await ensureDepartmentConstraint(client);
  await ensureScopeProjectConstraint(client);
  await ensureFixtureProjectConstraint(client);
  await ensureUploadBatchScopeProjectConstraint(client);
  await ensureFixtureScopeProjectConstraint(client);
  await ensureFixtureBatchConstraint(client);
  await ensureFixtureIdentityIndex(client);

  await ensureColumnNotNull(client, "design.projects", "department_id");
  await ensureColumnNotNull(client, "design.scopes", "project_id");
  await ensureColumnNotNull(client, "design.fixtures", "project_id");

  await ensureDesignIntegrityDiagnostics(client);
}

module.exports = {
  backfillDesignIntegrity,
  backfillDesignProjectRelations,
  ensureDesignDepartmentSchema,
};
