const assert = require("node:assert/strict");
const test = require("node:test");

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://user:pass@localhost:5432/tasktracker_test";

const {
  OUTSOURCE_ASSIGNMENT_STATUSES,
  OUTSOURCE_SKIP_CODES,
  classifyFixtureOutsourceEligibility,
  validateBulkOutsourcePayload,
} = require("../lib/fixtureOutsourceAssignments");

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const VENDOR_ID = "22222222-2222-4222-8222-222222222222";
const FIXTURE_IDS = [
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4",
];

function makePayload(overrides = {}) {
  return {
    project_id: PROJECT_ID,
    workflow_stage: "DAP",
    scope: "selected",
    fixture_ids: FIXTURE_IDS.slice(0, 2),
    vendor_id: VENDOR_ID,
    internal_coordinator_id: "COORD-1",
    deadline: "2026-08-01T12:00:00.000Z",
    priority: "High",
    instructions: "Complete the selected DAP work",
    work_order_reference: "WO-42",
    expected_deliverables: "Checked DAP package",
    reference_path: "projects/PRJ-1/DAP",
    ...overrides,
  };
}

function makeEligibleRow(fixtureId = FIXTURE_IDS[0], overrides = {}) {
  return {
    fixture_id: fixtureId,
    project_id: PROJECT_ID,
    project_status: "active",
    fixture_no: `F-${fixtureId.slice(-1)}`,
    stage_name: "DAP",
    workflow_stage_code: "dap",
    stage_status: "PENDING",
    prerequisites_complete: true,
    is_workflow_complete: false,
    active_outsource_id: null,
    internal_assignment_active: false,
    ...overrides,
  };
}

function makeScopeRow(fixtureId = FIXTURE_IDS[0], overrides = {}) {
  return {
    fixture_id: fixtureId,
    fixture_belongs_to_project: true,
    project_id: PROJECT_ID,
    project_status: "active",
    fixture_no: "F-" + fixtureId.slice(-1),
    workflow_stage_name: "DAP",
    workflow_stage_version: 0,
    progress_status: "PENDING",
    stage_exists: true,
    stage_assignable: true,
    prerequisites_complete: true,
    already_outsourced: false,
    internally_assigned: false,
    ...overrides,
  };
}

function makeActor(permissions = []) {
  return {
    employee_id: "LEAD-1",
    department_id: "design",
    permissions,
  };
}

function clearOutsourceServiceCache() {
  delete require.cache[require.resolve("../services/fixtureOutsourceAssignmentService")];
}

