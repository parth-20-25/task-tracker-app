const { pool } = require("../db");

const DEFAULT_WORKFLOW_STAGE_NAMES = ["Concept", "DAP", "3D", "2D"];

function cloneDefaultStages() {
  return [...DEFAULT_WORKFLOW_STAGE_NAMES];
}

function buildDefaultWorkflowName(department) {
  const baseName = String(department?.name || department?.id || "department")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return `${baseName || "department"}_workflow`;
}

function mapWorkflowStages(stageRows) {
  return stageRows.map((stage, index) => ({
    id: stage.id,
    name: stage.stage_name || stage.name,
    order: Number(stage.sequence_order ?? stage.order_index ?? index + 1),
    is_final: Boolean(stage.is_final),
  }));
}

async function listWorkflowStageRows(workflowId, client = pool) {
  const stageResult = await client.query(
    `
      SELECT id, stage_name, name, sequence_order, order_index, is_final
      FROM workflow_stages
      WHERE workflow_id = $1
        AND is_active = TRUE
      ORDER BY COALESCE(sequence_order, order_index, 0) ASC, created_at ASC
    `,
    [workflowId],
  );

  return stageResult.rows;
}

async function repairOrphanDesignProjects(departmentId = null, client = pool) {
  const params = [];
  const filters = [
    "p.department_id IS NULL",
    "u.department_id IS NOT NULL",
  ];

  if (departmentId) {
    params.push(departmentId);
    filters.push(`u.department_id = $${params.length}`);
  }

  const result = await client.query(
    `
      UPDATE design.projects p
      SET department_id = u.department_id,
          updated_at = NOW()
      FROM users u
      WHERE p.uploaded_by = u.employee_id
        AND ${filters.join("\n        AND ")}
      RETURNING p.id
    `,
    params,
  );

  return result.rowCount;
}

async function repairProjectDepartmentForProject(projectId, departmentId, client = pool) {
  if (!projectId || !departmentId) {
    return 0;
  }

  const result = await client.query(
    `
      UPDATE design.projects
      SET department_id = $2,
          updated_at = NOW()
      WHERE id = $1
        AND department_id IS NULL
      RETURNING id
    `,
    [projectId, departmentId],
  );

  return result.rowCount;
}

async function repairProjectDepartmentForScope(scopeId, departmentId, client = pool) {
  if (!scopeId || !departmentId) {
    return 0;
  }

  const result = await client.query(
    `
      UPDATE design.projects p
      SET department_id = $2,
          updated_at = NOW()
      FROM design.scopes s
      WHERE s.id = $1
        AND s.project_id = p.id
        AND p.department_id IS NULL
      RETURNING p.id
    `,
    [scopeId, departmentId],
  );

  return result.rowCount;
}

async function repairProjectDepartmentForFixture(fixtureId, departmentId, client = pool) {
  if (!fixtureId || !departmentId) {
    return 0;
  }

  const result = await client.query(
    `
      UPDATE design.projects p
      SET department_id = $2,
          updated_at = NOW()
      FROM design.scopes s
      JOIN design.fixtures f
        ON f.scope_id = s.id
      WHERE f.id = $1
        AND s.project_id = p.id
        AND p.department_id IS NULL
      RETURNING p.id
    `,
    [fixtureId, departmentId],
  );

  return result.rowCount;
}

