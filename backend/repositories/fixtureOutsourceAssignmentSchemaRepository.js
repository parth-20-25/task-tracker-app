const {
  OUTSOURCE_ASSIGNMENT_STATUSES,
  OUTSOURCE_PRIORITIES,
} = require("../lib/fixtureOutsourceAssignments");

function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlValueList(values) {
  return values.map(sqlLiteral).join(", ");
}

async function ensureFixtureOutsourceAssignmentSchema(client) {
  const statuses = sqlValueList(Object.values(OUTSOURCE_ASSIGNMENT_STATUSES));
  const priorities = sqlValueList(Object.values(OUTSOURCE_PRIORITIES));

  await client.query(`
    CREATE TABLE IF NOT EXISTS design.vendors (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      code TEXT,
      contact_name TEXT,
      contact_email TEXT,
      contact_phone TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by VARCHAR(50) REFERENCES public.users(employee_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT design_vendors_name_check CHECK (BTRIM(name) <> ''),
      CONSTRAINT design_vendors_code_check CHECK (code IS NULL OR BTRIM(code) <> '')
    )
  `);

  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_design_vendors_name_unique
    ON design.vendors (LOWER(BTRIM(name)))
  `);

  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_design_vendors_code_unique
    ON design.vendors (LOWER(BTRIM(code)))
    WHERE code IS NOT NULL
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_design_vendors_active_name
    ON design.vendors (is_active, name)
  `);

  await client.query(`
    INSERT INTO design.vendors (name)
    SELECT supplier_name
    FROM (
      SELECT BTRIM(recent.supplier_name) AS supplier_name
      FROM design.recent_outsource_suppliers recent
      WHERE BTRIM(COALESCE(recent.supplier_name, '')) <> ''
      UNION
      SELECT BTRIM(legacy.supplier_name) AS supplier_name
      FROM design.fixture_outsource_records legacy
      WHERE BTRIM(COALESCE(legacy.supplier_name, '')) <> ''
    ) existing_supplier
    ON CONFLICT DO NOTHING
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS design.fixture_outsource_assignments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      fixture_id UUID NOT NULL REFERENCES design.fixtures(id) ON DELETE RESTRICT,
      workflow_stage_code TEXT NOT NULL,
      workflow_stage_name TEXT NOT NULL,
      workflow_stage_version INTEGER NOT NULL DEFAULT 0,
      vendor_id UUID NOT NULL REFERENCES design.vendors(id) ON DELETE RESTRICT,
      internal_coordinator_id VARCHAR(50) NOT NULL
        REFERENCES public.users(employee_id) ON DELETE RESTRICT,
      deadline TIMESTAMPTZ NOT NULL,
      priority TEXT NOT NULL DEFAULT 'medium',
      status TEXT NOT NULL DEFAULT 'OUTSOURCED',
      instructions TEXT NOT NULL,
      expected_deliverables TEXT,
      work_order_reference TEXT,
      reference_path TEXT,
      outsourced_by VARCHAR(50) NOT NULL
        REFERENCES public.users(employee_id) ON DELETE RESTRICT,
      outsourced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      submitted_at TIMESTAMPTZ,
      reviewed_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      cancelled_at TIMESTAMPTZ,
      cancellation_reason TEXT,
      conversion_reason TEXT,
      source_internal_task_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT design_fixture_outsource_stage_code_check
        CHECK (BTRIM(workflow_stage_code) <> ''),
      CONSTRAINT design_fixture_outsource_stage_name_check
        CHECK (BTRIM(workflow_stage_name) <> ''),
      CONSTRAINT design_fixture_outsource_stage_version_check
        CHECK (workflow_stage_version >= 0),
      CONSTRAINT design_fixture_outsource_priority_check
        CHECK (priority IN (${priorities})),
      CONSTRAINT design_fixture_outsource_status_check
        CHECK (status IN (${statuses})),
      CONSTRAINT design_fixture_outsource_instructions_check
        CHECK (BTRIM(instructions) <> ''),
      CONSTRAINT design_fixture_outsource_source_task_ids_check
        CHECK (JSONB_TYPEOF(source_internal_task_ids) = 'array'),
      CONSTRAINT design_fixture_outsource_cancel_state_check
        CHECK (
          (status = 'CANCELLED' AND cancelled_at IS NOT NULL AND BTRIM(COALESCE(cancellation_reason, '')) <> '')
          OR (status <> 'CANCELLED' AND cancelled_at IS NULL)
        )
    )
  `);

  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_fixture_outsource_assignments_active_stage
    ON design.fixture_outsource_assignments (
      fixture_id,
      workflow_stage_code,
      workflow_stage_version
    )
    WHERE status <> 'CANCELLED'
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_fixture_outsource_assignments_fixture_status
    ON design.fixture_outsource_assignments (
      fixture_id,
      workflow_stage_code,
      status,
      updated_at DESC
    )
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_fixture_outsource_assignments_coordinator_deadline
    ON design.fixture_outsource_assignments (
      internal_coordinator_id,
      status,
      deadline
    )
    WHERE status <> 'CANCELLED'
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS design.fixture_outsource_assignment_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      assignment_id UUID NOT NULL
        REFERENCES design.fixture_outsource_assignments(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      previous_status TEXT,
      new_status TEXT,
      actor_id VARCHAR(50) REFERENCES public.users(employee_id) ON DELETE SET NULL,
      reason TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT design_fixture_outsource_event_type_check
        CHECK (BTRIM(event_type) <> ''),
      CONSTRAINT design_fixture_outsource_event_previous_status_check
        CHECK (previous_status IS NULL OR previous_status IN (${statuses})),
      CONSTRAINT design_fixture_outsource_event_new_status_check
        CHECK (new_status IS NULL OR new_status IN (${statuses}))
    )
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_fixture_outsource_assignment_events_history
    ON design.fixture_outsource_assignment_events (assignment_id, created_at DESC, id DESC)
  `);
}

module.exports = {
  ensureFixtureOutsourceAssignmentSchema,
};
