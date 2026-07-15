-- Repairs contradictory open 2D completion activities without touching approved history.
-- Run inside psql; final SELECT lists exactly which rows were repaired.

BEGIN;

CREATE SCHEMA IF NOT EXISTS repair;

CREATE TABLE IF NOT EXISTS repair.design_2d_completion_lifecycle_backups (
  run_id TEXT NOT NULL,
  backed_up_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  task_id INTEGER NOT NULL,
  before_row JSONB NOT NULL,
  PRIMARY KEY (run_id, task_id)
);

WITH run AS (
  SELECT 'design_2d_completion_lifecycle_' || to_char(clock_timestamp(), 'YYYYMMDD_HH24MISS_MS') AS run_id
), affected AS (
  SELECT t.*
  FROM tasks t
  WHERE t.task_type = 'design_2d_completion'
    AND t.status IN ('assigned', 'in_progress', 'on_hold', 'rework')
    AND COALESCE(t.completion_percent, 0) < 100
    AND (
      COALESCE(t.verification_status, 'pending') = 'approved'
      OR t.approved_at IS NOT NULL
      OR t.approved_by IS NOT NULL
      OR t.closed_at IS NOT NULL
      OR t.lifecycle_status = 'completed'
    )
), backed_up AS (
  INSERT INTO repair.design_2d_completion_lifecycle_backups (run_id, task_id, before_row)
  SELECT run.run_id, affected.id, to_jsonb(affected)
  FROM run, affected
  ON CONFLICT (run_id, task_id) DO NOTHING
  RETURNING task_id
), repaired AS (
  UPDATE tasks t
  SET verification_status = CASE WHEN t.status = 'rework' THEN 'rejected' ELSE 'pending' END,
      lifecycle_status = CASE WHEN t.status = 'rework' THEN 'rework' WHEN t.status IN ('in_progress', 'on_hold') THEN 'in_progress' ELSE 'assigned' END,
      completion_percent = COALESCE(t.completion_percent, 0),
      approved_at = NULL,
      approved_by = NULL,
      closed_at = NULL,
      verified_at = NULL,
      updated_at = NOW()
  FROM affected
  WHERE t.id = affected.id
  RETURNING
    t.id,
    t.project_id,
    t.fixture_id,
    t.completion_task_code,
    t.completion_task_revision,
    t.title,
    t.assigned_to,
    t.status,
    t.verification_status,
    t.lifecycle_status,
    t.completion_percent
)
SELECT *
FROM repaired
ORDER BY project_id, fixture_id, completion_task_code, completion_task_revision, id;

COMMIT;