function installServiceMocks(options = {}) {
  const db = require("../db");
  const repository = require("../repositories/fixtureOutsourceAssignmentRepository");
  const auditRepository = require("../repositories/auditRepository");
  const originals = {
    connect: db.pool.connect,
    findVisibleProjectForOutsource: repository.findVisibleProjectForOutsource,
    resolveFixtureOutsourceScope: repository.resolveFixtureOutsourceScope,
    findCoordinatorForOutsourceScope: repository.findCoordinatorForOutsourceScope,
    findVendorById: repository.findVendorById,
    insertFixtureOutsourceAssignments: repository.insertFixtureOutsourceAssignments,
    insertFixtureOutsourceAssignmentEvents: repository.insertFixtureOutsourceAssignmentEvents,
    findFixtureOutsourceAssignmentForUser: repository.findFixtureOutsourceAssignmentForUser,
    cancelFixtureOutsourceAssignment: repository.cancelFixtureOutsourceAssignment,
    resetFixtureStageToAssignable: repository.resetFixtureStageToAssignable,
    lockInternalAssignmentForConversion: repository.lockInternalAssignmentForConversion,
    cancelInternalAssignmentForOutsource: repository.cancelInternalAssignmentForOutsource,
    createAuditLog: auditRepository.createAuditLog,
  };
  const calls = {
    tx: [],
    projects: [],
    scope: [],
    coordinators: [],
    vendors: [],
    inserts: [],
    events: [],
    lookups: [],
    cancellations: [],
    resets: [],
    internalLocks: [],
    internalCancellations: [],
    audits: [],
  };
  const client = {
    query: async (sql) => {
      calls.tx.push(String(sql).trim());
      return { rows: [], rowCount: 0 };
    },
    release: () => calls.tx.push("RELEASE"),
  };

  db.pool.connect = async () => client;
  repository.findVisibleProjectForOutsource = async (...args) => {
    calls.projects.push(args);
    return options.project === null
      ? null
      : { project_id: PROJECT_ID, project_status: "active", department_id: "design" };
  };
  repository.resolveFixtureOutsourceScope = async (...args) => {
    calls.scope.push(args);
    return options.scopeRows || [];
  };
  repository.findCoordinatorForOutsourceScope = async (...args) => {
    calls.coordinators.push(args);
    return options.coordinator === null
      ? null
      : { employee_id: "COORD-1", department_id: "design" };
  };
  repository.findVendorById = async (...args) => {
    calls.vendors.push(args);
    return options.vendor === null ? null : { id: VENDOR_ID, name: "Vendor One", is_active: true };
  };
  repository.insertFixtureOutsourceAssignments = async (...args) => {
    calls.inserts.push(args);
    if (options.insertError) {
      throw options.insertError;
    }
    const rows = args[0];
    const assignment = args[1];
    const insertedRows = typeof options.insertedRows === "function"
      ? options.insertedRows(rows, assignment)
      : rows;
    return insertedRows.map((row, index) => ({
      id: "outsource-" + (index + 1),
      fixture_id: row.fixture_id,
      workflow_stage_code: assignment.workflow_stage,
      workflow_stage_name: row.workflow_stage_name,
      workflow_stage_version: row.workflow_stage_version || 0,
      vendor_id: assignment.vendor_id,
      internal_coordinator_id: assignment.internal_coordinator_id,
      status: OUTSOURCE_ASSIGNMENT_STATUSES.OUTSOURCED,
    }));
  };
  repository.insertFixtureOutsourceAssignmentEvents = async (...args) => {
    calls.events.push(args);
  };
  repository.findFixtureOutsourceAssignmentForUser = async (...args) => {
    calls.lookups.push(args);
    return options.assignment === null
      ? null
      : options.assignment || {
        id: "outsource-1",
        fixture_id: FIXTURE_IDS[0],
        project_id: PROJECT_ID,
        department_id: "design",
        workflow_stage_code: "dap",
        workflow_stage_version: 0,
        status: OUTSOURCE_ASSIGNMENT_STATUSES.OUTSOURCED,
      };
  };
  repository.cancelFixtureOutsourceAssignment = async (...args) => {
    calls.cancellations.push(args);
    return {
      ...(options.assignment || {}),
      id: args[0],
      fixture_id: FIXTURE_IDS[0],
      workflow_stage_code: "dap",
      status: OUTSOURCE_ASSIGNMENT_STATUSES.CANCELLED,
      cancellation_reason: args[1],
      cancelled_at: "2026-07-13T12:00:00.000Z",
    };
  };
  repository.resetFixtureStageToAssignable = async (...args) => {
    calls.resets.push(args);
  };
  repository.lockInternalAssignmentForConversion = async (...args) => {
    calls.internalLocks.push(args);
    return options.internalAssignment === null
      ? null
      : options.internalAssignment || makeScopeRow(FIXTURE_IDS[0], {
        progress_id: "progress-1",
        internally_assigned: true,
        work_started: false,
        source_internal_task_ids: [101],
      });
  };
  repository.cancelInternalAssignmentForOutsource = async (...args) => {
    calls.internalCancellations.push(args);
  };
  auditRepository.createAuditLog = async (...args) => {
    calls.audits.push(args);
  };

  clearOutsourceServiceCache();
  return {
    calls,
    restore() {
      db.pool.connect = originals.connect;
      repository.findVisibleProjectForOutsource = originals.findVisibleProjectForOutsource;
      repository.resolveFixtureOutsourceScope = originals.resolveFixtureOutsourceScope;
      repository.findCoordinatorForOutsourceScope = originals.findCoordinatorForOutsourceScope;
      repository.findVendorById = originals.findVendorById;
      repository.insertFixtureOutsourceAssignments = originals.insertFixtureOutsourceAssignments;
      repository.insertFixtureOutsourceAssignmentEvents = originals.insertFixtureOutsourceAssignmentEvents;
      repository.findFixtureOutsourceAssignmentForUser = originals.findFixtureOutsourceAssignmentForUser;
      repository.cancelFixtureOutsourceAssignment = originals.cancelFixtureOutsourceAssignment;
      repository.resetFixtureStageToAssignable = originals.resetFixtureStageToAssignable;
      repository.lockInternalAssignmentForConversion = originals.lockInternalAssignmentForConversion;
      repository.cancelInternalAssignmentForOutsource = originals.cancelInternalAssignmentForOutsource;
      auditRepository.createAuditLog = originals.createAuditLog;
      clearOutsourceServiceCache();
    },
  };
}

