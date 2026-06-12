BEGIN;

INSERT INTO permissions (id, name, description)
VALUES
  (
    'upload_native_design_data',
    'Upload Native Design Data',
    'Allows Design fixture ingestion via native spreadsheet session pipeline.'
  ),
  (
    'upload_legacy_design_data',
    'Upload Legacy Design Data (Deprecated)',
    'Deprecated historical permission. Legacy fixture upload is retired; grant Upload Native Design Data instead.'
  )
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    updated_at = NOW();

INSERT INTO role_permissions (role_id, permission_id)
SELECT role_id, 'upload_native_design_data'
FROM role_permissions
WHERE permission_id = 'upload_legacy_design_data'
ON CONFLICT (role_id, permission_id) DO NOTHING;

UPDATE roles
SET permissions = CASE
  WHEN permissions ? 'upload_native_design_data' THEN permissions - 'upload_legacy_design_data'
  WHEN permissions ? 'upload_legacy_design_data' THEN jsonb_set(
    permissions - 'upload_legacy_design_data',
    ARRAY['upload_native_design_data'],
    'true'::jsonb,
    true
  )
  ELSE permissions - 'upload_legacy_design_data'
END
WHERE permissions ? 'upload_legacy_design_data'
   OR permissions ? 'upload_native_design_data';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_permissions'
      AND column_name = 'user_id'
  )
  AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_permissions'
      AND column_name = 'permission_id'
  ) THEN
    EXECUTE $sql$
      INSERT INTO user_permissions (user_id, permission_id)
      SELECT user_id, 'upload_native_design_data'
      FROM user_permissions
      WHERE permission_id = 'upload_legacy_design_data'
      ON CONFLICT DO NOTHING
    $sql$;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'group_permissions'
      AND column_name = 'group_id'
  )
  AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'group_permissions'
      AND column_name = 'permission_id'
  ) THEN
    EXECUTE $sql$
      INSERT INTO group_permissions (group_id, permission_id)
      SELECT group_id, 'upload_native_design_data'
      FROM group_permissions
      WHERE permission_id = 'upload_legacy_design_data'
      ON CONFLICT DO NOTHING
    $sql$;
  END IF;
END $$;

COMMIT;

SELECT 'role_permissions_legacy_holders' AS check_name, COUNT(*)::int AS count
FROM role_permissions
WHERE permission_id = 'upload_legacy_design_data'
UNION ALL
SELECT 'role_permissions_native_holders' AS check_name, COUNT(*)::int AS count
FROM role_permissions
WHERE permission_id = 'upload_native_design_data'
UNION ALL
SELECT 'roles_json_still_exposing_legacy' AS check_name, COUNT(*)::int AS count
FROM roles
WHERE permissions ? 'upload_legacy_design_data';
