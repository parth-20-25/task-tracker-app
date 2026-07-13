const { pool } = require("../db");
const {
  RELEASE_DELIVERABLE_APPLICABILITY,
  RELEASE_DELIVERABLE_CODES,
  RELEASE_DELIVERABLE_DEFINITIONS,
  RELEASE_DELIVERABLE_STATUSES,
  RELEASE_PACKAGE_STATUSES,
} = require("../lib/fixtureReleaseDeliverables");

const TWO_D_STAGE_SQL = `
  LOWER(BTRIM(REGEXP_REPLACE(COALESCE(progress.stage_name, ''), '[^[:alnum:]]+', '_', 'g'), '_'))
    IN ('2d', '2d_finish', 'two_d', 'two_d_finish')
`;

const RELEASE_STAGE_SQL = `
  LOWER(BTRIM(REGEXP_REPLACE(COALESCE(release_progress.stage_name, ''), '[^[:alnum:]]+', '_', 'g'), '_'))
    IN ('release', 'released')
`;

async function loadPackage(fixtureId, { forUpdate = false } = {}, client = pool) {
  const packageResult = await client.query(
    `
      SELECT
        package.*,
        fixture.project_id,
        fixture.fixture_no,
        fixture.is_workflow_complete,
        project.department_id,
        package_creator.name AS created_by_name
      FROM design.fixture_release_packages package
      JOIN design.fixtures fixture ON fixture.id = package.fixture_id
      JOIN design.projects project ON project.id = fixture.project_id
      LEFT JOIN public.users package_creator ON package_creator.employee_id = package.created_by
      WHERE package.fixture_id = $1
      ORDER BY package.version DESC
      LIMIT 1
      ${forUpdate ? "FOR UPDATE OF package" : ""}
    `,
    [fixtureId],
  );
  const releasePackage = packageResult.rows[0] || null;
  if (!releasePackage) {
    return null;
  }

  const deliverableResult = await client.query(
    `
      WITH event_history AS (
        SELECT
          event.deliverable_id,
          JSONB_AGG(
            JSONB_BUILD_OBJECT(
              'id', event.id,
              'event_type', event.event_type,
              'previous_status', event.previous_status,
              'new_status', event.new_status,
              'actor_id', event.actor_id,
              'actor_name', actor.name,
              'reason', event.reason,
              'metadata', event.metadata,
              'created_at', event.created_at
            )
            ORDER BY event.created_at DESC, event.id DESC
          ) AS events
        FROM design.fixture_release_deliverable_events event
        LEFT JOIN public.users actor ON actor.employee_id = event.actor_id
        WHERE event.deliverable_id IN (
          SELECT id
          FROM design.fixture_release_deliverables
          WHERE package_id = $1
        )
        GROUP BY event.deliverable_id
      )
      SELECT
        deliverable.*,
        assignee.name AS assignee_name,
        approver.name AS approved_by_name,
        COALESCE(event_history.events, '[]'::jsonb) AS events
      FROM design.fixture_release_deliverables deliverable
      LEFT JOIN public.users assignee ON assignee.employee_id = deliverable.assignee_id
      LEFT JOIN public.users approver ON approver.employee_id = deliverable.approved_by
      LEFT JOIN event_history ON event_history.deliverable_id = deliverable.id
      WHERE deliverable.package_id = $1
      ORDER BY deliverable.sequence ASC
      ${forUpdate ? "FOR UPDATE OF deliverable" : ""}
    `,
    [releasePackage.id],
  );

  return { ...releasePackage, deliverables: deliverableResult.rows };
}

async function getPackageByFixtureId(fixtureId, client = pool) {
  return loadPackage(fixtureId, {}, client);
}

async function getPackageForUpdate(fixtureId, client = pool) {
  return loadPackage(fixtureId, { forUpdate: true }, client);
}