test("bulk outsource payload validation normalizes one selected workflow stage", () => {
  const payload = validateBulkOutsourcePayload(makePayload({
    fixture_ids: [FIXTURE_IDS[0], FIXTURE_IDS[0], FIXTURE_IDS[1]],
  }));

  assert.equal(payload.workflow_stage, "DAP");
  assert.equal(payload.workflow_stage_code, "dap");
  assert.equal(payload.scope, "selected");
  assert.deepEqual(payload.fixture_ids, FIXTURE_IDS.slice(0, 2));
  assert.equal(payload.priority, "high");
  assert.equal(payload.deadline, "2026-08-01T12:00:00.000Z");
});

test("bulk outsource payload validation distinguishes all and selected scope", () => {
  const all = validateBulkOutsourcePayload(makePayload({
    scope: "all_assignable",
    fixture_ids: [],
  }));
  assert.equal(all.scope, "all_assignable");
  assert.deepEqual(all.fixture_ids, []);

  assert.throws(
    () => validateBulkOutsourcePayload(makePayload({ fixture_ids: [] })),
    /fixture_ids is required for selected scope/,
  );
  assert.throws(
    () => validateBulkOutsourcePayload(makePayload({ vendor_id: "" })),
    /vendor_id is required/,
  );
  assert.throws(
    () => validateBulkOutsourcePayload(makePayload({ internal_coordinator_id: "" })),
    /internal_coordinator_id is required/,
  );
});

test("eligibility classifies completed, internal, and duplicate outsource conflicts without overwriting", () => {
  assert.equal(classifyFixtureOutsourceEligibility(makeEligibleRow()), null);

  assert.deepEqual(
    classifyFixtureOutsourceEligibility(makeEligibleRow(FIXTURE_IDS[0], { stage_status: "APPROVED" })),
    {
      code: OUTSOURCE_SKIP_CODES.STAGE_COMPLETED,
      message: "Selected workflow stage is already completed",
    },
  );
  assert.deepEqual(
    classifyFixtureOutsourceEligibility(makeEligibleRow(FIXTURE_IDS[1], { internal_assignment_active: true })),
    {
      code: OUTSOURCE_SKIP_CODES.ALREADY_ASSIGNED_INTERNAL,
      message: "Fixture is already assigned internally",
    },
  );
  assert.deepEqual(
    classifyFixtureOutsourceEligibility(makeEligibleRow(FIXTURE_IDS[2], { active_outsource_id: "outsource-1" })),
    {
      code: OUTSOURCE_SKIP_CODES.ALREADY_OUTSOURCED,
      message: "Fixture stage is already outsourced",
    },
  );
});

test("outsourcing statuses remain separate from internal task statuses", () => {
  assert.deepEqual(Object.values(OUTSOURCE_ASSIGNMENT_STATUSES), [
    "OUTSOURCED",
    "IN_PROGRESS",
    "SUBMITTED",
    "PENDING_INTERNAL_REVIEW",
    "CHANGES_REQUIRED",
    "APPROVED",
    "CANCELLED",
  ]);
});

test("bulk outsource all resolves backend scope and inserts only the selected workflow stage", async () => {
  const mocks = installServiceMocks({
    scopeRows: FIXTURE_IDS.slice(0, 3).map((fixtureId) => makeScopeRow(fixtureId)),
  });
  try {
    const { bulkOutsourceFixtureStagesForUser } = require("../services/fixtureOutsourceAssignmentService");
    const result = await bulkOutsourceFixtureStagesForUser(
      makeActor(["design.fixture.outsource", "design.fixture.outsource.bulk"]),
      makePayload({ scope: "all_assignable", fixture_ids: [] }),
    );

    assert.equal(result.requested, 3);
    assert.equal(result.outsourced, 3);
    assert.deepEqual(result.skipped, []);
    assert.equal(mocks.calls.scope[0][0].scope, "all_assignable");
    assert.deepEqual(mocks.calls.scope[0][0].fixtureIds, []);
    assert.equal(mocks.calls.inserts[0][1].workflow_stage, "dap");
    assert.equal(mocks.calls.inserts[0][0].length, 3);
    assert.equal(mocks.calls.events[0][0].length, 3);
    assert.ok(mocks.calls.tx.includes("BEGIN"));
    assert.ok(mocks.calls.tx.includes("COMMIT"));
  } finally {
    mocks.restore();
  }
});

