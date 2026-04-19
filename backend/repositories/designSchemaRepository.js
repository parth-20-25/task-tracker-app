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
      -- departments.id is TEXT in the existing production schema, so we keep the FK type aligned.
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
    CREATE TABLE IF NOT EXISTS design.instances (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      scope_id UUID NOT NULL REFERENCES design.scopes(id) ON DELETE CASCADE,
      instance_code TEXT NOT NULL,
      instance_index INTEGER NOT NULL,
      CONSTRAINT design_instances_scope_instance_code_key UNIQUE (scope_id, instance_code)
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS design.reworks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      instance_id UUID NOT NULL REFERENCES design.instances(id) ON DELETE CASCADE,
      planned_date DATE NOT NULL,
      is_completed BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
    CREATE INDEX IF NOT EXISTS idx_design_instances_scope_id
    ON design.instances (scope_id)
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_design_reworks_instance_id
    ON design.reworks (instance_id)
  `);

  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_design_reworks_instance_planned_date
    ON design.reworks (instance_id, planned_date)
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

  await client.query(`
    WITH design_departments AS (
      SELECT d.id
      FROM departments d
      WHERE LOWER(BTRIM(COALESCE(d.name, ''))) = 'design'
         OR LOWER(BTRIM(COALESCE(d.id, ''))) = 'design'
    ),
    source_rows AS (
      SELECT DISTINCT
        ds.id AS scope_id,
        GREATEST(
          COALESCE(
            p.instance_count,
            NULLIF(REGEXP_REPLACE(COALESCE(p.quantity_index, ''), '[^0-9-]', '', 'g'), '')::integer,
            0
          ),
          0
        ) AS instance_total
      FROM public.projects p
      JOIN design_departments dd
        ON dd.id = p.department_id
      JOIN design.projects dp
        ON dp.project_no = BTRIM(p.project_no)
       AND dp.department_id = p.department_id
      JOIN design.scopes ds
        ON ds.project_id = dp.id
       AND ds.scope_name = COALESCE(NULLIF(BTRIM(p.scope_name), ''), 'General')
      WHERE NULLIF(BTRIM(p.project_no), '') IS NOT NULL
    ),
    expanded_instances AS (
      SELECT DISTINCT
        sr.scope_id,
        gs.instance_index,
        CONCAT('I', LPAD(gs.instance_index::text, 3, '0')) AS instance_code
      FROM source_rows sr
      CROSS JOIN LATERAL generate_series(1, sr.instance_total) AS gs(instance_index)
    )
    INSERT INTO design.instances (
      scope_id,
      instance_code,
      instance_index
    )
    SELECT
      ei.scope_id,
      ei.instance_code,
      ei.instance_index
    FROM expanded_instances ei
    ON CONFLICT (scope_id, instance_code) DO UPDATE
    SET instance_index = EXCLUDED.instance_index
  `);

  await client.query(`
    WITH design_departments AS (
      SELECT d.id
      FROM departments d
      WHERE LOWER(BTRIM(COALESCE(d.name, ''))) = 'design'
         OR LOWER(BTRIM(COALESCE(d.id, ''))) = 'design'
    ),
    source_reworks AS (
      SELECT DISTINCT
        di.id AS instance_id,
        p.rework_date AS planned_date
      FROM public.projects p
      JOIN design_departments dd
        ON dd.id = p.department_id
      JOIN design.projects dp
        ON dp.project_no = BTRIM(p.project_no)
       AND dp.department_id = p.department_id
      JOIN design.scopes ds
        ON ds.project_id = dp.id
       AND ds.scope_name = COALESCE(NULLIF(BTRIM(p.scope_name), ''), 'General')
      JOIN design.instances di
        ON di.scope_id = ds.id
      WHERE p.rework_date IS NOT NULL
    )
    INSERT INTO design.reworks (
      instance_id,
      planned_date,
      is_completed,
      created_at
    )
    SELECT
      sr.instance_id,
      sr.planned_date,
      FALSE,
      NOW()
    FROM source_reworks sr
    WHERE NOT EXISTS (
      SELECT 1
      FROM design.reworks dr
      WHERE dr.instance_id = sr.instance_id
        AND dr.planned_date = sr.planned_date
    )
  `);
}

module.exports = {
  ensureDesignDepartmentSchema,
};
