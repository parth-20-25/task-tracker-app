const { pool } = require("../db");
const { AppError } = require("../lib/AppError");

async function listKpiDefinitions(client = pool) {
  const result = await client.query(`SELECT * FROM kpi_definitions ORDER BY name`);
  return result.rows;
}

async function upsertKpiDefinition(kpi, client = pool) {
  await client.query(
    `
      INSERT INTO kpi_definitions (id, name, description, target_value)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (id) DO UPDATE
      SET name = EXCLUDED.name,
          description = EXCLUDED.description,
          target_value = EXCLUDED.target_value
    `,
    [kpi.id, kpi.name, kpi.description || "", kpi.target_value ?? null],
  );

  return listKpiDefinitions(client);
}

async function listEscalationRules(client = pool) {
  const result = await client.query(`SELECT * FROM escalation_rules WHERE COALESCE(is_active, TRUE) = TRUE ORDER BY priority, after_minutes, id`);
  return result.rows;
}

async function listEscalationRulesForDepartment(departmentId, priority, client = pool) {
  const result = await client.query(
    `
      SELECT *
      FROM escalation_rules
      WHERE priority = $1
        AND COALESCE(is_active, TRUE) = TRUE
        AND (department_id = $2 OR department_id IS NULL)
      ORDER BY
        CASE WHEN department_id = $2 THEN 0 ELSE 1 END,
        after_minutes,
        id
    `,
    [priority, departmentId || null],
  );

  return result.rows;
}

async function upsertEscalationRule(rule, client = pool) {
  await client.query(
    `
      INSERT INTO escalation_rules (id, name, priority, after_minutes, notify_role, department_id, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (id) DO UPDATE
      SET name = EXCLUDED.name,
          priority = EXCLUDED.priority,
          after_minutes = EXCLUDED.after_minutes,
          notify_role = EXCLUDED.notify_role,
          department_id = EXCLUDED.department_id,
          is_active = EXCLUDED.is_active
    `,
    [
      rule.id,
      rule.name,
      rule.priority || "medium",
      Number(rule.after_minutes) || 0,
      rule.notify_role || null,
      rule.department_id || null,
      rule.is_active !== false,
    ],
  );

  return listEscalationRules(client);
}

async function deleteEscalationRule(ruleId, client = pool) {
  const activeCount = await client.query(
    `
      SELECT COUNT(*)
      FROM tasks t
      JOIN escalation_rules er
        ON er.id = $1
      WHERE t.escalation_level > 0
        AND (er.department_id IS NULL OR er.department_id = t.department_id)
    `,
    [ruleId],
  );
  if (parseInt(activeCount.rows[0].count) > 0) {
    throw new AppError(409, "Cannot delete escalation rule: it is referenced by active escalations");
  }

  await client.query(`DELETE FROM escalation_rules WHERE id = $1`, [ruleId]);
  return true;
}

module.exports = {
  deleteEscalationRule,
  listEscalationRules,
  listEscalationRulesForDepartment,
  listKpiDefinitions,
  upsertEscalationRule,
  upsertKpiDefinition,
};
