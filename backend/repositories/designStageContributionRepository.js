const { pool } = require("../db");
const { instrumentModuleExports } = require("../lib/observability");

function mapContributionRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    fixture_id: row.fixture_id,
    department_id: row.department_id,
    stage_name: row.stage_name,
    revision_code: row.revision_code,
    stage_revision_no: Number(row.stage_revision_no || 0),
    employee_id: row.employee_id,
    employee_name: row.employee_name || row.employee_id,
    contribution_percent: Number(row.contribution_percent || 0),
    contribution_kind: row.contribution_kind || "ACTUAL",
    transfer_reason: row.transfer_reason || null,
    transferred_by: row.transferred_by || null,
    transferred_by_name: row.transferred_by_name || null,
    transferred_at: row.transferred_at || null,
    changed_by: row.changed_by || null,
    changed_by_name: row.changed_by_name || null,
    changed_at: row.changed_at || null,
    previous_stage: row.previous_stage || null,
    stage_instance_id: row.stage_instance_id || null,
    stage_attempt_no: row.stage_attempt_no === null || row.stage_attempt_no === undefined
      ? null
      : Number(row.stage_attempt_no),
    workflow_revision_id: row.workflow_revision_id || null,
    superseded_by: row.superseded_by || null,
    superseded_at: row.superseded_at || null,
    metadata: row.metadata || {},
  };
}

async function listStageContributions(fixtureId, stageName, revisionCode, client = pool) {
  const result = await client.query(
    `
      SELECT
        contribution.*,
        contributor.name AS employee_name,
        transfer_actor.name AS transferred_by_name,
        changer.name AS changed_by_name
      FROM design.fixture_stage_contributions contribution
      LEFT JOIN users contributor
        ON contributor.employee_id = contribution.employee_id
      LEFT JOIN users transfer_actor
        ON transfer_actor.employee_id = contribution.transferred_by
      LEFT JOIN users changer
        ON changer.employee_id = contribution.changed_by
      WHERE contribution.fixture_id = $1
        AND contribution.stage_name = $2
        AND contribution.revision_code = $3
        AND contribution.superseded_by IS NULL
      ORDER BY
        contribution.changed_at ASC,
        contribution.transferred_at ASC NULLS LAST,
        contribution.id ASC
    `,
    [fixtureId, stageName, revisionCode],
  );

  return result.rows.map(mapContributionRow);
}

async function listContributionsForFixtures(fixtureIds, client = pool) {
  if (!Array.isArray(fixtureIds) || fixtureIds.length === 0) {
    return [];
  }

  const result = await client.query(
    `
      SELECT
        contribution.*,
        contributor.name AS employee_name,
        transfer_actor.name AS transferred_by_name,
        changer.name AS changed_by_name
      FROM design.fixture_stage_contributions contribution
      LEFT JOIN users contributor
        ON contributor.employee_id = contribution.employee_id
      LEFT JOIN users transfer_actor
        ON transfer_actor.employee_id = contribution.transferred_by
      LEFT JOIN users changer
        ON changer.employee_id = contribution.changed_by
      WHERE contribution.fixture_id = ANY($1::uuid[])
        AND contribution.superseded_by IS NULL
      ORDER BY
        contribution.fixture_id ASC,
        contribution.stage_name ASC,
        contribution.stage_revision_no ASC,
        contribution.changed_at ASC,
        contribution.id ASC
    `,
    [fixtureIds],
  );

  return result.rows.map(mapContributionRow);
}

async function insertStageContribution(contribution, client = pool) {
  const result = await client.query(
    `
      INSERT INTO design.fixture_stage_contributions (
        fixture_id,
        department_id,
        stage_name,
        revision_code,
        stage_revision_no,
        employee_id,
        contribution_percent,
        contribution_kind,
        transfer_reason,
        transferred_by,
        transferred_at,
        changed_by,
        changed_at,
        previous_stage,
        stage_instance_id,
        stage_attempt_no,
        workflow_revision_id,
        metadata
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7::numeric, $8, $9, $10,
        COALESCE($11::timestamptz, NOW()), $12, COALESCE($13::timestamptz, NOW()),
        $14, $15::uuid, $16::integer, $17::uuid, $18::jsonb
      )
      RETURNING *
    `,
    [
      contribution.fixture_id,
      contribution.department_id,
      contribution.stage_name,
      contribution.revision_code,
      Number(contribution.stage_revision_no || 0),
      contribution.employee_id,
      Number(contribution.contribution_percent || 0),
      contribution.contribution_kind || "ACTUAL",
      contribution.transfer_reason || null,
      contribution.transferred_by || null,
      contribution.transferred_at || null,
      contribution.changed_by,
      contribution.changed_at || null,
      contribution.previous_stage || null,
      contribution.stage_instance_id || null,
      contribution.stage_attempt_no ?? null,
      contribution.workflow_revision_id || null,
      JSON.stringify(contribution.metadata || {}),
    ],
  );

  return mapContributionRow(result.rows[0]);
}

async function supersedeContribution(contributionId, supersededById, client = pool) {
  await client.query(
    `
      UPDATE design.fixture_stage_contributions
      SET superseded_by = COALESCE($2::uuid, $1::uuid),
          superseded_at = NOW()
      WHERE id = $1::uuid
    `,
    [contributionId, supersededById],
  );
}

async function markRemainingContributionActual(contributionId, client = pool) {
  await client.query(
    `
      UPDATE design.fixture_stage_contributions
      SET contribution_kind = 'ACTUAL',
          changed_at = NOW()
      WHERE id = $1::uuid
        AND contribution_kind = 'REMAINING'
        AND superseded_by IS NULL
    `,
    [contributionId],
  );
}

module.exports = instrumentModuleExports("repository.designStageContributionRepository", {
  insertStageContribution,
  listContributionsForFixtures,
  listStageContributions,
  markRemainingContributionActual,
  supersedeContribution,
});