test("bulk outsource selected sends selected fixture IDs and selected stage only", async () => {
  const selectedFixtureIds = FIXTURE_IDS.slice(0, 2);
  const mocks = installServiceMocks({
    scopeRows: selectedFixtureIds.map((fixtureId) => makeScopeRow(fixtureId)),
  });
  try {
    const { bulkOutsourceFixtureStagesForUser } = require("../services/fixtureOutsourceAssignmentService");
    const result = await bulkOutsourceFixtureStagesForUser(
      makeActor(["design.fixture.outsource", "design.fixture.outsource.bulk"]),
      makePayload({ fixture_ids: selectedFixtureIds }),
    );

    assert.equal(result.requested, 2);
    assert.equal(result.outsourced, 2);
    assert.equal(mocks.calls.scope[0][0].scope, "selected");
    assert.deepEqual(mocks.calls.scope[0][0].fixtureIds, selectedFixtureIds);
    assert.equal(mocks.calls.inserts[0][1].workflow_stage, "dap");
    assert.equal(Object.hasOwn(mocks.calls.inserts[0][1], "outsourced_stages"), false);
  } finally {
    mocks.restore();
  }
});

test("bulk outsource returns partial success for completed, internal, and duplicate conflicts", async () => {
  const mocks = installServiceMocks({
    scopeRows: [
      makeScopeRow(FIXTURE_IDS[0]),
      makeScopeRow(FIXTURE_IDS[1], { progress_status: "APPROVED", stage_assignable: false }),
      makeScopeRow(FIXTURE_IDS[2], { internally_assigned: true }),
      makeScopeRow(FIXTURE_IDS[3], { already_outsourced: true }),
    ],
  });
  try {
    const { bulkOutsourceFixtureStagesForUser } = require("../services/fixtureOutsourceAssignmentService");
    const result = await bulkOutsourceFixtureStagesForUser(
      makeActor(["design.fixture.outsource", "design.fixture.outsource.bulk"]),
      makePayload({ fixture_ids: FIXTURE_IDS }),
    );

    assert.equal(result.requested, 4);
    assert.equal(result.outsourced, 1);
    assert.equal(result.assignments.length, 1);
    assert.deepEqual(result.skipped.map(({ fixture_id, code }) => ({ fixture_id, code })), [
      { fixture_id: FIXTURE_IDS[1], code: OUTSOURCE_SKIP_CODES.STAGE_COMPLETED },
      { fixture_id: FIXTURE_IDS[2], code: OUTSOURCE_SKIP_CODES.ALREADY_ASSIGNED_INTERNAL },
      { fixture_id: FIXTURE_IDS[3], code: OUTSOURCE_SKIP_CODES.ALREADY_OUTSOURCED },
    ]);
    assert.deepEqual(mocks.calls.inserts[0][0].map((row) => row.fixture_id), [FIXTURE_IDS[0]]);
  } finally {
    mocks.restore();
  }
});

test("bulk outsource reports a concurrent duplicate instead of overwriting it", async () => {
  const mocks = installServiceMocks({
    scopeRows: FIXTURE_IDS.slice(0, 2).map((fixtureId) => makeScopeRow(fixtureId)),
    insertedRows: (rows) => rows.slice(0, 1),
  });
  try {
    const { bulkOutsourceFixtureStagesForUser } = require("../services/fixtureOutsourceAssignmentService");
    const result = await bulkOutsourceFixtureStagesForUser(
      makeActor(["design.fixture.outsource", "design.fixture.outsource.bulk"]),
      makePayload(),
    );

    assert.equal(result.outsourced, 1);
    assert.deepEqual(result.skipped.map(({ fixture_id, code }) => ({ fixture_id, code })), [{
      fixture_id: FIXTURE_IDS[1],
      code: OUTSOURCE_SKIP_CODES.ALREADY_OUTSOURCED,
    }]);
  } finally {
    mocks.restore();
  }
});

