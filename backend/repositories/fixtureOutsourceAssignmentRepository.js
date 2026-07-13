const { PERMISSIONS } = require("../config/constants");
const { pool } = require("../db");
const {
  OUTSOURCE_ASSIGNMENT_STATUSES,
} = require("../lib/fixtureOutsourceAssignments");
const {
  buildVisibleUsersCte,
  projectAuthoritySqlPredicate,
  visibleProjectPredicate,
} = require("./projectVisibility");
const {
  assignedTo2DTeamProjectSql,
} = require("./projectSubdivisionRoutingRepository");

function stageKeySql(expression) {
  const sanitized = `LOWER(BTRIM(REGEXP_REPLACE(COALESCE(${expression}, ''), '[^[:alnum:]]+', '_', 'g'), '_'))`;
  return `(CASE
    WHEN ${sanitized} IN ('concept', 'concept_stage') THEN 'concept'
    WHEN ${sanitized} IN ('dap', 'd_a_p') THEN 'dap'
    WHEN ${sanitized} IN ('3d', '3d_finish', 'three_d', 'three_d_finish') THEN '3d_finish'
    WHEN ${sanitized} IN ('2d', '2d_finish', 'two_d', 'two_d_finish') THEN '2d_finish'
    WHEN ${sanitized} IN ('detailing', 'detail', 'det') THEN 'detailing'
    WHEN ${sanitized} IN ('release', 'released') THEN 'release'
    ELSE ${sanitized}
  END)`;
}

function actorIdentifier(actor) {
  return String(actor?.employee_id || actor?.id || "").trim();
}

function mapAssignmentRow(row) {
  if (!row) {
    return null;
  }

  return {
    ...row,
    workflow_stage_version: Number(row.workflow_stage_version || 0),
    fixture_qty: row.fixture_qty == null ? undefined : Number(row.fixture_qty),
    events: Array.isArray(row.events) ? row.events : [],
  };
}

async function findVisibleProjectForOutsource(actor, projectId, client = pool, { lock = false } = {}) {
  const result = await client.query(
    `
      ${buildVisibleUsersCte("$1")}
      SELECT
        p.id AS project_id,
        p.project_no AS project_code,
        p.project_name,
        p.customer_name,
        p.department_id,
        p.status AS project_status
      FROM design.projects p
      WHERE p.id::text = $2
        AND ${visibleProjectPredicate("p")}
      LIMIT 1
      ${lock ? "FOR UPDATE OF p" : ""}
    `,
    [actorIdentifier(actor), projectId],
  );

  return result.rows[0] || null;
}

async function listVendors({ includeInactive = false } = {}, client = pool) {
  const result = await client.query(
    `
      SELECT
        id,
        name,
        code,
        contact_name,
        contact_email,
        contact_phone,
        is_active,
        created_at,
        updated_at
      FROM design.vendors
      WHERE $1::boolean = TRUE OR is_active = TRUE
      ORDER BY is_active DESC, LOWER(name), id
    `,
    [includeInactive === true],
  );

  return result.rows;
}

async function createVendor(vendor, actorId, client = pool) {
  const result = await client.query(
    `
      INSERT INTO design.vendors (
        name,
        code,
        contact_name,
        contact_email,
        contact_phone,
        created_by
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `,
    [
      vendor.name,
      vendor.code,
      vendor.contact_name,
      vendor.contact_email,
      vendor.contact_phone,
      actorId,
    ],
  );

  return result.rows[0];
}

async function findVendorById(vendorId, client = pool, { activeOnly = true } = {}) {
  const result = await client.query(
    `
      SELECT *
      FROM design.vendors
      WHERE id = $1::uuid
        AND ($2::boolean = FALSE OR is_active = TRUE)
      LIMIT 1
    `,
    [vendorId, activeOnly === true],
  );

  return result.rows[0] || null;
}

