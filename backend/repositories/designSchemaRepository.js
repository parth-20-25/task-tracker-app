const {
  RELEASE_DELIVERABLE_APPLICABILITY,
  RELEASE_DELIVERABLE_CODES,
  RELEASE_DELIVERABLE_DEFINITIONS,
  RELEASE_DELIVERABLE_STATUSES,
  RELEASE_PACKAGE_STATUSES,
} = require("../lib/fixtureReleaseDeliverables");
const {
  ensureFixtureOutsourceAssignmentSchema,
} = require("./fixtureOutsourceAssignmentSchemaRepository");

function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlValueList(values) {
  return values.map(sqlLiteral).join(", ");
}

async function ensureFixtureReleaseDeliverablesSchema(client) {
  const packageStatuses = sqlValueList(Object.values(RELEASE_PACKAGE_STATUSES));
  const deliverableStatuses = sqlValueList(Object.values(RELEASE_DELIVERABLE_STATUSES));
  const applicabilityStatuses = sqlValueList(Object.values(RELEASE_DELIVERABLE_APPLICABILITY));
  const deliverableCodes = sqlValueList(Object.values(RELEASE_DELIVERABLE_CODES));
  const mimicCode = sqlLiteral(RELEASE_DELIVERABLE_CODES.MIMIC_DISPLAY);
  const requiredApplicability = sqlLiteral(RELEASE_DELIVERABLE_APPLICABILITY.REQUIRED);
  const unresolvedApplicability = sqlLiteral(RELEASE_DELIVERABLE_APPLICABILITY.UNRESOLVED);
  const notApplicable = sqlLiteral(RELEASE_DELIVERABLE_APPLICABILITY.NOT_APPLICABLE);
  const lockedStatus = sqlLiteral(RELEASE_DELIVERABLE_STATUSES.LOCKED);
  const applicabilityStateCheck = `
        (
          deliverable_code <> ${mimicCode}
          AND is_required = TRUE
          AND applicability_status = ${requiredApplicability}
          AND status <> ${notApplicable}
        )
        OR (
          deliverable_code = ${mimicCode}
          AND (
            (
              is_required = FALSE
              AND applicability_status = ${unresolvedApplicability}
              AND status = ${lockedStatus}
            )
            OR (
              is_required = TRUE
              AND applicability_status = ${requiredApplicability}
              AND status <> ${notApplicable}
            )
            OR (
              is_required = FALSE
              AND applicability_status = ${notApplicable}
              AND status = ${notApplicable}
            )
          )
        )
  `;
  const definitionRows = RELEASE_DELIVERABLE_DEFINITIONS.map((definition) => {
    const applicability = definition.code === RELEASE_DELIVERABLE_CODES.MIMIC_DISPLAY
      ? RELEASE_DELIVERABLE_APPLICABILITY.UNRESOLVED
      : RELEASE_DELIVERABLE_APPLICABILITY.REQUIRED;
    const status = definition.sequence === 1
      ? RELEASE_DELIVERABLE_STATUSES.READY
      : RELEASE_DELIVERABLE_STATUSES.LOCKED;

    return `(
          ${sqlLiteral(definition.code)},
          ${definition.sequence},
          ${definition.isRequired ? "TRUE" : "FALSE"},
          ${sqlLiteral(applicability)},
          ${sqlLiteral(status)}
        )`;
  }).join(",\n        ");

  await client.query(`
    CREATE TABLE IF NOT EXISTS design.fixture_release_packages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      fixture_id UUID NOT NULL REFERENCES design.fixtures(id) ON DELETE CASCADE,
      version INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT ${sqlLiteral(RELEASE_PACKAGE_STATUSES.IN_PROGRESS)},
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      created_by VARCHAR(50) REFERENCES public.users(employee_id) ON DELETE SET NULL,
      CONSTRAINT design_fixture_release_packages_version_check
        CHECK (version > 0),
      CONSTRAINT design_fixture_release_packages_status_check
        CHECK (status IN (${packageStatuses})),
      CONSTRAINT design_fixture_release_packages_fixture_version_unique
        UNIQUE (fixture_id, version)
    )
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_design_fixture_release_packages_fixture_status
    ON design.fixture_release_packages (fixture_id, status, version DESC)
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS design.fixture_release_deliverables (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      package_id UUID NOT NULL
        REFERENCES design.fixture_release_packages(id) ON DELETE CASCADE,
      deliverable_code TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      is_required BOOLEAN NOT NULL,
      applicability_status TEXT NOT NULL,
      status TEXT NOT NULL,
      assignee_id VARCHAR(50) REFERENCES public.users(employee_id) ON DELETE SET NULL,
      due_at TIMESTAMPTZ,
      started_at TIMESTAMPTZ,
      submitted_at TIMESTAMPTZ,
      approved_at TIMESTAMPTZ,
      approved_by VARCHAR(50) REFERENCES public.users(employee_id) ON DELETE SET NULL,
      latest_comment TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT design_fixture_release_deliverables_code_check
        CHECK (deliverable_code IN (${deliverableCodes})),
      CONSTRAINT design_fixture_release_deliverables_sequence_check
        CHECK (sequence BETWEEN 1 AND ${RELEASE_DELIVERABLE_DEFINITIONS.length}),
      CONSTRAINT design_fixture_release_deliverables_applicability_check
        CHECK (applicability_status IN (${applicabilityStatuses})),
      CONSTRAINT design_fixture_release_deliverables_status_check
        CHECK (status IN (${deliverableStatuses})),
      CONSTRAINT design_fixture_release_deliverables_applicability_state_check
        CHECK (${applicabilityStateCheck}),
      CONSTRAINT design_fixture_release_deliverables_package_code_unique
        UNIQUE (package_id, deliverable_code),
      CONSTRAINT design_fixture_release_deliverables_package_sequence_unique
        UNIQUE (package_id, sequence)
    )
  `);

  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'design.fixture_release_deliverables'::regclass
          AND conname = 'design_fixture_release_deliverables_applicability_state_check'
      ) THEN
        ALTER TABLE design.fixture_release_deliverables
        ADD CONSTRAINT design_fixture_release_deliverables_applicability_state_check
        CHECK (${applicabilityStateCheck});
      END IF;
    END $$;
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_design_fixture_release_deliverables_package_status
    ON design.fixture_release_deliverables (package_id, status, sequence)
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_design_fixture_release_deliverables_assignee
    ON design.fixture_release_deliverables (assignee_id, status, due_at)
    WHERE assignee_id IS NOT NULL
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS design.fixture_release_deliverable_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      deliverable_id UUID NOT NULL
        REFERENCES design.fixture_release_deliverables(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      previous_status TEXT,
      new_status TEXT,
      actor_id VARCHAR(50) REFERENCES public.users(employee_id) ON DELETE SET NULL,
      reason TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT design_fixture_release_deliverable_events_type_check
        CHECK (BTRIM(event_type) <> ''),
      CONSTRAINT design_fixture_release_deliverable_events_previous_status_check
        CHECK (previous_status IS NULL OR previous_status IN (${deliverableStatuses})),
      CONSTRAINT design_fixture_release_deliverable_events_new_status_check
        CHECK (new_status IS NULL OR new_status IN (${deliverableStatuses}))
    )
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_design_fixture_release_deliverable_events_history
    ON design.fixture_release_deliverable_events (deliverable_id, created_at DESC)
  `);

  await client.query(`
    WITH normalized_progress AS (
      SELECT
        progress.fixture_id,
        LOWER(
          BTRIM(
            REGEXP_REPLACE(COALESCE(progress.stage_name, ''), '[^[:alnum:]]+', '_', 'g'),
            '_'
          )
        ) AS stage_key,
        UPPER(COALESCE(progress.status, '')) AS status
      FROM fixture_workflow_progress progress
    ),
    progress_summary AS (
      SELECT
        fixture_id,
        BOOL_OR(
          stage_key IN ('2d', '2d_finish', 'two_d', 'two_d_finish')
          AND status = 'APPROVED'
        ) AS has_approved_2d,
        BOOL_OR(
          stage_key IN ('release', 'released')
          AND status = 'APPROVED'
        ) AS has_approved_release,
        COUNT(*) FILTER (
          WHERE stage_key NOT IN ('release', 'released')
        ) AS non_release_stage_count,
        BOOL_AND(status = 'APPROVED') FILTER (
          WHERE stage_key NOT IN ('release', 'released')
        ) AS all_non_release_stages_approved
      FROM normalized_progress
      GROUP BY fixture_id
    ),
    eligible_fixtures AS (
      SELECT
        fixture.id AS fixture_id,
        CASE
          WHEN latest_package.id IS NULL THEN 1
          WHEN latest_snapshot.captured_at IS NOT NULL
            AND latest_package.created_at < latest_snapshot.captured_at
            THEN latest_package.version + 1
          ELSE latest_package.version
        END AS target_version
      FROM design.fixtures fixture
      JOIN design.projects project
        ON project.id = fixture.project_id
      LEFT JOIN progress_summary progress
        ON progress.fixture_id = fixture.id
      LEFT JOIN LATERAL (
        SELECT snapshot.id, snapshot.captured_at
        FROM design.workflow_completion_snapshots snapshot
        WHERE LOWER(BTRIM(COALESCE(snapshot.trigger, ''))) = 'project_release'
          AND (
            snapshot.fixture_id = fixture.id
            OR snapshot.project_id = fixture.project_id
          )
        ORDER BY snapshot.captured_at DESC, snapshot.id DESC
        LIMIT 1
      ) project_release_snapshot ON TRUE
      LEFT JOIN LATERAL (
        SELECT snapshot.captured_at
        FROM design.workflow_completion_snapshots snapshot
        WHERE snapshot.fixture_id = fixture.id
          AND LOWER(BTRIM(COALESCE(snapshot.trigger, ''))) = 'workflow_release'
        ORDER BY snapshot.captured_at DESC, snapshot.id DESC
        LIMIT 1
      ) latest_snapshot ON TRUE
      LEFT JOIN LATERAL (
        SELECT release_package.id, release_package.version, release_package.created_at
        FROM design.fixture_release_packages release_package
        WHERE release_package.fixture_id = fixture.id
        ORDER BY release_package.version DESC, release_package.created_at DESC, release_package.id DESC
        LIMIT 1
      ) latest_package ON TRUE
      WHERE LOWER(BTRIM(COALESCE(project.status, 'active'))) NOT IN ('completed', 'released')
        AND (
          project_release_snapshot.id IS NULL
          OR (
            COALESCE(project.is_modified, FALSE) = TRUE
            AND project.updated_at > project_release_snapshot.captured_at
          )
        )
        AND COALESCE(progress.has_approved_release, FALSE) = FALSE
        AND NOT (
          COALESCE(fixture.is_workflow_complete, FALSE) = TRUE
          AND latest_snapshot.captured_at IS NOT NULL
        )
        AND (
          COALESCE(fixture.is_workflow_complete, FALSE) = TRUE
          OR COALESCE(progress.has_approved_2d, FALSE)
          OR (
            progress.non_release_stage_count > 0
            AND COALESCE(progress.all_non_release_stages_approved, FALSE)
          )
        )
    )
    INSERT INTO design.fixture_release_packages (
      fixture_id,
      version,
      status,
      created_by
    )
    SELECT
      eligible.fixture_id,
      eligible.target_version,
      ${sqlLiteral(RELEASE_PACKAGE_STATUSES.IN_PROGRESS)},
      NULL
    FROM eligible_fixtures eligible
    ON CONFLICT (fixture_id, version) DO NOTHING
  `);

  await client.query(`
    INSERT INTO design.fixture_release_deliverables (
      package_id,
      deliverable_code,
      sequence,
      is_required,
      applicability_status,
      status
    )
    SELECT
      release_package.id,
      definition.deliverable_code,
      definition.sequence,
      definition.is_required,
      definition.applicability_status,
      definition.status
    FROM design.fixture_release_packages release_package
    CROSS JOIN (
      VALUES
        ${definitionRows}
    ) AS definition (
      deliverable_code,
      sequence,
      is_required,
      applicability_status,
      status
    )
    ON CONFLICT (package_id, deliverable_code) DO NOTHING
  `);
}

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
    WITH ranked_assignments AS (
      SELECT
        id,
        ROW_NUMBER() OVER (
          PARTITION BY project_id, subdivision_id, assigned_leader_id
          ORDER BY created_at DESC, id DESC
        ) AS assignment_rank
      FROM design.project_subdivision_assignments
      WHERE is_active = TRUE
    )
    DELETE FROM design.project_subdivision_assignments assignment
    USING ranked_assignments ranked
    WHERE assignment.id = ranked.id
      AND ranked.assignment_rank > 1
  `);

  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_design_project_subdivision_assignments_active_unique
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
      is_modified BOOLEAN NOT NULL DEFAULT FALSE,
      plant TEXT,
      project_leader_id VARCHAR(50),
      team_lead_id VARCHAR(50),
      uploaded_by VARCHAR(50),
      created_by_user_id VARCHAR(50),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT design_projects_status_check CHECK (status IN ('active', 'on_hold', 'completed', 'released')),
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
    ADD COLUMN IF NOT EXISTS is_modified BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  `);

  await client.query(`
    UPDATE design.projects
    SET status = 'active'
    WHERE status IS NULL
       OR status NOT IN ('active', 'on_hold', 'completed', 'released')
  `);

  await client.query(`
    UPDATE design.projects
    SET is_modified = FALSE
    WHERE is_modified IS NULL
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
    ALTER TABLE design.projects
    DROP CONSTRAINT IF EXISTS design_projects_status_check
  `);

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
        CHECK (status IN ('active', 'on_hold', 'completed', 'released'));
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
      contribution_percent NUMERIC(5, 2),
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
    ALTER TABLE design.fixture_stage_contributions
    ALTER COLUMN contribution_percent DROP NOT NULL
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
    CREATE TABLE IF NOT EXISTS design.fixture_outsource_records (
      fixture_id UUID PRIMARY KEY REFERENCES design.fixtures(id) ON DELETE CASCADE,
      supplier_name TEXT NOT NULL,
      outsourced_stages TEXT[] NOT NULL,
      outsource_status TEXT NOT NULL DEFAULT 'outsourced',
      outsourced_by VARCHAR(50),
      outsourced_at TIMESTAMPTZ,
      completed_by VARCHAR(50),
      completed_at TIMESTAMPTZ,
      brought_in_house_by VARCHAR(50),
      brought_in_house_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await client.query(`
    ALTER TABLE design.fixture_outsource_records
    ADD COLUMN IF NOT EXISTS supplier_name TEXT,
    ADD COLUMN IF NOT EXISTS outsourced_stages TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
    ADD COLUMN IF NOT EXISTS outsource_status TEXT NOT NULL DEFAULT 'outsourced',
    ADD COLUMN IF NOT EXISTS outsourced_by VARCHAR(50),
    ADD COLUMN IF NOT EXISTS outsourced_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS completed_by VARCHAR(50),
    ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS brought_in_house_by VARCHAR(50),
    ADD COLUMN IF NOT EXISTS brought_in_house_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  `);

  await client.query(`
    UPDATE design.fixture_outsource_records
    SET outsourced_stages = ARRAY['Concept', '3D', '2D']::text[]
    WHERE outsourced_stages IS NULL
       OR array_length(outsourced_stages, 1) IS NULL
  `);

  await client.query(`
    UPDATE design.fixture_outsource_records
    SET outsource_status = 'outsourced'
    WHERE outsource_status IS NULL
       OR outsource_status NOT IN ('outsourced', 'completed', 'brought_in_house')
  `);

  await client.query(`
    ALTER TABLE design.fixture_outsource_records
    DROP CONSTRAINT IF EXISTS fixture_outsource_supplier_name_check,
    DROP CONSTRAINT IF EXISTS fixture_outsource_stages_check,
    DROP CONSTRAINT IF EXISTS fixture_outsource_status_check
  `);

  await client.query(`
    ALTER TABLE design.fixture_outsource_records
    ADD CONSTRAINT fixture_outsource_supplier_name_check
      CHECK (supplier_name IS NOT NULL AND BTRIM(supplier_name) <> ''),
    ADD CONSTRAINT fixture_outsource_stages_check
      CHECK (
        array_length(outsourced_stages, 1) >= 1
        AND outsourced_stages <@ ARRAY['Concept', '3D', '2D']::text[]
      ),
    ADD CONSTRAINT fixture_outsource_status_check
      CHECK (outsource_status IN ('outsourced', 'completed', 'brought_in_house'))
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_fixture_outsource_records_status_updated
    ON design.fixture_outsource_records (outsource_status, updated_at DESC)
  `);

  await client.query(`
    INSERT INTO design.fixture_outsource_records (
      fixture_id,
      supplier_name,
      outsourced_stages,
      outsource_status,
      outsourced_by,
      outsourced_at,
      created_at,
      updated_at
    )
    SELECT
      f.id,
      BTRIM(f.vendor_name),
      ARRAY['Concept', '3D', '2D']::text[],
      'outsourced',
      f.outsourced_by,
      COALESCE(f.outsourced_at, f.updated_at, NOW()),
      COALESCE(f.outsourced_at, f.created_at, NOW()),
      COALESCE(f.updated_at, NOW())
    FROM design.fixtures f
    WHERE f.is_outsourced = TRUE
      AND f.vendor_name IS NOT NULL
      AND BTRIM(f.vendor_name) <> ''
    ON CONFLICT (fixture_id) DO NOTHING
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS design.recent_outsource_suppliers (
      supplier_key TEXT PRIMARY KEY,
      supplier_name TEXT NOT NULL,
      last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT recent_outsource_supplier_name_check CHECK (BTRIM(supplier_name) <> '')
    )
  `);

  await client.query(`
    INSERT INTO design.recent_outsource_suppliers (
      supplier_key,
      supplier_name,
      last_used_at,
      created_at,
      updated_at
    )
    SELECT DISTINCT ON (supplier_key)
      supplier_key,
      supplier_name,
      latest_used_at,
      latest_used_at,
      latest_used_at
    FROM (
      SELECT
        LOWER(BTRIM(supplier_name)) AS supplier_key,
        BTRIM(supplier_name) AS supplier_name,
        COALESCE(outsourced_at, updated_at, created_at, NOW()) AS latest_used_at
      FROM design.fixture_outsource_records
      WHERE supplier_name IS NOT NULL
        AND BTRIM(supplier_name) <> ''
      UNION ALL
      SELECT
        LOWER(BTRIM(vendor_name)) AS supplier_key,
        BTRIM(vendor_name) AS supplier_name,
        COALESCE(outsourced_at, updated_at, created_at, NOW()) AS latest_used_at
      FROM design.fixtures
      WHERE vendor_name IS NOT NULL
        AND BTRIM(vendor_name) <> ''
    ) suppliers
    ORDER BY supplier_key, latest_used_at DESC, supplier_name ASC
    ON CONFLICT (supplier_key) DO UPDATE
    SET supplier_name = EXCLUDED.supplier_name,
        last_used_at = GREATEST(design.recent_outsource_suppliers.last_used_at, EXCLUDED.last_used_at),
        updated_at = NOW()
  `);

  await client.query(`
    WITH ranked_suppliers AS (
      SELECT
        supplier_key,
        ROW_NUMBER() OVER (ORDER BY last_used_at DESC, supplier_name ASC) AS rn
      FROM design.recent_outsource_suppliers
    )
    DELETE FROM design.recent_outsource_suppliers recent
    USING ranked_suppliers ranked
    WHERE recent.supplier_key = ranked.supplier_key
      AND ranked.rn > 6
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

  await ensureFixtureOutsourceAssignmentSchema(client);
  await ensureFixtureReleaseDeliverablesSchema(client);

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