test("bulk outsource rejects an unauthorized user before resolving scope", async () => {
  const mocks = installServiceMocks({ scopeRows: [makeScopeRow()] });
  try {
    const { bulkOutsourceFixtureStagesForUser } = require("../services/fixtureOutsourceAssignmentService");
    await assert.rejects(
      () => bulkOutsourceFixtureStagesForUser(makeActor([]), makePayload()),
      (error) => error.statusCode === 403,
    );
    assert.equal(mocks.calls.projects.length, 0);
    assert.equal(mocks.calls.scope.length, 0);
    assert.equal(mocks.calls.inserts.length, 0);
  } finally {
    mocks.restore();
  }
});

test("bulk outsource rejects an internal coordinator outside project team scope", async () => {
  const mocks = installServiceMocks({
    scopeRows: [makeScopeRow()],
    coordinator: null,
  });
  try {
    const { bulkOutsourceFixtureStagesForUser } = require("../services/fixtureOutsourceAssignmentService");
    await assert.rejects(
      () => bulkOutsourceFixtureStagesForUser(
        makeActor(["design.fixture.outsource", "design.fixture.outsource.bulk"]),
        makePayload({ fixture_ids: [FIXTURE_IDS[0]] }),
      ),
      (error) => error.statusCode === 403 && /coordinator/i.test(error.message),
    );
    assert.equal(mocks.calls.inserts.length, 0);
    assert.ok(mocks.calls.tx.includes("ROLLBACK"));
  } finally {
    mocks.restore();
  }
});

test("bulk outsource rolls back the complete batch after a database failure", async () => {
  const mocks = installServiceMocks({
    scopeRows: FIXTURE_IDS.slice(0, 2).map((fixtureId) => makeScopeRow(fixtureId)),
    insertError: new Error("outsource insert failed"),
  });
  try {
    const { bulkOutsourceFixtureStagesForUser } = require("../services/fixtureOutsourceAssignmentService");
    await assert.rejects(
      () => bulkOutsourceFixtureStagesForUser(
        makeActor(["design.fixture.outsource", "design.fixture.outsource.bulk"]),
        makePayload(),
      ),
      /outsource insert failed/,
    );
    assert.ok(mocks.calls.tx.includes("BEGIN"));
    assert.ok(mocks.calls.tx.includes("ROLLBACK"));
    assert.equal(mocks.calls.tx.includes("COMMIT"), false);
    assert.equal(mocks.calls.events.length, 0);
    assert.equal(mocks.calls.audits.length, 0);
  } finally {
    mocks.restore();
  }
});

test("cancellation preserves the assignment and records history with a reason", async () => {
  const mocks = installServiceMocks();
  try {
    const { cancelFixtureOutsourceAssignmentForUser } = require("../services/fixtureOutsourceAssignmentService");
    const cancelled = await cancelFixtureOutsourceAssignmentForUser(
      makeActor(["design.fixture.outsource.cancel"]),
      "outsource-1",
      { reason: "Vendor capacity changed" },
    );

    assert.equal(cancelled.status, OUTSOURCE_ASSIGNMENT_STATUSES.CANCELLED);
    assert.equal(cancelled.cancellation_reason, "Vendor capacity changed");
    assert.equal(mocks.calls.cancellations.length, 1);
    assert.equal(mocks.calls.resets.length, 1);
    assert.deepEqual(
      mocks.calls.events[0][0].map(({ event_type, previous_status, new_status, reason }) => ({
        event_type,
        previous_status,
        new_status,
        reason,
      })),
      [{
        event_type: "CANCELLED",
        previous_status: OUTSOURCE_ASSIGNMENT_STATUSES.OUTSOURCED,
        new_status: OUTSOURCE_ASSIGNMENT_STATUSES.CANCELLED,
        reason: "Vendor capacity changed",
      }],
    );
    assert.equal(mocks.calls.audits.length, 1);
    assert.ok(mocks.calls.tx.includes("COMMIT"));
  } finally {
    mocks.restore();
  }
});

