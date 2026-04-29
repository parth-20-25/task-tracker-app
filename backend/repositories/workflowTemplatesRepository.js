const { pool } = require("../db");

function parseJsonArray(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch (_error) {
    return [];
  }
}

function mapWorkflowTemplateRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    department_id: row.department_id,
    template_name: row.template_name,
    description: row.description || null,
    default_priority: row.default_priority || null,
    default_proof_required: row.default_proof_required === true,
    default_approval_required: row.default_approval_required !== false,
    default_due_days: row.default_due_days === null || row.default_due_days === undefined
      ? null
      : Number(row.default_due_days),
    escalation_level: row.escalation_level === null || row.escalation_level === undefined
      ? 0
      : Number(row.escalation_level),
    eligible_role_ids: parseJsonArray(row.eligible_role_ids),
    is_active: row.is_active !== false,
    created_at: row.created_at,
    created_by: row.created_by || null,
    updated_at: row.updated_at || null,
  };
}

async function listWorkflowTemplates({ departmentId = null, isActive = null } = {}, client = pool) {
  const params = [];
  const filters = [];

  if (departmentId) {
    params.push(departmentId);
    filters.push(`wt.department_id = $${params.length}`);
  }

  if (isActive !== null) {
    params.push(Boolean(isActive));
    filters.push(`wt.is_active = $${params.length}`);
  }

  const whereClause = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
  const result = await client.query(
    `
      SELECT
        wt.*,
        d.name AS department_name
      FROM workflow_templates wt
      LEFT JOIN departments d ON d.id = wt.department_id
      ${whereClause}
      ORDER BY d.name NULLS LAST, wt.template_name ASC
    `,
    params,
  );

  return result.rows.map((row) => ({
    ...mapWorkflowTemplateRow(row),
    department_name: row.department_name || null,
  }));
}

async function findWorkflowTemplateById(templateId, client = pool) {
  const result = await client.query(
    `
      SELECT *
      FROM workflow_templates
      WHERE id = $1
      LIMIT 1
    `,
    [templateId],
  );

  return mapWorkflowTemplateRow(result.rows[0] || null);
}

async function upsertWorkflowTemplate(template, client = pool) {
  const result = await client.query(
    `
      INSERT INTO workflow_templates (
        id,
        department_id,
        template_name,
        description,
        default_priority,
        default_proof_required,
        default_approval_required,
        default_due_days,
        escalation_level,
        eligible_role_ids,
        is_active,
        created_by,
        created_at,
        updated_at
      )
      VALUES (
        COALESCE($1::uuid, gen_random_uuid()),
        $2::text,
        $3::text,
        $4::text,
        $5::text,
        $6::boolean,
        $7::boolean,
        $8::int,
        $9::int,
        $10::jsonb,
        $11::boolean,
        $12::varchar(50),
        NOW(),
        NOW()
      )
      ON CONFLICT (id) DO UPDATE
      SET department_id = EXCLUDED.department_id,
          template_name = EXCLUDED.template_name,
          description = EXCLUDED.description,
          default_priority = EXCLUDED.default_priority,
          default_proof_required = EXCLUDED.default_proof_required,
          default_approval_required = EXCLUDED.default_approval_required,
          default_due_days = EXCLUDED.default_due_days,
          escalation_level = EXCLUDED.escalation_level,
          eligible_role_ids = EXCLUDED.eligible_role_ids,
          is_active = EXCLUDED.is_active,
          updated_at = NOW()
      RETURNING id
    `,
    [
      template.id || null,
      template.department_id,
      template.template_name,
      template.description || null,
      template.default_priority || null,
      template.default_proof_required === true,
      template.default_approval_required !== false,
      template.default_due_days === null || template.default_due_days === undefined
        ? null
        : Number(template.default_due_days),
      template.escalation_level === null || template.escalation_level === undefined
        ? 0
        : Number(template.escalation_level),
      JSON.stringify(Array.isArray(template.eligible_role_ids) ? template.eligible_role_ids : []),
      template.is_active !== false,
      template.created_by || null,
    ],
  );

  return findWorkflowTemplateById(result.rows[0].id, client);
}

async function deleteWorkflowTemplate(templateId, client = pool) {
  const result = await client.query(
    `
      UPDATE workflow_templates
      SET is_active = FALSE,
          updated_at = NOW()
      WHERE id = $1
      RETURNING id
    `,
    [templateId],
  );

  return result.rowCount > 0;
}

module.exports = {
  deleteWorkflowTemplate,
  findWorkflowTemplateById,
  listWorkflowTemplates,
  upsertWorkflowTemplate,
};