async function ensurePackageForApproved2D({ fixtureId, createdBy = null }, client = pool) {
  if (client === pool) {
    const connection = await pool.connect();
    try {
      await connection.query("BEGIN");
      const result = await ensurePackageForApproved2D({ fixtureId, createdBy }, connection);
      await connection.query("COMMIT");
      return result;
    } catch (error) {
      await connection.query("ROLLBACK");
      throw error;
    } finally {
      connection.release();
    }
  }

  const stateResult = await client.query(
    `
      SELECT
        fixture.id AS fixture_id,
        COALESCE(fixture.is_workflow_complete, FALSE) AS is_workflow_complete,
        EXISTS (
          SELECT 1
          FROM fixture_workflow_progress progress
          WHERE progress.fixture_id = fixture.id
            AND ${TWO_D_STAGE_SQL}
            AND UPPER(COALESCE(progress.status, '')) = 'APPROVED'
        ) AS has_approved_2d,
        EXISTS (
          SELECT 1
          FROM fixture_workflow_progress release_progress
          WHERE release_progress.fixture_id = fixture.id
            AND ${RELEASE_STAGE_SQL}
            AND UPPER(COALESCE(release_progress.status, '')) = 'APPROVED'
        ) AS has_approved_release,
        latest_snapshot.captured_at AS latest_release_snapshot_at,
        latest_package.id AS latest_package_id,
        latest_package.version AS latest_package_version,
        latest_package.created_at AS latest_package_created_at,
        (
          latest_snapshot.captured_at IS NOT NULL
          AND latest_package.created_at < latest_snapshot.captured_at
        ) AS latest_package_predates_release
      FROM design.fixtures fixture
      LEFT JOIN LATERAL (
        SELECT snapshot.captured_at
        FROM design.workflow_completion_snapshots snapshot
        WHERE snapshot.fixture_id = fixture.id
          AND LOWER(BTRIM(COALESCE(snapshot.trigger, ''))) = 'workflow_release'
        ORDER BY snapshot.captured_at DESC, snapshot.id DESC
        LIMIT 1
      ) latest_snapshot ON TRUE
      LEFT JOIN LATERAL (
        SELECT release_package.id, release_package.version, release_package.created_at
        FROM design.fixture_release_packages release_package
        WHERE release_package.fixture_id = fixture.id
        ORDER BY release_package.version DESC, release_package.created_at DESC, release_package.id DESC
        LIMIT 1
      ) latest_package ON TRUE
      WHERE fixture.id = $1::uuid
      FOR UPDATE OF fixture
    `,
    [fixtureId],
  );
  const state = stateResult.rows[0] || null;
  if (!state) {
    return { package: null, created: false };
  }

  const latestPackageId = state.latest_package_id || null;
  const currentlyReleased = state.has_approved_release === true
    || (
      state.is_workflow_complete === true
      && Boolean(state.latest_release_snapshot_at)
    );
  if (state.has_approved_2d !== true || currentlyReleased) {
    return {
      package: latestPackageId ? await getPackageByFixtureId(fixtureId, client) : null,
      created: false,
    };
  }

  let targetVersion = 1;
  if (latestPackageId) {
    if (state.latest_package_predates_release !== true) {
      return {
        package: await getPackageByFixtureId(fixtureId, client),
        created: false,
      };
    }
    targetVersion = Number(state.latest_package_version) + 1;
  }

  const inserted = await client.query(
    `
      INSERT INTO design.fixture_release_packages (fixture_id, version, status, created_by)
      VALUES ($1::uuid, $2, $3, $4)
      ON CONFLICT (fixture_id, version) DO NOTHING
      RETURNING id, version
    `,
    [fixtureId, targetVersion, RELEASE_PACKAGE_STATUSES.IN_PROGRESS, createdBy],
  );

  const packageResult = inserted.rowCount > 0
    ? inserted
    : await client.query(
      `SELECT id, version FROM design.fixture_release_packages WHERE fixture_id = $1 AND version = $2 LIMIT 1`,
      [fixtureId, targetVersion],
    );
  const packageId = packageResult.rows[0]?.id || null;
  if (!packageId) {
    return { package: null, created: false };
  }

  await client.query(
    `
      INSERT INTO design.fixture_release_deliverables (
        package_id,
        deliverable_code,
        sequence,
        is_required,
        applicability_status,
        status
      )
      SELECT
        $1::uuid,
        definition.code,
        definition.sequence,
        definition.is_required,
        CASE WHEN definition.is_required THEN $3 ELSE $4 END,
        CASE WHEN definition.sequence = 1 THEN $5 ELSE $6 END
      FROM JSONB_TO_RECORDSET($2::jsonb) AS definition(code TEXT, sequence INTEGER, is_required BOOLEAN)
      ON CONFLICT (package_id, deliverable_code) DO NOTHING
    `,
    [
      packageId,
      JSON.stringify(RELEASE_DELIVERABLE_DEFINITIONS.map((definition) => ({
        code: definition.code,
        sequence: definition.sequence,
        is_required: definition.isRequired,
      }))),
      RELEASE_DELIVERABLE_APPLICABILITY.REQUIRED,
      RELEASE_DELIVERABLE_APPLICABILITY.UNRESOLVED,
      RELEASE_DELIVERABLE_STATUSES.READY,
      RELEASE_DELIVERABLE_STATUSES.LOCKED,
    ],
  );

  return {
    package: await getPackageByFixtureId(fixtureId, client),
    created: inserted.rowCount > 0,
  };
}