async function findCoordinatorForOutsourceScope({
  actor,
  projectId,
  coordinatorId,
  workflowStageCode,
}, client = pool) {
  const is2DStage = ["2d", "2d_finish", "two_d", "two_d_finish"].includes(workflowStageCode);
  const result = await client.query(
    `
      ${buildVisibleUsersCte("$1")}
      SELECT
        candidate.employee_id,
        candidate.name,
        candidate.department_id,
        candidate.subdivision_id
      FROM design.projects p
      JOIN users candidate
        ON candidate.employee_id = $3
       AND candidate.department_id = p.department_id
       AND COALESCE(candidate.is_active, TRUE) = TRUE
       AND EXISTS (
         SELECT 1
         FROM role_permissions coordinator_permission
         WHERE coordinator_permission.role_id = candidate.role
           AND coordinator_permission.permission_id = $5
       )
      WHERE p.id::text = $2
        AND ${visibleProjectPredicate("p")}
        AND (
          EXISTS (
            SELECT 1
            FROM root_user root
            WHERE ${projectAuthoritySqlPredicate("root")}
          )
          OR EXISTS (
            SELECT 1
            FROM visible_users visible
            WHERE visible.employee_id = candidate.employee_id
          )
        )
        AND (
          $4::boolean = FALSE
          OR NOT EXISTS (
            SELECT 1
            FROM design.project_subdivision_assignments routing
            JOIN department_subdivisions subdivision
              ON subdivision.id = routing.subdivision_id
            WHERE routing.project_id = p.id
              AND routing.is_active = TRUE
              AND subdivision.is_active = TRUE
              AND LOWER(BTRIM(subdivision.subdivision_name)) = '2d'
          )
          OR ${assignedTo2DTeamProjectSql("p", "candidate.employee_id")}
        )
      LIMIT 1
    `,
    [
      actorIdentifier(actor),
      projectId,
      coordinatorId,
      is2DStage,
      PERMISSIONS.DESIGN_FIXTURE_OUTSOURCE_REVIEW,
    ],
  );

  return result.rows[0] || null;
}

function scopeQuery() {
  return `
    ${buildVisibleUsersCte("$1")}
    SELECT
      fixture.id AS fixture_id,
      fixture.fixture_no,
      fixture.qty AS fixture_qty,
      fixture.is_workflow_complete,
      fixture.removed_from_latest_ingestion,
      fixture.project_id,
      project.project_no AS project_code,
      project.project_name,
      project.customer_name,
      project.department_id,
      project.status AS project_status,
      TRUE AS fixture_belongs_to_project,
      progress.id AS progress_id,
      progress.stage_name AS workflow_stage_name,
      progress.stage_order AS workflow_stage_order,
      COALESCE(progress.stage_version, 0) AS workflow_stage_version,
      progress.status AS progress_status,
      progress.assigned_to,
      progress.started_at,
      (progress.id IS NOT NULL) AS stage_exists,
      (
        progress.id IS NOT NULL
        AND progress.status IN ('PENDING', 'REJECTED')
        AND $3 <> 'release'
      ) AS stage_assignable,
      (
        progress.id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM fixture_workflow_progress prerequisite
          WHERE prerequisite.fixture_id = fixture.id
            AND prerequisite.department_id = project.department_id
            AND prerequisite.stage_order < progress.stage_order
            AND prerequisite.status <> 'APPROVED'
        )
      ) AS prerequisites_complete,
      (
        EXISTS (
          SELECT 1
          FROM design.fixture_outsource_assignments active_outsource
          WHERE active_outsource.fixture_id = fixture.id
            AND active_outsource.workflow_stage_code = $3
            AND active_outsource.workflow_stage_version = COALESCE(progress.stage_version, 0)
            AND active_outsource.status <> 'CANCELLED'
        )
        OR EXISTS (
          SELECT 1
          FROM design.fixture_outsource_records legacy_outsource
          WHERE legacy_outsource.fixture_id = fixture.id
            AND legacy_outsource.outsource_status = 'outsourced'
            AND EXISTS (
              SELECT 1
              FROM UNNEST(legacy_outsource.outsourced_stages) legacy_stage(stage_name)
              WHERE ${stageKeySql("legacy_stage.stage_name")} = $3
            )
        )
      ) AS already_outsourced,
      (
        NULLIF(BTRIM(COALESCE(progress.assigned_to, '')), '') IS NOT NULL
        OR progress.status IN ('IN_PROGRESS', 'SUBMITTED_FOR_VERIFICATION')
        OR EXISTS (
          SELECT 1
          FROM tasks task
          WHERE task.fixture_id = fixture.id
            AND task.department_id = project.department_id
            AND ${stageKeySql("task.stage")} = $3
            AND NULLIF(BTRIM(COALESCE(NULLIF(BTRIM(task.assigned_to), ''), NULLIF(BTRIM(task.assigned_user_id), ''), '')), '') IS NOT NULL
            AND LOWER(BTRIM(COALESCE(task.lifecycle_status, task.status, ''))) NOT IN (
              'closed',
              'cancelled',
              'approved',
              'completed'
            )
        )
      ) AS internally_assigned
    FROM design.fixtures fixture
    JOIN design.projects project
      ON project.id = fixture.project_id
    LEFT JOIN LATERAL (
      SELECT selected_progress.*
      FROM fixture_workflow_progress selected_progress
      WHERE selected_progress.fixture_id = fixture.id
        AND selected_progress.department_id = project.department_id
        AND ${stageKeySql("selected_progress.stage_name")} = $3
      ORDER BY selected_progress.stage_order, selected_progress.id
      LIMIT 1
    ) progress ON TRUE
    WHERE project.id = $2::uuid
      AND ${visibleProjectPredicate("project")}
      AND (
        $4 = 'all_assignable'
        OR fixture.id = ANY($5::uuid[])
      )
    ORDER BY fixture.fixture_no, fixture.id
  `;
}