test("internal-to-outsource conversion requires manage permission and a reason", async () => {
  const mocks = installServiceMocks();
  try {
    const { convertInternalAssignmentToOutsourceForUser } = require("../services/fixtureOutsourceAssignmentService");
    await assert.rejects(
      () => convertInternalAssignmentToOutsourceForUser(
        makeActor(["design.fixture.outsource"]),
        { ...makePayload(), fixture_id: FIXTURE_IDS[0], reason: "Move externally" },
      ),
      (error) => error.statusCode === 403,
    );
    await assert.rejects(
      () => convertInternalAssignmentToOutsourceForUser(
        makeActor(["design.fixture.outsource", "design.fixture.outsource.manage"]),
        { ...makePayload(), fixture_id: FIXTURE_IDS[0], reason: "" },
      ),
      (error) => error.statusCode === 400 && /reason is required/i.test(error.message),
    );
    assert.equal(mocks.calls.internalLocks.length, 0);
    assert.equal(mocks.calls.internalCancellations.length, 0);
  } finally {
    mocks.restore();
  }
});

test("started internal work needs override permission before conversion", async () => {
  const started = makeScopeRow(FIXTURE_IDS[0], {
    progress_id: "progress-1",
    progress_status: "IN_PROGRESS",
    internally_assigned: true,
    work_started: true,
    source_internal_task_ids: [101],
  });
  const deniedMocks = installServiceMocks({ internalAssignment: started });
  try {
    const { convertInternalAssignmentToOutsourceForUser } = require("../services/fixtureOutsourceAssignmentService");
    await assert.rejects(
      () => convertInternalAssignmentToOutsourceForUser(
        makeActor(["design.fixture.outsource", "design.fixture.outsource.manage"]),
        { ...makePayload(), fixture_id: FIXTURE_IDS[0], reason: "Specialist vendor required" },
      ),
      (error) => error.statusCode === 403 && /override permission/i.test(error.message),
    );
    assert.equal(deniedMocks.calls.internalCancellations.length, 0);
    assert.ok(deniedMocks.calls.tx.includes("ROLLBACK"));
  } finally {
    deniedMocks.restore();
  }

  const allowedMocks = installServiceMocks({ internalAssignment: started });
  try {
    const { convertInternalAssignmentToOutsourceForUser } = require("../services/fixtureOutsourceAssignmentService");
    const assignment = await convertInternalAssignmentToOutsourceForUser(
      makeActor([
        "design.fixture.outsource",
        "design.fixture.outsource.manage",
        "design.fixture.outsource.override",
      ]),
      { ...makePayload(), fixture_id: FIXTURE_IDS[0], reason: "Specialist vendor required" },
    );

    assert.equal(assignment.status, OUTSOURCE_ASSIGNMENT_STATUSES.OUTSOURCED);
    assert.equal(allowedMocks.calls.internalCancellations.length, 1);
    assert.equal(allowedMocks.calls.inserts[0][1].conversion_reason, "Specialist vendor required");
    assert.equal(allowedMocks.calls.events[0][0][0].event_type, "INTERNAL_ASSIGNMENT_CONVERTED");
    assert.ok(allowedMocks.calls.tx.includes("COMMIT"));
  } finally {
    allowedMocks.restore();
  }
});

test("outsource-to-internal conversion cancels in place and preserves history", async () => {
  const mocks = installServiceMocks();
  try {
    const { convertOutsourceToInternalForUser } = require("../services/fixtureOutsourceAssignmentService");
    const cancelled = await convertOutsourceToInternalForUser(
      makeActor(["design.fixture.outsource.manage"]),
      "outsource-1",
      { reason: "Bring work back to the 2D team" },
    );

    assert.equal(cancelled.status, OUTSOURCE_ASSIGNMENT_STATUSES.CANCELLED);
    assert.equal(cancelled.cancellation_reason, "Bring work back to the 2D team");
    assert.equal(mocks.calls.resets.length, 1);
    assert.equal(mocks.calls.events[0][0][0].event_type, "CONVERTED_TO_INTERNAL");
    assert.equal(mocks.calls.events[0][0][0].reason, "Bring work back to the 2D team");
  } finally {
    mocks.restore();
  }
});

test("existing internal fixture assignment entry point remains intact", () => {
  const projectCatalogService = require("../services/projectCatalogService");
  assert.equal(typeof projectCatalogService.createDesignTaskFromProject, "function");
});