async function ensureDepartmentWorkflow(departmentId, client = pool) {
  if (!departmentId) {
    return {
      id: null,
      name: null,
      first_stage_id: null,
      stages: [],
      workflowRecovered: false,
      usedFallback: true,
    };
  }

  const departmentResult = await client.query(
    `
      SELECT id, name
      FROM departments
      WHERE id = $1
      LIMIT 1
    `,
    [departmentId],
  );

  const department = departmentResult.rows[0] || { id: departmentId, name: departmentId };
  const workflowName = buildDefaultWorkflowName(department);
  const workflowDescription = `Auto-recovered default workflow for ${department.name || department.id}`;

  let workflowRecovered = false;
  let usedFallback = false;

  const workflowResult = await client.query(
    `
      INSERT INTO workflows (
        id,
        name,
        description,
        department_id,
        is_active,
        created_at,
        updated_at
      )
      VALUES (
        gen_random_uuid()::text,
        $2,
        $3,
        $1,
        TRUE,
        NOW(),
        NOW()
      )
      ON CONFLICT (department_id) DO UPDATE
      SET is_active = TRUE,
          updated_at = NOW()
      RETURNING *
    `,
    [departmentId, workflowName, workflowDescription],
  );

  let workflow = workflowResult.rows[0];

  let stageRows = await listWorkflowStageRows(workflow.id, client);

  if (stageRows.length === 0) {
    workflowRecovered = true;
    usedFallback = true;

    for (let index = 0; index < DEFAULT_WORKFLOW_STAGE_NAMES.length; index += 1) {
      const stageName = DEFAULT_WORKFLOW_STAGE_NAMES[index];
      await client.query(
        `
          INSERT INTO workflow_stages (
            id,
            workflow_id,
            stage_name,
            name,
            description,
            order_index,
            sequence_order,
            is_final,
            is_active,
            created_at,
            updated_at
          )
          VALUES (
            gen_random_uuid()::text,
            $1,
            $2,
            $2,
            '',
            $3,
            $3,
            $4,
            TRUE,
            NOW(),
            NOW()
          )
        `,
        [workflow.id, stageName, index + 1, index === DEFAULT_WORKFLOW_STAGE_NAMES.length - 1],
      );
    }

    stageRows = await listWorkflowStageRows(workflow.id, client);
  }

  const hasValidInitialStage = Boolean(
    workflow.initial_stage_id && stageRows.some((stage) => stage.id === workflow.initial_stage_id),
  );

  if (!hasValidInitialStage && stageRows[0]) {
    workflowRecovered = true;

    const updatedWorkflowResult = await client.query(
      `
        UPDATE workflows
        SET initial_stage_id = $1,
            updated_at = NOW()
        WHERE id = $2
        RETURNING *
      `,
      [stageRows[0].id, workflow.id],
    );

    workflow = updatedWorkflowResult.rows[0] || workflow;
  }

  return {
    id: workflow.id,
    name: workflow.name,
    department_id: workflow.department_id || departmentId,
    first_stage_id: workflow.initial_stage_id || stageRows[0]?.id || null,
    stages: mapWorkflowStages(stageRows),
    workflowRecovered,
    usedFallback,
  };
}

async function ensureDefaultWorkflowsForAllDepartments(client = pool) {
  const departmentResult = await client.query(
    `
      SELECT id
      FROM departments
      WHERE COALESCE(is_active, TRUE) = TRUE
      ORDER BY name ASC, id ASC
    `,
  );

  const ensuredWorkflows = [];

  for (const department of departmentResult.rows) {
    ensuredWorkflows.push(await ensureDepartmentWorkflow(department.id, client));
  }

  return ensuredWorkflows;
}

async function getDepartmentWorkflowStagesResponse(departmentId, client = pool) {
  if (!departmentId) {
    console.warn("Workflow missing for department, using fallback");
    return {
      stages: cloneDefaultStages(),
      usedFallback: true,
      workflowRecovered: false,
    };
  }

  const workflow = await ensureDepartmentWorkflow(departmentId, client);

  if (!workflow.stages.length) {
    console.warn("Workflow missing for department, using fallback");
    return {
      stages: cloneDefaultStages(),
      usedFallback: true,
      workflowRecovered: workflow.workflowRecovered,
    };
  }

  if (workflow.usedFallback) {
    console.warn("Workflow missing for department, using fallback");
  }

  return {
    stages: workflow.stages.map((stage) => stage.name),
    usedFallback: workflow.usedFallback,
    workflowRecovered: workflow.workflowRecovered,
  };
}

module.exports = {
  DEFAULT_WORKFLOW_STAGE_NAMES,
  ensureDefaultWorkflowsForAllDepartments,
  ensureDepartmentWorkflow,
  getDepartmentWorkflowStagesResponse,
  repairOrphanDesignProjects,
  repairProjectDepartmentForFixture,
  repairProjectDepartmentForProject,
  repairProjectDepartmentForScope,
};