async function resolveFixtureOutsourceScope({
  actor,
  projectId,
  workflowStageCode,
  scope,
  fixtureIds = [],
  lock = false,
}, client = pool) {
  const params = [
    actorIdentifier(actor),
    projectId,
    workflowStageCode,
    scope,
    fixtureIds,
  ];
  let result = await client.query(scopeQuery(), params);

  if (lock) {
    const progressIds = result.rows.map((row) => row.progress_id).filter(Boolean);
    if (progressIds.length > 0) {
      await client.query(
        `
          SELECT id
          FROM fixture_workflow_progress
          WHERE id = ANY($1::uuid[])
          ORDER BY id
          FOR UPDATE
        `,
        [progressIds],
      );
      result = await client.query(scopeQuery(), params);
    }
  }

  return result.rows;
}

async function insertFixtureOutsourceAssignments(rows, assignment, client = pool) {
  if (rows.length === 0) {
    return [];
  }

  const payload = rows.map((row) => ({
    fixture_id: row.fixture_id,
    workflow_stage_code: assignment.workflow_stage,
    workflow_stage_name: row.workflow_stage_name,
    workflow_stage_version: row.workflow_stage_version,
    source_internal_task_ids: row.source_internal_task_ids || [],
  }));
  const result = await client.query(
    `
      INSERT INTO design.fixture_outsource_assignments (
        fixture_id,
        workflow_stage_code,
        workflow_stage_name,
        workflow_stage_version,
        vendor_id,
        internal_coordinator_id,
        deadline,
        priority,
        status,
        instructions,
        expected_deliverables,
        work_order_reference,
        reference_path,
        outsourced_by,
        outsourced_at,
        conversion_reason,
        source_internal_task_ids
      )
      SELECT
        input.fixture_id,
        input.workflow_stage_code,
        input.workflow_stage_name,
        input.workflow_stage_version,
        $2::uuid,
        $3,
        $4::timestamptz,
        $5,
        'OUTSOURCED',
        $6,
        $7,
        $8,
        $9,
        $10,
        NOW(),
        $11,
        input.source_internal_task_ids
      FROM jsonb_to_recordset($1::jsonb) AS input (
        fixture_id UUID,
        workflow_stage_code TEXT,
        workflow_stage_name TEXT,
        workflow_stage_version INTEGER,
        source_internal_task_ids JSONB
      )
      ON CONFLICT (
        fixture_id,
        workflow_stage_code,
        workflow_stage_version
      ) WHERE status <> 'CANCELLED'
      DO NOTHING
      RETURNING *
    `,
    [
      JSON.stringify(payload),
      assignment.vendor_id,
      assignment.internal_coordinator_id,
      assignment.deadline,
      assignment.priority,
      assignment.instructions,
      assignment.expected_deliverables,
      assignment.work_order_reference,
      assignment.reference_path,
      assignment.outsourced_by,
      assignment.conversion_reason || null,
    ],
  );

  return result.rows.map(mapAssignmentRow);
}