test("schema bootstrap creates separate vendor and stage-scoped outsourcing history tables", async () => {
  const statements = [];
  const client = {
    query: async (sql) => {
      statements.push(String(sql));
      return { rows: [], rowCount: 0 };
    },
  };
  const { ensureFixtureOutsourceAssignmentSchema } = require("../repositories/fixtureOutsourceAssignmentSchemaRepository");

  await ensureFixtureOutsourceAssignmentSchema(client);

  const vendorsSql = statements.find((sql) => /CREATE TABLE IF NOT EXISTS design\.vendors/.test(sql));
  const assignmentsSql = statements.find((sql) => /CREATE TABLE IF NOT EXISTS design\.fixture_outsource_assignments/.test(sql));
  const eventsSql = statements.find((sql) => /CREATE TABLE IF NOT EXISTS design\.fixture_outsource_assignment_events/.test(sql));
  const activeIndexSql = statements.find((sql) => /idx_fixture_outsource_assignments_active_stage/.test(sql));

  assert.ok(vendorsSql);
  assert.match(assignmentsSql, /vendor_id UUID NOT NULL REFERENCES design\.vendors\(id\)/);
  assert.match(eventsSql, /REFERENCES design\.fixture_outsource_assignments\(id\) ON DELETE CASCADE/);

  const statusConstraint = assignmentsSql.match(
    /CONSTRAINT design_fixture_outsource_status_check\s+CHECK \(status IN \(([^)]+)\)\)/,
  );
  assert.deepEqual(
    statusConstraint?.[1].match(/'[^']+'/g)?.map((status) => status.slice(1, -1)),
    Object.values(OUTSOURCE_ASSIGNMENT_STATUSES),
  );

  assert.match(activeIndexSql, /CREATE UNIQUE INDEX/);
  assert.match(activeIndexSql, /fixture_id[\s\S]+workflow_stage_code[\s\S]+workflow_stage_version/);
  assert.match(activeIndexSql, /WHERE status <> 'CANCELLED'/);
});

test("default outsourcing permissions follow the existing role hierarchy", () => {
  const {
    DESIGN_OUTSOURCE_ROLE_PERMISSION_BUNDLES,
    PERMISSIONS,
  } = require("../config/constants");
  const allSeven = [
    PERMISSIONS.DESIGN_FIXTURE_OUTSOURCE,
    PERMISSIONS.DESIGN_FIXTURE_OUTSOURCE_BULK,
    PERMISSIONS.DESIGN_FIXTURE_OUTSOURCE_MANAGE,
    PERMISSIONS.DESIGN_FIXTURE_OUTSOURCE_CANCEL,
    PERMISSIONS.DESIGN_FIXTURE_OUTSOURCE_REVIEW,
    PERMISSIONS.DESIGN_FIXTURE_OUTSOURCE_OVERRIDE,
    PERMISSIONS.DESIGN_VENDOR_MANAGE,
  ];
  const managerFive = [
    PERMISSIONS.DESIGN_FIXTURE_OUTSOURCE,
    PERMISSIONS.DESIGN_FIXTURE_OUTSOURCE_BULK,
    PERMISSIONS.DESIGN_FIXTURE_OUTSOURCE_MANAGE,
    PERMISSIONS.DESIGN_FIXTURE_OUTSOURCE_CANCEL,
    PERMISSIONS.DESIGN_FIXTURE_OUTSOURCE_REVIEW,
  ];

  assert.deepEqual(DESIGN_OUTSOURCE_ROLE_PERMISSION_BUNDLES.r1, allSeven);
  assert.deepEqual(DESIGN_OUTSOURCE_ROLE_PERMISSION_BUNDLES.r2, allSeven);
  assert.deepEqual(DESIGN_OUTSOURCE_ROLE_PERMISSION_BUNDLES.r3, managerFive);
  assert.deepEqual(DESIGN_OUTSOURCE_ROLE_PERMISSION_BUNDLES.r4, managerFive);
  assert.deepEqual(DESIGN_OUTSOURCE_ROLE_PERMISSION_BUNDLES.r5, [
    PERMISSIONS.DESIGN_FIXTURE_OUTSOURCE_REVIEW,
  ]);
  assert.equal(Object.hasOwn(DESIGN_OUTSOURCE_ROLE_PERMISSION_BUNDLES, "r6"), false);
  assert.equal(Object.hasOwn(DESIGN_OUTSOURCE_ROLE_PERMISSION_BUNDLES, "r7"), false);
});

