const { pool } = require("../db");
const { instrumentModuleExports } = require("../lib/observability");
const { AppError } = require("../lib/AppError");
const {
  buildVisibleUsersCte,
  visibleFixturePredicate,
  visibleProjectPredicate,
} = require("./projectVisibility");

const DEPARTMENT_PROJECT_SELECT = `
  SELECT
    p.id AS project_id,
    p.project_no,
    COALESCE(NULLIF(BTRIM(p.project_name), ''), p.project_no) AS project_name,
    p.customer_name,
    p.project_name AS project_description,
    COALESCE(fixture_stats.fixture_count, 0)::integer AS instance_count,
    NULL::text AS quantity_index,
    NULL::date AS rework_date,
    p.department_id,
    p.uploaded_by,
    p.created_at,
    p.updated_at
  FROM design.projects p
  LEFT JOIN (
    SELECT
      project_id,
      COUNT(*)::integer AS fixture_count
    FROM design.fixtures
    GROUP BY project_id
  ) fixture_stats
    ON fixture_stats.project_id = p.id
`;

function mapDepartmentProjectRow(row) {
  if (!row) {
    return null;
  }

  return {
    project_id: row.project_id || row.id || null,
    project_code: row.project_no,
    project_name: row.project_name,
    company_name: row.customer_name,
    project_description: row.project_description,
    quantity_index: row.quantity_index,
    instance_count: row.instance_count === null || row.instance_count === undefined
      ? 0
      : Number(row.instance_count),
    rework_date: row.rework_date || null,
    department_id: row.department_id,
    uploaded_by: row.uploaded_by || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapDesignProjectRow(row) {
  if (!row) {
    return null;
  }

  return {
    project_id: row.project_id || row.id,
    project_code: row.project_no,
    project_name: row.project_name,
    company_name: row.customer_name,
    department_id: row.department_id,
    uploaded_by: row.uploaded_by || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapProjectOptionRow(row) {
  if (!row) {
    return null;
  }

  return {
    project_id: row.project_id || row.id,
    project_code: row.project_no,
    project_name: row.project_name,
    company_name: row.customer_name,
    department_id: row.department_id,
  };
}

function mapFixtureOptionRow(row) {
  if (!row) {
    return null;
  }

  return {
    fixture_id: row.fixture_id || row.id,
    project_id: row.project_id || null,
    batch_id: row.batch_id || null,
    fixture_no: row.fixture_no,
    op_no: row.op_no,
    part_name: row.part_name,
    fixture_type: row.fixture_type,
    remark: row.remark || null,
    qty: Number(row.qty),
    image_1_url: row.image_1_url || null,
    image_2_url: row.image_2_url || null,
    ingestion_source: row.ingestion_source || null,
    revision_no: Number(row.revision_no || 0),
    is_legacy_workflow: row.is_legacy_workflow === true,
  };
}

function requireRow(result, errorMessage) {
  const row = result?.rows?.[0];

  if (!row) {
    throw new Error(errorMessage);
  }

  return row;
}

async function listProjectOptionsByDepartment(departmentId, client = pool) {
  const result = await client.query(
    `
      SELECT
        p.id AS project_id,
        p.project_no,
        COALESCE(NULLIF(BTRIM(p.project_name), ''), p.project_no) AS project_name,
        p.customer_name,
        p.department_id
      FROM design.projects p
      WHERE p.department_id = $1
      ORDER BY p.updated_at DESC, p.created_at DESC, p.project_no ASC
    `,
    [departmentId],
  );

  return result.rows.map(mapProjectOptionRow);
}

async function listProjectOptionsForUser(user, departmentId, client = pool) {
  const result = await client.query(
    `
      ${buildVisibleUsersCte("$1")}
      SELECT
        p.id AS project_id,
        p.project_no,
        COALESCE(NULLIF(BTRIM(p.project_name), ''), p.project_no) AS project_name,
        p.customer_name,
        p.department_id
      FROM design.projects p
      WHERE p.department_id = $2
        AND ${visibleProjectPredicate("p")}
      ORDER BY p.updated_at DESC, p.created_at DESC, p.project_no ASC
    `,
    [user.employee_id, departmentId],
  );

  return result.rows.map(mapProjectOptionRow);
}

async function countProjectsByDepartment(departmentId, client = pool) {
  const result = await client.query(
    `
      SELECT COUNT(*)::integer AS count
      FROM design.projects
      WHERE department_id = $1
    `,
    [departmentId],
  );

  return Number(result.rows[0]?.count || 0);
}

async function findProjectByIdForDepartment(projectId, departmentId, client = pool) {
  const result = await client.query(
    `
      SELECT
        id AS project_id,
        project_no,
        COALESCE(NULLIF(BTRIM(project_name), ''), project_no) AS project_name,
        customer_name,
        department_id
      FROM design.projects
      WHERE id = $1
        AND department_id = $2
      LIMIT 1
    `,
    [projectId, departmentId],
  );

  return mapProjectOptionRow(result.rows[0]);
}

async function findProjectByIdForUser(projectId, user, departmentId, client = pool) {
  const result = await client.query(
    `
      ${buildVisibleUsersCte("$1")}
      SELECT
        p.id AS project_id,
        p.project_no,
        COALESCE(NULLIF(BTRIM(p.project_name), ''), p.project_no) AS project_name,
        p.customer_name,
        p.department_id
      FROM design.projects p
      WHERE p.id = $2
        AND p.department_id = $3
        AND ${visibleProjectPredicate("p")}
      LIMIT 1
    `,
    [user.employee_id, projectId, departmentId],
  );

  return mapProjectOptionRow(result.rows[0]);
}

async function findProjectByNumberForDepartment(projectNo, departmentId, client = pool) {
  const result = await client.query(
    `
      SELECT
        id AS project_id,
        project_no,
        project_name,
        customer_name,
        department_id,
        uploaded_by,
        created_at,
        updated_at
      FROM design.projects
      WHERE project_no = $1
        AND department_id = $2
      LIMIT 1
    `,
    [projectNo, departmentId],
  );

  return mapDesignProjectRow(result.rows[0]);
}

async function listDepartmentProjectsByDepartment(departmentId, client = pool) {
  const result = await client.query(
    `
      ${DEPARTMENT_PROJECT_SELECT}
      WHERE p.department_id = $1
      ORDER BY p.updated_at DESC, p.created_at DESC, p.project_no ASC
    `,
    [departmentId],
  );

  return result.rows.map(mapDepartmentProjectRow);
}

async function listDepartmentProjectsForUser(user, departmentId, client = pool) {
  const result = await client.query(
    `
      ${buildVisibleUsersCte("$1")}
      SELECT
        p.id AS project_id,
        p.project_no,
        COALESCE(NULLIF(BTRIM(p.project_name), ''), p.project_no) AS project_name,
        p.customer_name,
        p.project_name AS project_description,
        (
          SELECT COUNT(*)::integer
          FROM design.fixtures visible_fixture
          WHERE visible_fixture.project_id = p.id
            AND ${visibleFixturePredicate("visible_fixture", "p")}
        ) AS instance_count,
        NULL::text AS quantity_index,
        NULL::date AS rework_date,
        p.department_id,
        p.uploaded_by,
        p.created_at,
        p.updated_at
      FROM design.projects p
      WHERE p.department_id = $2
        AND ${visibleProjectPredicate("p")}
      ORDER BY p.updated_at DESC, p.created_at DESC, p.project_no ASC
    `,
    [user.employee_id, departmentId],
  );

  return result.rows.map(mapDepartmentProjectRow);
}

async function findDepartmentProjectByIdForDepartment(projectId, departmentId, client = pool) {
  const result = await client.query(
    `
      ${DEPARTMENT_PROJECT_SELECT}
      WHERE p.id = $1
        AND p.department_id = $2
      LIMIT 1
    `,
    [projectId, departmentId],
  );

  return mapDepartmentProjectRow(result.rows[0]);
}

async function upsertProjectByNumber(project, client = pool) {
  const insertedProject = await client.query(
    `
      INSERT INTO design.projects (
        project_no,
        project_name,
        customer_name,
        department_id,
        uploaded_by,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
      ON CONFLICT (project_no, department_id) DO UPDATE
      SET project_name = EXCLUDED.project_name,
          customer_name = EXCLUDED.customer_name,
          uploaded_by = EXCLUDED.uploaded_by,
          updated_at = NOW()
      RETURNING
        id AS project_id,
        project_no,
        project_name,
        customer_name,
        department_id,
        uploaded_by,
        created_at,
        updated_at
    `,
    [
      project.project_no,
      project.project_name,
      project.customer_name,
      project.department_id,
      project.uploaded_by || null,
    ],
  );

  return mapDesignProjectRow(insertedProject.rows[0]);
}

async function listFixturesByProjectForDepartment(projectId, departmentId, client = pool) {
  const result = await client.query(
    `
      SELECT
        di.id AS fixture_id,
        di.project_id,
        di.batch_id,
        di.fixture_no,
        di.op_no,
        di.part_name,
        di.fixture_type,
        di.remark,
        di.qty,
        di.image_1_url,
        di.image_2_url,
        di.ingestion_source
      FROM design.fixtures di
      JOIN design.projects dp
        ON dp.id = di.project_id
      WHERE dp.id = $1
        AND dp.department_id = $2
        AND di.is_workflow_complete = FALSE
      ORDER BY di.fixture_no ASC, di.id ASC
    `,
    [projectId, departmentId],
  );

  return result.rows.map(mapFixtureOptionRow);
}

async function listFixturesByProjectForUser(projectId, user, departmentId, client = pool) {
  const result = await client.query(
    `
      ${buildVisibleUsersCte("$1")}
      SELECT
        di.id AS fixture_id,
        di.project_id,
        di.batch_id,
        di.fixture_no,
        di.op_no,
        di.part_name,
        di.fixture_type,
        di.remark,
        di.qty,
        di.image_1_url,
        di.image_2_url,
        di.ingestion_source
      FROM design.fixtures di
      JOIN design.projects dp
        ON dp.id = di.project_id
      WHERE dp.id = $2
        AND dp.department_id = $3
        AND di.is_workflow_complete = FALSE
        AND ${visibleFixturePredicate("di", "dp")}
      ORDER BY di.fixture_no ASC, di.id ASC
    `,
    [user.employee_id, projectId, departmentId],
  );

  return result.rows.map(mapFixtureOptionRow);
}

async function findFixtureByIdForDepartment(fixtureId, departmentId, client = pool) {
  const result = await client.query(
    `
      SELECT
        di.id AS fixture_id,
        di.project_id,
        di.batch_id,
        di.fixture_no,
        di.op_no,
        di.part_name,
        di.fixture_type,
        di.remark,
        di.qty,
        di.image_1_url,
        di.image_2_url,
        di.ingestion_source
      FROM design.fixtures di
      JOIN design.projects dp
        ON dp.id = di.project_id
      WHERE di.id = $1
        AND dp.department_id = $2
      LIMIT 1
    `,
    [fixtureId, departmentId],
  );

  return mapFixtureOptionRow(result.rows[0]);
}

async function findFixtureByIdForUser(fixtureId, user, departmentId, client = pool) {
  const result = await client.query(
    `
      ${buildVisibleUsersCte("$1")}
      SELECT
        di.id AS fixture_id,
        di.project_id,
        di.batch_id,
        di.fixture_no,
        di.op_no,
        di.part_name,
        di.fixture_type,
        di.remark,
        di.qty,
        di.image_1_url,
        di.image_2_url,
        di.ingestion_source
      FROM design.fixtures di
      JOIN design.projects dp
        ON dp.id = di.project_id
      WHERE di.id = $2
        AND dp.department_id = $3
        AND ${visibleFixturePredicate("di", "dp")}
      LIMIT 1
    `,
    [user.employee_id, fixtureId, departmentId],
  );

  return mapFixtureOptionRow(result.rows[0]);
}

async function touchProject(projectId, client = pool) {
  await client.query(
    `
      UPDATE design.projects
      SET updated_at = NOW()
      WHERE id = $1
    `,
    [projectId],
  );
}

async function createUploadBatch(batchData, client = pool) {
  const result = await client.query(
    `
      INSERT INTO design.upload_batches (
        project_id,
        uploaded_by,
        uploaded_by_user_id,
        total_rows,
        accepted_rows,
        rejected_rows
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
    `,
    [
      batchData.project_id,
      batchData.uploaded_by,
      batchData.uploaded_by_user_id || batchData.uploaded_by || null,
      batchData.total_rows,
      batchData.accepted_rows,
      batchData.rejected_rows,
    ],
  );

  return requireRow(result, "Upload batch insert did not return an id").id;
}

async function createUploadErrors(batchId, errors, client = pool) {
  if (!errors || errors.length === 0) {
    return;
  }

  for (const error of errors) {
    await client.query(
      `
        INSERT INTO design.upload_errors (batch_id, row_number, excel_row, row_reference, error_message, raw_data)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb)
      `,
      [
        batchId,
        error.row_number,
        error.excel_row || null,
        error.row_reference || null,
        error.error_message,
        error.raw_data ? JSON.stringify(error.raw_data) : null,
      ],
    );
  }
}

async function createUploadRowCorrections(batchId, corrections, client = pool) {
  if (!Array.isArray(corrections) || corrections.length === 0) {
    return;
  }

  for (const correction of corrections) {
    await client.query(
      `
        INSERT INTO design.upload_row_corrections (
          batch_id,
          row_reference,
          row_number,
          excel_row,
          correction_reason,
          correction_result,
          original_data,
          corrected_data,
          corrected_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9)
      `,
      [
        batchId,
        correction.row_reference,
        correction.row_number || null,
        correction.excel_row || null,
        correction.correction_reason || null,
        correction.correction_result || "accepted",
        JSON.stringify(correction.original_data || {}),
        JSON.stringify(correction.corrected_data || {}),
        correction.corrected_by,
      ],
    );
  }
}

async function findFixturesByProjectForDedupe(projectId, client = pool) {
  const result = await client.query(
    `
      SELECT
        id AS fixture_id,
        project_id,
        batch_id,
        fixture_no,
        op_no,
        part_name,
        fixture_type,
        remark,
        qty,
        image_1_url,
        image_2_url,
        ingestion_source,
        revision_no,
        is_legacy_workflow
      FROM design.fixtures
      WHERE project_id = $1
    `,
    [projectId],
  );

  return result.rows.map(mapFixtureOptionRow);
}

async function listFixturesByUploadBatchForDepartment(batchId, departmentId, client = pool) {
  const result = await client.query(
    `
      SELECT
        di.id AS fixture_id,
        di.fixture_no,
        di.image_1_url,
        di.image_2_url,
        di.ingestion_source,
        di.revision_no,
        di.is_legacy_workflow
      FROM design.fixtures di
      JOIN design.upload_batches ub
        ON ub.id = di.batch_id
      JOIN design.projects dp
        ON dp.id = di.project_id
      WHERE ub.id = $1
        AND dp.department_id = $2
      ORDER BY di.fixture_no ASC, di.id ASC
    `,
    [batchId, departmentId],
  );

  return result.rows.map((row) => ({
    fixture_id: row.fixture_id,
    fixture_no: row.fixture_no,
    image_1_url: row.image_1_url || null,
    image_2_url: row.image_2_url || null,
    ingestion_source: row.ingestion_source || null,
  }));
}

async function listFixturesByUploadBatchForUser(batchId, user, departmentId, client = pool) {
  const result = await client.query(
    `
      ${buildVisibleUsersCte("$1")}
      SELECT
        di.id AS fixture_id,
        di.fixture_no,
        di.image_1_url,
        di.image_2_url,
        di.ingestion_source,
        di.revision_no,
        di.is_legacy_workflow
      FROM design.fixtures di
      JOIN design.upload_batches ub
        ON ub.id = di.batch_id
      JOIN design.projects dp
        ON dp.id = di.project_id
      WHERE ub.id = $2
        AND dp.department_id = $3
        AND ${visibleFixturePredicate("di", "dp")}
      ORDER BY di.fixture_no ASC, di.id ASC
    `,
    [user.employee_id, batchId, departmentId],
  );

  return result.rows.map((row) => ({
    fixture_id: row.fixture_id,
    fixture_no: row.fixture_no,
    image_1_url: row.image_1_url || null,
    image_2_url: row.image_2_url || null,
    ingestion_source: row.ingestion_source || null,
  }));
}

async function updateFixtureReferenceImageForDepartment({
  fixtureId,
  departmentId,
  imageType,
  imageUrl,
}, client = pool) {
  const resolvedColumn =
    imageType === "part" ? "image_1_url"
      : imageType === "fixture" ? "image_2_url"
        : null;

  if (!resolvedColumn) {
    throw new AppError(400, "Invalid image_type. Expected 'part' or 'fixture'");
  }

  const selectResult = await client.query(
    `
      SELECT
        di.fixture_no,
        di.${resolvedColumn} AS previous_image_url
      FROM design.fixtures di
      JOIN design.projects dp
        ON dp.id = di.project_id
      WHERE di.id = $1
        AND dp.department_id = $2
      LIMIT 1
    `,
    [fixtureId, departmentId],
  );

  if (!selectResult.rows[0]) {
    throw new AppError(404, "Fixture not found");
  }

  const previousImageUrl = selectResult.rows[0].previous_image_url || null;
  const fixtureNo = selectResult.rows[0].fixture_no;

  await client.query(
    `
      UPDATE design.fixtures
      SET ${resolvedColumn} = $1,
          updated_at = NOW()
      WHERE id = $2
    `,
    [imageUrl, fixtureId],
  );

  return {
    fixture_no: fixtureNo,
    previous_image_url: previousImageUrl,
    new_image_url: imageUrl,
  };
}

async function upsertFixture(fixtureData, client = pool) {
  const result = await client.query(
    `
      INSERT INTO design.fixtures (
        project_id,
        fixture_no,
        op_no,
        part_name,
        fixture_type,
        remark,
        qty,
        image_1_url,
        image_2_url,
        ingestion_source,
        batch_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (project_id, fixture_no) DO UPDATE
      SET
        project_id = EXCLUDED.project_id,
        op_no = EXCLUDED.op_no,
        part_name = EXCLUDED.part_name,
        fixture_type = EXCLUDED.fixture_type,
        remark = EXCLUDED.remark,
        qty = EXCLUDED.qty,
        image_1_url = EXCLUDED.image_1_url,
        image_2_url = EXCLUDED.image_2_url,
        ingestion_source = EXCLUDED.ingestion_source,
        batch_id = EXCLUDED.batch_id,
        updated_at = NOW()
      RETURNING
        id AS fixture_id,
        project_id,
        batch_id,
        fixture_no,
        op_no,
        part_name,
        fixture_type,
        remark,
        qty,
        image_1_url,
        image_2_url,
        ingestion_source,
        revision_no,
        is_legacy_workflow
    `,
    [
      fixtureData.project_id,
      fixtureData.fixture_no,
      fixtureData.op_no,
      fixtureData.part_name,
      fixtureData.fixture_type,
      fixtureData.remark || null,
      fixtureData.qty,
      fixtureData.image_1_url || null,
      fixtureData.image_2_url || null,
      fixtureData.ingestion_source || null,
      fixtureData.batch_id || null,
    ],
  );

  return mapFixtureOptionRow(result.rows[0]);
}

module.exports = instrumentModuleExports("repository.designProjectCatalogRepository", {
  countProjectsByDepartment,
  createUploadBatch,
  createUploadErrors,
  createUploadRowCorrections,
  findDepartmentProjectByIdForDepartment,
  findFixtureByIdForDepartment,
  findFixtureByIdForUser,
  findFixturesByProjectForDedupe,
  findProjectByIdForDepartment,
  findProjectByIdForUser,
  findProjectByNumberForDepartment,
  listDepartmentProjectsByDepartment,
  listDepartmentProjectsForUser,
  listFixturesByProjectForDepartment,
  listFixturesByProjectForUser,
  listFixturesByUploadBatchForDepartment,
  listFixturesByUploadBatchForUser,
  listProjectOptionsByDepartment,
  listProjectOptionsForUser,
  touchProject,
  updateFixtureReferenceImageForDepartment,
  upsertFixture,
  upsertProjectByNumber,
});