async function insertFixtureOutsourceAssignmentEvents(events, client = pool) {
  if (events.length === 0) {
    return;
  }

  await client.query(
    `
      INSERT INTO design.fixture_outsource_assignment_events (
        assignment_id,
        event_type,
        previous_status,
        new_status,
        actor_id,
        reason,
        metadata
      )
      SELECT
        event.assignment_id,
        event.event_type,
        event.previous_status,
        event.new_status,
        event.actor_id,
        event.reason,
        event.metadata
      FROM jsonb_to_recordset($1::jsonb) AS event (
        assignment_id UUID,
        event_type TEXT,
        previous_status TEXT,
        new_status TEXT,
        actor_id VARCHAR(50),
        reason TEXT,
        metadata JSONB
      )
    `,
    [JSON.stringify(events)],
  );
}

async function listProjectFixtureOutsourceAssignments(actor, projectId, client = pool) {
  const result = await client.query(
    `
      ${buildVisibleUsersCte("$1")}
      SELECT
        assignment.*,
        fixture.fixture_no,
        fixture.qty AS fixture_qty,
        project.id AS project_id,
        project.project_no AS project_code,
        project.project_name,
        vendor.name AS vendor_name,
        vendor.code AS vendor_code,
        coordinator.name AS internal_coordinator_name,
        progress.status AS official_stage_status,
        COALESCE(history.events, '[]'::jsonb) AS events
      FROM design.fixture_outsource_assignments assignment
      JOIN design.fixtures fixture
        ON fixture.id = assignment.fixture_id
      JOIN design.projects project
        ON project.id = fixture.project_id
      JOIN design.vendors vendor
        ON vendor.id = assignment.vendor_id
      LEFT JOIN users coordinator
        ON coordinator.employee_id = assignment.internal_coordinator_id
      LEFT JOIN fixture_workflow_progress progress
        ON progress.fixture_id = assignment.fixture_id
       AND progress.department_id = project.department_id
       AND ${stageKeySql("progress.stage_name")} = assignment.workflow_stage_code
       AND COALESCE(progress.stage_version, 0) = assignment.workflow_stage_version
      LEFT JOIN LATERAL (
        SELECT JSONB_AGG(
          JSONB_BUILD_OBJECT(
            'id', event.id,
            'event_type', event.event_type,
            'previous_status', event.previous_status,
            'new_status', event.new_status,
            'actor_id', event.actor_id,
            'reason', event.reason,
            'metadata', event.metadata,
            'created_at', event.created_at
          )
          ORDER BY event.created_at DESC, event.id DESC
        ) AS events
        FROM design.fixture_outsource_assignment_events event
        WHERE event.assignment_id = assignment.id
      ) history ON TRUE
      WHERE project.id = $2::uuid
        AND ${visibleProjectPredicate("project")}
      ORDER BY assignment.updated_at DESC, fixture.fixture_no, assignment.id
    `,
    [actorIdentifier(actor), projectId],
  );

  return result.rows.map(mapAssignmentRow);
}