async function assignDeliverable(deliverableId, { assigneeId, dueAt = null }, client = pool) {
  const result = await client.query(
    `
      UPDATE design.fixture_release_deliverables
      SET assignee_id = $2,
          due_at = $3,
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [deliverableId, assigneeId, dueAt],
  );
  return result.rows[0] || null;
}

async function updateDeliverableStatus(deliverableId, status, { actorId = null, comment = null } = {}, client = pool) {
  const result = await client.query(
    `
      UPDATE design.fixture_release_deliverables
      SET status = $2,
          started_at = CASE WHEN $2 = $5 THEN COALESCE(started_at, NOW()) ELSE started_at END,
          submitted_at = CASE WHEN $2 = $6 THEN NOW() ELSE submitted_at END,
          approved_at = CASE WHEN $2 = $7 THEN NOW() WHEN $2 = $8 THEN NULL ELSE approved_at END,
          approved_by = CASE WHEN $2 = $7 THEN $3 WHEN $2 = $8 THEN NULL ELSE approved_by END,
          latest_comment = COALESCE($4, latest_comment),
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [
      deliverableId,
      status,
      actorId,
      comment,
      RELEASE_DELIVERABLE_STATUSES.IN_PROGRESS,
      RELEASE_DELIVERABLE_STATUSES.PENDING_APPROVAL,
      RELEASE_DELIVERABLE_STATUSES.APPROVED,
      RELEASE_DELIVERABLE_STATUSES.CHANGES_REQUIRED,
    ],
  );
  return result.rows[0] || null;
}

async function setMimicApplicability(deliverableId, { required, actorId, reason = null }, client = pool) {
  const applicability = required
    ? RELEASE_DELIVERABLE_APPLICABILITY.REQUIRED
    : RELEASE_DELIVERABLE_APPLICABILITY.NOT_APPLICABLE;
  const status = required
    ? RELEASE_DELIVERABLE_STATUSES.READY
    : RELEASE_DELIVERABLE_STATUSES.NOT_APPLICABLE;
  const result = await client.query(
    `
      UPDATE design.fixture_release_deliverables
      SET is_required = $2,
          applicability_status = $3,
          status = $4,
          approved_at = CASE WHEN $2 THEN NULL ELSE NOW() END,
          approved_by = CASE WHEN $2 THEN NULL ELSE $5 END,
          latest_comment = COALESCE($6, latest_comment),
          updated_at = NOW()
      WHERE id = $1
        AND deliverable_code = $7
      RETURNING *
    `,
    [deliverableId, required, applicability, status, actorId, reason, RELEASE_DELIVERABLE_CODES.MIMIC_DISPLAY],
  );
  return result.rows[0] || null;
}

