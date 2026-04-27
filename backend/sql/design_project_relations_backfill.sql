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
ON CONFLICT (project_no, department_id) DO NOTHING;

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
ON CONFLICT (project_id, scope_name) DO NOTHING;

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
  );

UPDATE design.projects
SET department_id = BTRIM(department_id),
    updated_at = NOW()
WHERE department_id IS NOT NULL
  AND department_id <> BTRIM(department_id);

UPDATE design.upload_batches ub
SET project_id = s.project_id
FROM design.scopes s
WHERE ub.scope_id = s.id
  AND ub.project_id IS DISTINCT FROM s.project_id;

UPDATE design.fixtures f
SET project_id = s.project_id
FROM design.scopes s
WHERE f.scope_id = s.id
  AND f.project_id IS DISTINCT FROM s.project_id;

ALTER TABLE design.projects
ALTER COLUMN department_id SET NOT NULL;

ALTER TABLE design.scopes
ALTER COLUMN project_id SET NOT NULL;

ALTER TABLE design.fixtures
ALTER COLUMN project_id SET NOT NULL;

DO $$
DECLARE
  department_attnum smallint;
  scope_project_attnum smallint;
  fixture_project_attnum smallint;
BEGIN
  SELECT attnum
  INTO department_attnum
  FROM pg_attribute
  WHERE attrelid = 'design.projects'::regclass
    AND attname = 'department_id'
    AND NOT attisdropped;

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

  SELECT attnum
  INTO scope_project_attnum
  FROM pg_attribute
  WHERE attrelid = 'design.scopes'::regclass
    AND attname = 'project_id'
    AND NOT attisdropped;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'design.scopes'::regclass
      AND contype = 'f'
      AND conkey = ARRAY[scope_project_attnum]
  ) THEN
    ALTER TABLE design.scopes
    ADD CONSTRAINT fk_scope_project
    FOREIGN KEY (project_id) REFERENCES design.projects(id);
  END IF;

  SELECT attnum
  INTO fixture_project_attnum
  FROM pg_attribute
  WHERE attrelid = 'design.fixtures'::regclass
    AND attname = 'project_id'
    AND NOT attisdropped;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'design.fixtures'::regclass
      AND contype = 'f'
      AND conkey = ARRAY[fixture_project_attnum]
  ) THEN
    ALTER TABLE design.fixtures
    ADD CONSTRAINT fk_fixture_project
    FOREIGN KEY (project_id) REFERENCES design.projects(id);
  END IF;
END $$;

CREATE OR REPLACE VIEW design.projects_without_fixtures AS
SELECT p.id AS project_id
FROM design.projects p
LEFT JOIN design.fixtures f
  ON f.project_id = p.id
WHERE f.id IS NULL;