async function findFixtureOutsourceAssignmentForUser(
  actor,
  assignmentId,
  client = pool,
  { lock = false } = {},
) {
  const result = await client.query(
    `
      ${buildVisibleUsersCte("$1")}
      SELECT
        assignment.*,
        fixture.fixture_no,
        fixture.project_id,
        project.department_id,
        project.status AS project_status,
        vendor.name AS vendor_name,
        coordinator.name AS internal_coordinator_name
      FROM design.fixture_outsource_assignments assignment
      JOIN design.fixtures fixture
        ON fixture.id = assignment.fixture_id
      JOIN design.projects project
        ON project.id = fixture.project_id
      JOIN design.vendors vendor
        ON vendor.id = assignment.vendor_id
      LEFT JOIN users coordinator
        ON coordinator.employee_id = assignment.internal_coordinator_id
      WHERE assignment.id::text = $2
        AND ${visibleProjectPredicate("project")}
      LIMIT 1
      ${lock ? "FOR UPDATE OF assignment" : ""}
    `,
    [actorIdentifier(actor), assignmentId],
  );

  return mapAssignmentRow(result.rows[0]);
}

async function findActiveFixtureOutsourceAssignment(
  fixtureId,
  workflowStageName,
  workflowStageVersion,
  client = pool,
) {
  const result = await client.query(
    `
      SELECT *
      FROM design.fixture_outsource_assignments
      WHERE fixture_id = $1::uuid
        AND workflow_stage_code = ${stageKeySql("$2")}
        AND workflow_stage_version = $3
        AND status NOT IN ('APPROVED', 'CANCELLED')
      LIMIT 1
    `,
    [fixtureId, workflowStageName, Number(workflowStageVersion || 0)],
  );

  return mapAssignmentRow(result.rows[0]);
}

async function cancelFixtureOutsourceAssignment(
  assignmentId,
  reason,
  client = pool,
) {
  const result = await client.query(
    `
      UPDATE design.fixture_outsource_assignments
      SET status = 'CANCELLED',
          cancelled_at = NOW(),
          cancellation_reason = $2,
          updated_at = NOW()
      WHERE id = $1::uuid
        AND status <> 'CANCELLED'
      RETURNING *
    `,
    [assignmentId, reason],
  );

  return mapAssignmentRow(result.rows[0]);
}

async function updateFixtureOutsourceAssignmentStatus(
  assignmentId,
  status,
  client = pool,
) {
  const result = await client.query(
    `
      UPDATE design.fixture_outsource_assignments
      SET status = $2,
          submitted_at = CASE
            WHEN $2 = 'SUBMITTED' THEN COALESCE(submitted_at, NOW())
            ELSE submitted_at
          END,
          reviewed_at = CASE
            WHEN $2 IN ('PENDING_INTERNAL_REVIEW', 'CHANGES_REQUIRED', 'APPROVED')
              THEN COALESCE(reviewed_at, NOW())
            ELSE reviewed_at
          END,
          completed_at = CASE
            WHEN $2 = 'APPROVED' THEN COALESCE(completed_at, NOW())
            ELSE completed_at
          END,
          updated_at = NOW()
      WHERE id = $1::uuid
        AND status <> 'CANCELLED'
      RETURNING *
    `,
    [assignmentId, status],
  );

  return mapAssignmentRow(result.rows[0]);
}

async function resetFixtureStageToAssignable(assignment, client = pool) {
  await client.query(
    `
      UPDATE fixture_workflow_progress
      SET status = 'PENDING',
          assigned_to = NULL,
          assigned_at = NULL,
          started_at = NULL,
          completed_at = NULL,
          duration_minutes = NULL,
          updated_at = NOW()
      WHERE fixture_id = $1::uuid
        AND department_id = $2
        AND ${stageKeySql("stage_name")} = $3
        AND COALESCE(stage_version, 0) = $4
        AND status IN ('PENDING', 'REJECTED')
        AND NULLIF(BTRIM(COALESCE(assigned_to, '')), '') IS NULL
    `,
    [
      assignment.fixture_id,
      assignment.department_id,
      assignment.workflow_stage_code,
      Number(assignment.workflow_stage_version || 0),
    ],
  );
}

