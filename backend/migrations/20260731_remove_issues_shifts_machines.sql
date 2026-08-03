BEGIN;

-- Apply only after a production pg_dump containing these objects and task columns succeeds.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM workflow_transitions
    WHERE required_permission IN ('can_manage_shifts', 'can_manage_machines')
  ) THEN
    RAISE EXCEPTION 'Obsolete shift/machine permissions are still referenced by workflow transitions';
  END IF;
END $$;

UPDATE tasks
SET workflow_template_id = NULL
WHERE workflow_template_id IN (
  SELECT id
  FROM workflow_templates
  WHERE template_name IN ('Shift Validation', 'Machine Readiness')
);

DELETE FROM workflow_templates
WHERE template_name IN ('Shift Validation', 'Machine Readiness');

DELETE FROM role_permissions
WHERE permission_id IN ('can_manage_shifts', 'can_manage_machines');

UPDATE roles
SET permissions = COALESCE(permissions, '{}'::jsonb)
  - 'can_manage_shifts'
  - 'can_manage_machines';

DELETE FROM permissions
WHERE id IN ('can_manage_shifts', 'can_manage_machines');

ALTER TABLE tasks
  DROP COLUMN IF EXISTS shift_id,
  DROP COLUMN IF EXISTS machine_id,
  DROP COLUMN IF EXISTS machine_name;

DROP TABLE IF EXISTS issue_comments;
DROP TABLE IF EXISTS issues;
DROP TABLE IF EXISTS shifts;
DROP TABLE IF EXISTS machines;

COMMIT;