test("Release stage is never eligible for outsourcing", () => {
  assert.deepEqual(
    classifyFixtureOutsourceEligibility(makeEligibleRow(FIXTURE_IDS[0], {
      stage_name: "Release",
      workflow_stage_code: "release",
      stage_status: "PENDING",
      stage_assignable: true,
    })),
    {
      code: OUTSOURCE_SKIP_CODES.STAGE_NOT_ASSIGNABLE,
      message: "Release is not an outsourcing assignment stage",
    },
  );
});

test("conversion work-start detection ignores assignment timestamps but honors real progress", async () => {
  const { lockInternalAssignmentForConversion } = require("../repositories/fixtureOutsourceAssignmentRepository");

  async function detectWorkStarted(task, rowOverrides = {}) {
    const row = makeScopeRow(FIXTURE_IDS[0], {
      department_id: "design",
      progress_id: "progress-1",
      progress_status: "PENDING",
      started_at: "2026-07-13T08:00:00.000Z",
      internally_assigned: true,
      ...rowOverrides,
    });
    const client = {
      query: async (sql) => {
        const statement = String(sql);
        if (/FROM design\.fixtures fixture/.test(statement)) {
          return { rows: [row], rowCount: 1 };
        }
        if (/FROM fixture_workflow_progress\s+WHERE id = ANY/.test(statement)) {
          return { rows: [{ id: row.progress_id }], rowCount: 1 };
        }
        if (/FROM tasks/.test(statement)) {
          return { rows: [task], rowCount: 1 };
        }
        throw new Error("Unexpected repository query");
      },
    };
    const context = await lockInternalAssignmentForConversion({
      actor: makeActor(["design.fixture.outsource.manage"]),
      projectId: PROJECT_ID,
      fixtureId: FIXTURE_IDS[0],
      workflowStageCode: "dap",
    }, client);
    return context.work_started;
  }

  const newlyAssignedTask = {
    id: 101,
    status: "assigned",
    lifecycle_status: "assigned",
    started_at: null,
    completion_percent: 0,
  };
  assert.equal(await detectWorkStarted(newlyAssignedTask), false);
  assert.equal(await detectWorkStarted({ ...newlyAssignedTask, completion_percent: 10 }), true);
  assert.equal(await detectWorkStarted({
    ...newlyAssignedTask,
    status: "in_progress",
    lifecycle_status: "in_progress",
  }), true);
  assert.equal(await detectWorkStarted(newlyAssignedTask, {
    progress_status: "SUBMITTED_FOR_VERIFICATION",
  }), true);
});

test("coordinator scope SQL requires outsourcing review permission", async () => {
  const calls = [];
  const client = {
    query: async (sql, params) => {
      calls.push({ sql: String(sql), params });
      return {
        rows: [{
          employee_id: "COORD-1",
          department_id: "design",
          can_review_outsource: true,
        }],
        rowCount: 1,
      };
    },
  };
  const { findCoordinatorForOutsourceScope } = require("../repositories/fixtureOutsourceAssignmentRepository");

  await findCoordinatorForOutsourceScope({
    actor: makeActor(["design.fixture.outsource.manage"]),
    projectId: PROJECT_ID,
    coordinatorId: "COORD-1",
    workflowStageCode: "dap",
  }, client);

  assert.match(calls[0].sql, /permissions/i);
  assert.match(calls[0].sql + JSON.stringify(calls[0].params), /design\.fixture\.outsource\.review/);
});

test("internal fixture assignment locks eligibility and writes progress in one transaction", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const source = fs.readFileSync(
    path.join(__dirname, "..", "services", "fixtureWorkflowService.js"),
    "utf8",
  );
  const assignFixtureStage = source.match(
    /async function assignFixtureStage\([\s\S]+?(?=\nasync function submitFixtureStageForVerification)/,
  )?.[0];

  assert.ok(assignFixtureStage);
  assert.match(assignFixtureStage, /const client = await pool\.connect\(\)/);
  assert.match(assignFixtureStage, /await client\.query\("BEGIN"\)/);
  assert.match(
    assignFixtureStage,
    /validateAssignment\(\s*fixtureId,\s*departmentId,\s*client,\s*\{ lock: true \},\s*\)/,
  );
  assert.match(
    assignFixtureStage,
    /updateProgressRow\(fixtureId,\s*currentStage\.stage_name,\s*\{[\s\S]+?\},\s*client\)/,
  );
  assert.match(assignFixtureStage, /await client\.query\("COMMIT"\)/);
  assert.match(assignFixtureStage, /await client\.query\("ROLLBACK"\)/);
});