async function lockInternalAssignmentForConversion({
  actor,
  projectId,
  fixtureId,
  workflowStageCode,
}, client = pool) {
  const rows = await resolveFixtureOutsourceScope({
    actor,
    projectId,
    workflowStageCode,
    scope: "selected",
    fixtureIds: [fixtureId],
    lock: true,
  }, client);
  const row = rows[0] || null;
  if (!row) {
    return null;
  }

  const tasks = await client.query(
    `
      SELECT
        id,
        status,
        lifecycle_status,
        started_at,
        completion_percent
      FROM tasks
      WHERE fixture_id = $1::uuid
        AND department_id = $2
        AND ${stageKeySql("stage")} = $3
        AND LOWER(BTRIM(COALESCE(lifecycle_status, status, ''))) NOT IN (
          'closed',
          'cancelled',
          'approved',
          'completed'
        )
      ORDER BY id
      FOR UPDATE
    `,
    [fixtureId, row.department_id, workflowStageCode],
  );

  return {
    ...row,
    internal_tasks: tasks.rows,
    source_internal_task_ids: tasks.rows.map((task) => task.id),
    work_started: Boolean(
      row.progress_status === "SUBMITTED_FOR_VERIFICATION"
      || tasks.rows.some((task) => (
        task.started_at
        || Number(task.completion_percent || 0) > 0
        || !["", "created", "assigned", "pending"].includes(
          String(task.lifecycle_status || task.status || "").trim().toLowerCase(),
        )
      )),
    ),
  };
}

async function cancelInternalAssignmentForOutsource(
  context,
  reason,
  client = pool,
) {
  if (context.source_internal_task_ids.length > 0) {
    await client.query(
      `
        UPDATE tasks
        SET status = 'cancelled',
            lifecycle_status = 'cancelled',
            remarks = CONCAT_WS(
              E'\\n',
              NULLIF(BTRIM(COALESCE(remarks, '')), ''),
              'Converted to outsourcing: ' || $2
            ),
            updated_at = NOW()
        WHERE id = ANY($1::integer[])
      `,
      [context.source_internal_task_ids, reason],
    );
  }

  await client.query(
    `
      UPDATE fixture_workflow_stage_attempts
      SET status = 'REJECTED',
          completed_at = COALESCE(completed_at, NOW()),
          updated_at = NOW()
      WHERE id = (
        SELECT attempt.id
        FROM fixture_workflow_stage_attempts attempt
        WHERE attempt.fixture_id = $1::uuid
          AND attempt.department_id = $2
          AND ${stageKeySql("attempt.stage_name")} = $3
          AND COALESCE(attempt.stage_version, 0) = $4
          AND attempt.status IN ('IN_PROGRESS', 'COMPLETED')
        ORDER BY attempt.attempt_no DESC, attempt.id DESC
        LIMIT 1
        FOR UPDATE
      )
    `,
    [
      context.fixture_id,
      context.department_id,
      context.workflow_stage_code,
      Number(context.workflow_stage_version || 0),
    ],
  );

  await client.query(
    `
      UPDATE fixture_workflow_progress
      SET status = 'PENDING',
          assigned_to = NULL,
          assigned_at = NULL,
          started_at = NULL,
          completed_at = NULL,
          duration_minutes = NULL,
          updated_at = NOW()
      WHERE id = $1::uuid
    `,
    [context.progress_id],
  );

}

module.exports = {
  cancelFixtureOutsourceAssignment,
  cancelInternalAssignmentForOutsource,
  createVendor,
  findActiveFixtureOutsourceAssignment,
  findCoordinatorForOutsourceScope,
  findFixtureOutsourceAssignmentForUser,
  findVendorById,
  findVisibleProjectForOutsource,
  insertFixtureOutsourceAssignmentEvents,
  insertFixtureOutsourceAssignments,
  listProjectFixtureOutsourceAssignments,
  listVendors,
  lockInternalAssignmentForConversion,
  resetFixtureStageToAssignable,
  resolveFixtureOutsourceScope,
  updateFixtureOutsourceAssignmentStatus,
};
