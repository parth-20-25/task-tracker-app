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
      department_id TEXT NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
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
      project_id UUID NOT NULL REFERENCES design.projects(id) ON DELETE CASCADE,
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
      scope_id UUID NOT NULL REFERENCES design.scopes(id) ON DELETE CASCADE,
      fixture_no TEXT NOT NULL,
      op_no TEXT NOT NULL,
      part_name TEXT NOT NULL,
      fixture_type TEXT NOT NULL,
      qty INTEGER NOT NULL,
      CONSTRAINT design_fixtures_scope_fixture_no_key UNIQUE (scope_id, fixture_no)
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS design.upload_batches (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID NOT NULL REFERENCES design.projects(id) ON DELETE CASCADE,
      scope_id UUID NOT NULL REFERENCES design.scopes(id) ON DELETE CASCADE,
      uploaded_by VARCHAR(50),
      uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      total_rows INTEGER NOT NULL DEFAULT 0,
      accepted_rows INTEGER NOT NULL DEFAULT 0,
      rejected_rows INTEGER NOT NULL DEFAULT 0
    )
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
    CREATE INDEX IF NOT EXISTS idx_design_projects_project_no
    ON design.projects (project_no)
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_design_scopes_project_id
    ON design.scopes (project_id)
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_design_fixtures_scope_id
    ON design.fixtures (scope_id)
  `);

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

module.exports = {
  ensureDesignDepartmentSchema,
};