async function unlockDeliverable(deliverableId, client = pool) {
  const result = await client.query(
    `
      UPDATE design.fixture_release_deliverables
      SET status = $2,
          updated_at = NOW()
      WHERE id = $1
        AND status = $3
        AND applicability_status <> $4
      RETURNING *
    `,
    [
      deliverableId,
      RELEASE_DELIVERABLE_STATUSES.READY,
      RELEASE_DELIVERABLE_STATUSES.LOCKED,
      RELEASE_DELIVERABLE_APPLICABILITY.UNRESOLVED,
    ],
  );
  return result.rows[0] || null;
}

async function refreshPackageStatus(packageId, client = pool) {
  const readinessResult = await client.query(
    `
      SELECT
        COUNT(*) = $2::integer
        AND BOOL_AND(
          CASE
            WHEN deliverable_code = $3 THEN status IN ($4, $5)
            ELSE status = $4
          END
        ) AS ready
      FROM design.fixture_release_deliverables
      WHERE package_id = $1
    `,
    [
      packageId,
      RELEASE_DELIVERABLE_DEFINITIONS.length,
      RELEASE_DELIVERABLE_CODES.MIMIC_DISPLAY,
      RELEASE_DELIVERABLE_STATUSES.APPROVED,
      RELEASE_DELIVERABLE_STATUSES.NOT_APPLICABLE,
    ],
  );
  const ready = readinessResult.rows[0]?.ready === true;
  const result = await client.query(
    `
      UPDATE design.fixture_release_packages
      SET status = $2,
          completed_at = CASE WHEN $2 = $3 THEN COALESCE(completed_at, NOW()) ELSE NULL END
      WHERE id = $1
      RETURNING *
    `,
    [
      packageId,
      ready ? RELEASE_PACKAGE_STATUSES.READY_FOR_RELEASE : RELEASE_PACKAGE_STATUSES.IN_PROGRESS,
      RELEASE_PACKAGE_STATUSES.READY_FOR_RELEASE,
    ],
  );
  return result.rows[0] || null;
}

async function insertDeliverableEvent({
  deliverableId,
  eventType,
  previousStatus = null,
  newStatus = null,
  actorId = null,
  reason = null,
  metadata = {},
}, client = pool) {
  await client.query(
    `
      INSERT INTO design.fixture_release_deliverable_events (
        deliverable_id,
        event_type,
        previous_status,
        new_status,
        actor_id,
        reason,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
    `,
    [deliverableId, eventType, previousStatus, newStatus, actorId, reason, JSON.stringify(metadata)],
  );
}

async function listUnreleasedProjectFixtures(projectId, client = pool) {
  const result = await client.query(
    `
      SELECT fixture.id AS fixture_id, fixture.fixture_no
      FROM design.fixtures fixture
      WHERE fixture.project_id = $1
        AND (
          COALESCE(fixture.is_workflow_complete, FALSE) = FALSE
          OR NOT EXISTS (
            SELECT 1
            FROM fixture_workflow_progress release_progress
            WHERE release_progress.fixture_id = fixture.id
              AND ${RELEASE_STAGE_SQL}
              AND UPPER(COALESCE(release_progress.status, '')) = 'APPROVED'
          )
        )
      ORDER BY fixture.fixture_no ASC, fixture.id ASC
    `,
    [projectId],
  );
  return result.rows;
}

module.exports = {
  assignDeliverable,
  ensurePackageForApproved2D,
  getPackageByFixtureId,
  getPackageForUpdate,
  insertDeliverableEvent,
  listUnreleasedProjectFixtures,
  refreshPackageStatus,
  setMimicApplicability,
  unlockDeliverable,
  updateDeliverableStatus,
};
