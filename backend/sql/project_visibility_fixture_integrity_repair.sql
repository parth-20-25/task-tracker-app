BEGIN;

CREATE TEMP TABLE project_integrity_before ON COMMIT DROP AS
WITH fixture_counts AS (
  SELECT
    project_id,
    COUNT(*)::integer AS actual_fixture_count
  FROM design.fixtures
  GROUP BY project_id
)
SELECT
  p.id::text AS project_id,
  p.department_id,
  p.project_no AS project_number_before,
  p.project_name AS project_name_before,
  NULL::integer AS existing_stored_count,
  latest_batch.accepted_rows::integer AS latest_batch_display_count,
  COALESCE(fixture_counts.actual_fixture_count, 0)::integer AS actual_fixture_count,
  NULLIF(REGEXP_REPLACE(BTRIM(COALESCE(p.project_no, '')), '^[-_]+[[:space:]]*', ''), '') AS repaired_project_number,
  NULLIF(REGEXP_REPLACE(BTRIM(COALESCE(p.project_name, '')), '^[-_]+[[:space:]]*', ''), '') AS repaired_project_name
FROM design.projects p
LEFT JOIN fixture_counts
  ON fixture_counts.project_id = p.id
LEFT JOIN LATERAL (
  SELECT accepted_rows
  FROM design.upload_batches batch
  WHERE batch.project_id = p.id
  ORDER BY
    CASE WHEN COALESCE(batch.status, 'active') = 'active' THEN 0 ELSE 1 END,
    batch.uploaded_at DESC,
    batch.id DESC
  LIMIT 1
) latest_batch ON TRUE;

UPDATE design.projects p
SET project_no = before.repaired_project_number,
    updated_at = NOW()
FROM project_integrity_before before
WHERE p.id::text = before.project_id
  AND before.project_number_before ~ '^[[:space:]]*[-_]+[[:space:]]*[[:alnum:]]'
  AND before.repaired_project_number IS NOT NULL
  AND p.project_no IS DISTINCT FROM before.repaired_project_number;

UPDATE design.projects p
SET project_name = before.repaired_project_name,
    updated_at = NOW()
FROM project_integrity_before before
WHERE p.id::text = before.project_id
  AND before.project_name_before ~ '^[[:space:]]*[-_]+[[:space:]]*[[:alnum:]]'
  AND before.repaired_project_name IS NOT NULL
  AND p.project_name IS DISTINCT FROM before.repaired_project_name;

DO $$
BEGIN
  IF to_regclass('public.projects') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'projects'
         AND column_name = 'instance_count'
     ) THEN
    CREATE TEMP TABLE legacy_project_count_before ON COMMIT DROP AS
    WITH legacy_match AS (
      SELECT
        legacy.id::text AS legacy_project_id,
        legacy.project_no,
        legacy.department_id,
        legacy.instance_count AS existing_stored_count,
        COALESCE((
          SELECT COUNT(*)::integer
          FROM design.fixtures fixture
          JOIN design.projects design_project
            ON design_project.id = fixture.project_id
          WHERE design_project.id::text = legacy.id::text
             OR (
               design_project.department_id = legacy.department_id
               AND design_project.project_no = legacy.project_no
             )
        ), 0)::integer AS actual_fixture_count
      FROM public.projects legacy
    )
    SELECT *
    FROM legacy_match;

    WITH legacy_match AS (
      SELECT
        legacy.id,
        COALESCE((
          SELECT COUNT(*)::integer
          FROM design.fixtures fixture
          JOIN design.projects design_project
            ON design_project.id = fixture.project_id
          WHERE design_project.id::text = legacy.id::text
             OR (
               design_project.department_id = legacy.department_id
               AND design_project.project_no = legacy.project_no
             )
        ), 0)::integer AS actual_fixture_count,
        NULLIF(REGEXP_REPLACE(BTRIM(COALESCE(legacy.project_no, '')), '^[-_]+[[:space:]]*', ''), '') AS repaired_project_number,
        NULLIF(REGEXP_REPLACE(BTRIM(COALESCE(legacy.project_name, '')), '^[-_]+[[:space:]]*', ''), '') AS repaired_project_name
      FROM public.projects legacy
    )
    UPDATE public.projects legacy
    SET instance_count = legacy_match.actual_fixture_count,
        project_no = CASE
          WHEN legacy.project_no ~ '^[[:space:]]*[-_]+[[:space:]]*[[:alnum:]]'
            AND legacy_match.repaired_project_number IS NOT NULL
          THEN legacy_match.repaired_project_number
          ELSE legacy.project_no
        END,
        project_name = CASE
          WHEN legacy.project_name ~ '^[[:space:]]*[-_]+[[:space:]]*[[:alnum:]]'
            AND legacy_match.repaired_project_name IS NOT NULL
          THEN legacy_match.repaired_project_name
          ELSE legacy.project_name
        END,
        updated_at = NOW()
    FROM legacy_match
    WHERE legacy.id = legacy_match.id
      AND (
        legacy.instance_count IS DISTINCT FROM legacy_match.actual_fixture_count
        OR (
          legacy.project_no ~ '^[[:space:]]*[-_]+[[:space:]]*[[:alnum:]]'
          AND legacy_match.repaired_project_number IS NOT NULL
          AND legacy.project_no IS DISTINCT FROM legacy_match.repaired_project_number
        )
        OR (
          legacy.project_name ~ '^[[:space:]]*[-_]+[[:space:]]*[[:alnum:]]'
          AND legacy_match.repaired_project_name IS NOT NULL
          AND legacy.project_name IS DISTINCT FROM legacy_match.repaired_project_name
        )
      );
  ELSE
    CREATE TEMP TABLE legacy_project_count_before (
      legacy_project_id text,
      project_no text,
      department_id text,
      existing_stored_count integer,
      actual_fixture_count integer
    ) ON COMMIT DROP;
  END IF;
END $$;

SELECT
  before.project_id,
  before.project_number_before,
  after_project.project_no AS project_number_after,
  before.project_name_before,
  after_project.project_name AS project_name_after,
  legacy.existing_stored_count,
  before.latest_batch_display_count AS existing_displayed_count,
  before.actual_fixture_count,
  COALESCE(legacy.actual_fixture_count, before.actual_fixture_count) AS repaired_value
FROM project_integrity_before before
JOIN design.projects after_project
  ON after_project.id::text = before.project_id
LEFT JOIN legacy_project_count_before legacy
  ON legacy.legacy_project_id = before.project_id
  OR (
    legacy.department_id = before.department_id
    AND legacy.project_no = before.project_number_before
  )
WHERE before.project_number_before IS DISTINCT FROM after_project.project_no
   OR before.project_name_before IS DISTINCT FROM after_project.project_name
   OR legacy.existing_stored_count IS DISTINCT FROM legacy.actual_fixture_count
   OR (
     before.latest_batch_display_count IS NOT NULL
     AND before.latest_batch_display_count IS DISTINCT FROM before.actual_fixture_count
   )
ORDER BY before.project_number_before ASC, before.project_id ASC;

COMMIT;
