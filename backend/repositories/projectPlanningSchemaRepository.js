const { DEFAULT_WORKING_HOURS_PER_DAY } = require("../lib/projectScope");

async function ensureProjectScopePlanningSchema(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS design.project_planning_settings (
      setting_key TEXT PRIMARY KEY,
      setting_value NUMERIC(10, 4) NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT project_planning_settings_positive_check CHECK (setting_value > 0)
    )
  `);

  await client.query(`
    INSERT INTO design.project_planning_settings (setting_key, setting_value)
    VALUES ('working_hours_per_day', ${DEFAULT_WORKING_HOURS_PER_DAY})
    ON CONFLICT (setting_key) DO NOTHING
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS design.project_planned_time (
      project_id UUID NOT NULL REFERENCES design.projects(id) ON DELETE CASCADE,
      stage TEXT NOT NULL,
      entered_value NUMERIC,
      entered_unit TEXT NOT NULL,
      normalized_hours NUMERIC,
      updated_by VARCHAR(50) REFERENCES users(employee_id),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      version INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (project_id, stage),
      CONSTRAINT project_planned_time_stage_check CHECK (stage IN ('CONCEPT', 'DAP', 'THREE_D_FINISH', 'TWO_D_FINISH')),
      CONSTRAINT project_planned_time_unit_check CHECK (entered_unit IN ('HOURS', 'DAYS')),
      CONSTRAINT project_planned_time_entered_value_check CHECK (entered_value IS NULL OR entered_value >= 0),
      CONSTRAINT project_planned_time_normalized_hours_check CHECK (normalized_hours IS NULL OR normalized_hours >= 0),
      CONSTRAINT project_planned_time_version_check CHECK (version > 0)
    )
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_project_planned_time_project_updated
    ON design.project_planned_time (project_id, updated_at DESC)
  `);
}

async function dropProjectScopePlanningSchema(client) {
  await client.query(`DROP TABLE IF EXISTS design.project_planned_time`);
  await client.query(`DROP TABLE IF EXISTS design.project_planning_settings`);
}

module.exports = {
  dropProjectScopePlanningSchema,
  ensureProjectScopePlanningSchema,
};