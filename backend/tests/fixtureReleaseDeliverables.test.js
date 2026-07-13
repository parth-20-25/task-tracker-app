const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://user:pass@localhost:5432/tasktracker_test";

const { PERMISSIONS } = require("../config/constants");
const {
  RELEASE_DELIVERABLE_APPLICABILITY,
  RELEASE_DELIVERABLE_CODES,
  RELEASE_DELIVERABLE_DEFINITIONS,
  RELEASE_DELIVERABLE_STATUSES,
  RELEASE_PACKAGE_STATUSES,
  buildFixtureReleaseBlockers,
  isReleaseStageName,
} = require("../lib/fixtureReleaseDeliverables");

const FIXTURE_ID = "11111111-1111-1111-1111-111111111111";
const PROJECT_ID = "22222222-2222-2222-2222-222222222222";

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function makePackage(overrides = {}) {
  const statusByCode = overrides.statusByCode || {};
  const assigneeByCode = overrides.assigneeByCode || {};
  return {
    id: "package-1",
    fixture_id: FIXTURE_ID,
    project_id: PROJECT_ID,
    department_id: "design",
    version: 1,
    status: RELEASE_PACKAGE_STATUSES.IN_PROGRESS,
    deliverables: RELEASE_DELIVERABLE_DEFINITIONS.map((definition) => ({
      id: `deliverable-${definition.sequence}`,
      package_id: "package-1",
      deliverable_code: definition.code,
      sequence: definition.sequence,
      is_required: definition.isRequired,
      applicability_status: definition.code === RELEASE_DELIVERABLE_CODES.MIMIC_DISPLAY
        ? RELEASE_DELIVERABLE_APPLICABILITY.UNRESOLVED
        : RELEASE_DELIVERABLE_APPLICABILITY.REQUIRED,
      status: statusByCode[definition.code]
        || (definition.sequence === 1
          ? RELEASE_DELIVERABLE_STATUSES.READY
          : RELEASE_DELIVERABLE_STATUSES.LOCKED),
      assignee_id: assigneeByCode[definition.code] || null,
    })),
    ...overrides,
  };
}

function makeLeader(employeeId = "LEAD-1") {
  return {
    employee_id: employeeId,
    department_id: "design",
    permissions: [PERMISSIONS.ASSIGN_TASK, PERMISSIONS.APPROVE_COMPLETED_TASK, PERMISSIONS.CHANGE_FIXTURE_STAGE],
    role: { id: "r4", name: "Team Leader", hierarchy_level: 4, permissions: {} },
    visible_user_ids: [employeeId, "EMP-1", "EMP-2"],
  };
}

function makeMember(employeeId = "EMP-1", overrides = {}) {
  return {
    employee_id: employeeId,
    department_id: "design",
    permissions: [PERMISSIONS.VIEW_SELF_TASKS],
    role: { id: "r6", name: "Designer", hierarchy_level: 6, permissions: {} },
    subdivision: { subdivision_name: "2D", is_active: true },
    is_active: true,
    visible_user_ids: [employeeId],
    ...overrides,
  };
}

function clearServiceCache() {
  delete require.cache[require.resolve("../services/fixtureReleaseDeliverablesService")];
}

function installServiceMocks(initialPackage = makePackage(), { assigneeFactory = makeMember } = {}) {
  const db = require("../db");
  const auditRepository = require("../repositories/auditRepository");
  const releaseRepository = require("../repositories/fixtureReleaseDeliverablesRepository");
  const routingRepository = require("../repositories/projectSubdivisionRoutingRepository");
  const usersRepository = require("../repositories/usersRepository");
  const original = {
    connect: db.pool.connect,
    createAuditLog: auditRepository.createAuditLog,
    ensurePackageForApproved2D: releaseRepository.ensurePackageForApproved2D,
    getPackageByFixtureId: releaseRepository.getPackageByFixtureId,
    getPackageForUpdate: releaseRepository.getPackageForUpdate,
    assignDeliverable: releaseRepository.assignDeliverable,
    updateDeliverableStatus: releaseRepository.updateDeliverableStatus,
    setMimicApplicability: releaseRepository.setMimicApplicability,
    unlockDeliverable: releaseRepository.unlockDeliverable,
    refreshPackageStatus: releaseRepository.refreshPackageStatus,
    insertDeliverableEvent: releaseRepository.insertDeliverableEvent,
    findUserByEmployeeId: usersRepository.findUserByEmployeeId,
    projectHasActive2DRouting: routingRepository.projectHasActive2DRouting,
    isProjectAssignedTo2DTeamMember: routingRepository.isProjectAssignedTo2DTeamMember,
  };

  let state = clone(initialPackage);
  let ensureCalls = 0;
  const audit = [];
  const events = [];
  const tx = [];
  const client = {
    query: async (sql) => {
      tx.push(String(sql).trim());
      return { rows: [], rowCount: 0 };
    },
    release: () => tx.push("RELEASE"),
  };

  function findStateDeliverable(deliverableId) {
    return state?.deliverables.find((entry) => entry.id === deliverableId) || null;
  }

  db.pool.connect = async () => client;
  auditRepository.createAuditLog = async (entry) => {
    audit.push(clone(entry));
  };
  releaseRepository.ensurePackageForApproved2D = async () => {
    ensureCalls += 1;
    if (state) {
      return { package: clone(state), created: false };
    }
    state = makePackage();
    return { package: clone(state), created: true };
  };
  releaseRepository.getPackageByFixtureId = async () => clone(state);
  releaseRepository.getPackageForUpdate = async () => clone(state);
  releaseRepository.assignDeliverable = async (deliverableId, fields) => {
    const deliverable = findStateDeliverable(deliverableId);
    deliverable.assignee_id = fields.assigneeId;
    deliverable.due_at = fields.dueAt;
    return clone(deliverable);
  };
  releaseRepository.updateDeliverableStatus = async (deliverableId, status, fields = {}) => {
    const deliverable = findStateDeliverable(deliverableId);
    deliverable.status = status;
    if (status === RELEASE_DELIVERABLE_STATUSES.APPROVED) {
      deliverable.approved_by = fields.actorId;
    }
    if (status === RELEASE_DELIVERABLE_STATUSES.CHANGES_REQUIRED) {
      deliverable.approved_by = null;
    }
    if (fields.comment) {
      deliverable.latest_comment = fields.comment;
    }
    return clone(deliverable);
  };
  releaseRepository.setMimicApplicability = async (deliverableId, fields) => {
    const deliverable = findStateDeliverable(deliverableId);
    deliverable.is_required = fields.required;
    deliverable.applicability_status = fields.required
      ? RELEASE_DELIVERABLE_APPLICABILITY.REQUIRED
      : RELEASE_DELIVERABLE_APPLICABILITY.NOT_APPLICABLE;
    deliverable.status = fields.required
      ? RELEASE_DELIVERABLE_STATUSES.READY
      : RELEASE_DELIVERABLE_STATUSES.NOT_APPLICABLE;
    deliverable.approved_by = fields.required ? null : fields.actorId;
    deliverable.latest_comment = fields.reason;
    return clone(deliverable);
  };
  releaseRepository.unlockDeliverable = async (deliverableId) => {
    const deliverable = findStateDeliverable(deliverableId);
    if (
      deliverable.status === RELEASE_DELIVERABLE_STATUSES.LOCKED
      && deliverable.applicability_status !== RELEASE_DELIVERABLE_APPLICABILITY.UNRESOLVED
    ) {
      deliverable.status = RELEASE_DELIVERABLE_STATUSES.READY;
    }
    return clone(deliverable);
  };
  releaseRepository.refreshPackageStatus = async () => {
    state.status = state.deliverables.every((deliverable) => (
      deliverable.status === RELEASE_DELIVERABLE_STATUSES.APPROVED
      || deliverable.status === RELEASE_DELIVERABLE_STATUSES.NOT_APPLICABLE
    ))
      ? RELEASE_PACKAGE_STATUSES.READY_FOR_RELEASE
      : RELEASE_PACKAGE_STATUSES.IN_PROGRESS;
    return clone(state);
  };
  releaseRepository.insertDeliverableEvent = async (entry, txClient) => {
    assert.equal(txClient, client);
    events.push(clone(entry));
  };
  usersRepository.findUserByEmployeeId = async (employeeId, txClient) => {
    assert.equal(txClient, client);
    return assigneeFactory(employeeId);
  };
  routingRepository.projectHasActive2DRouting = async () => true;
  routingRepository.isProjectAssignedTo2DTeamMember = async () => true;

  clearServiceCache();

  return {
    audit,
    events,
    getEnsureCalls: () => ensureCalls,
    getState: () => clone(state),
    restore() {
      db.pool.connect = original.connect;
      auditRepository.createAuditLog = original.createAuditLog;
      releaseRepository.ensurePackageForApproved2D = original.ensurePackageForApproved2D;
      releaseRepository.getPackageByFixtureId = original.getPackageByFixtureId;
      releaseRepository.getPackageForUpdate = original.getPackageForUpdate;
      releaseRepository.assignDeliverable = original.assignDeliverable;
      releaseRepository.updateDeliverableStatus = original.updateDeliverableStatus;
      releaseRepository.setMimicApplicability = original.setMimicApplicability;
      releaseRepository.unlockDeliverable = original.unlockDeliverable;
      releaseRepository.refreshPackageStatus = original.refreshPackageStatus;
      releaseRepository.insertDeliverableEvent = original.insertDeliverableEvent;
      usersRepository.findUserByEmployeeId = original.findUserByEmployeeId;
      routingRepository.projectHasActive2DRouting = original.projectHasActive2DRouting;
      routingRepository.isProjectAssignedTo2DTeamMember = original.isProjectAssignedTo2DTeamMember;
      clearServiceCache();
    },
  };
}

function makePackageRepositoryClient({
  isWorkflowComplete = false,
  hasApproved2D = true,
  hasApprovedRelease = false,
  snapshotAt = null,
  packages = [],
} = {}) {
  const state = {
    packages: clone(packages),
    insertedVersions: [],
    statements: [],
  };

  function latestPackage() {
    return [...state.packages].sort((left, right) => Number(right.version) - Number(left.version))[0] || null;
  }

  const client = {
    query: async (sql, params = []) => {
      const statement = String(sql).replace(/\s+/g, " ").trim();
      state.statements.push(statement);

      if (statement.includes("FOR UPDATE OF fixture")) {
        const latest = latestPackage();
        return {
          rowCount: 1,
          rows: [{
            fixture_id: FIXTURE_ID,
            is_workflow_complete: isWorkflowComplete,
            has_approved_2d: hasApproved2D,
            has_approved_release: hasApprovedRelease,
            latest_release_snapshot_at: snapshotAt,
            latest_package_id: latest?.id || null,
            latest_package_version: latest?.version || null,
            latest_package_created_at: latest?.created_at || null,
            latest_package_predates_release: Boolean(
              latest && snapshotAt && new Date(latest.created_at) < new Date(snapshotAt),
            ),
          }],
        };
      }

      if (statement.startsWith("INSERT INTO design.fixture_release_packages")) {
        const version = Number(params[1]);
        const existing = state.packages.find((releasePackage) => Number(releasePackage.version) === version);
        if (existing) {
          return { rowCount: 0, rows: [] };
        }
        const latestTimestamp = Math.max(
          Date.parse(snapshotAt || 0),
          ...state.packages.map((releasePackage) => Date.parse(releasePackage.created_at)),
          Date.parse("2026-01-01T00:00:00.000Z"),
        );
        const releasePackage = {
          id: `00000000-0000-0000-0000-${String(version).padStart(12, "0")}`,
          fixture_id: FIXTURE_ID,
          project_id: PROJECT_ID,
          fixture_no: "FX-001",
          department_id: "design",
          version,
          status: RELEASE_PACKAGE_STATUSES.IN_PROGRESS,
          created_at: new Date(latestTimestamp + 1000).toISOString(),
        };
        state.packages.push(releasePackage);
        state.insertedVersions.push(version);
        return { rowCount: 1, rows: [{ id: releasePackage.id, version }] };
      }

      if (statement.startsWith("SELECT id, version FROM design.fixture_release_packages")) {
        const releasePackage = state.packages.find(
          (candidate) => Number(candidate.version) === Number(params[1]),
        );
        return { rowCount: releasePackage ? 1 : 0, rows: releasePackage ? [releasePackage] : [] };
      }

      if (statement.startsWith("INSERT INTO design.fixture_release_deliverables")) {
        return { rowCount: RELEASE_DELIVERABLE_DEFINITIONS.length, rows: [] };
      }

      if (statement.includes("FROM design.fixture_release_packages package")) {
        const releasePackage = latestPackage();
        return { rowCount: releasePackage ? 1 : 0, rows: releasePackage ? [releasePackage] : [] };
      }

      if (statement.includes("FROM design.fixture_release_deliverables")) {
        return { rowCount: 0, rows: [] };
      }

      throw new Error(`Unexpected repository query: ${statement}`);
    },
  };

  return { client, state };
}

test("release deliverables use the exact required order and centralized codes", () => {
  assert.deepEqual(
    RELEASE_DELIVERABLE_DEFINITIONS.map(({ label, sequence }) => [sequence, label]),
    [
      [1, "Drafting"],
      [2, "Print & Drafting Checking"],
      [3, "BOM Checking"],
      [4, "Drawing Correction"],
      [5, "AutoCAD PDF"],
      [6, "IGES Data"],
      [7, "CMM Data"],
      [8, "Line Layout"],
      [9, "Mimic Display"],
      [10, "Wear-Out Data"],
    ],
  );
  assert.equal(RELEASE_DELIVERABLE_DEFINITIONS[8].isRequired, false);
  assert.equal(RELEASE_DELIVERABLE_DEFINITIONS.filter((item) => !item.isRequired).length, 1);
  assert.equal(isReleaseStageName("Released"), true);
});

test("release blockers are structured for main workflow, pending work, and Mimic applicability", () => {
  const releasePackage = makePackage({
    statusByCode: {
      [RELEASE_DELIVERABLE_CODES.DRAFTING]: RELEASE_DELIVERABLE_STATUSES.PENDING_APPROVAL,
    },
  });
  const blockers = buildFixtureReleaseBlockers([
    { stage_name: "Concept", status: "APPROVED" },
    { stage_name: "DAP", status: "PENDING" },
    { stage_name: "2D Finish", status: "APPROVED" },
    { stage_name: "Release", status: "PENDING" },
  ], releasePackage);

  assert.ok(blockers.some((blocker) => blocker.code === "MAIN_WORKFLOW_INCOMPLETE" && blocker.stage === "DAP"));
  assert.ok(blockers.some((blocker) => blocker.code === "DELIVERABLE_PENDING_APPROVAL" && blocker.deliverable === RELEASE_DELIVERABLE_CODES.DRAFTING));
  assert.ok(blockers.some((blocker) => blocker.code === "MIMIC_APPLICABILITY_UNRESOLVED"));
});

test("only Mimic Display can resolve as Not Applicable", () => {
  const approvedStatuses = Object.fromEntries(
    RELEASE_DELIVERABLE_DEFINITIONS.map((definition) => [
      definition.code,
      RELEASE_DELIVERABLE_STATUSES.APPROVED,
    ]),
  );
  const releasePackage = makePackage({ statusByCode: approvedStatuses });
  const mandatoryDeliverable = releasePackage.deliverables.find(
    (deliverable) => deliverable.deliverable_code === RELEASE_DELIVERABLE_CODES.DRAFTING,
  );
  const mimicDeliverable = releasePackage.deliverables.find(
    (deliverable) => deliverable.deliverable_code === RELEASE_DELIVERABLE_CODES.MIMIC_DISPLAY,
  );
  mandatoryDeliverable.status = RELEASE_DELIVERABLE_STATUSES.NOT_APPLICABLE;
  mimicDeliverable.status = RELEASE_DELIVERABLE_STATUSES.NOT_APPLICABLE;
  mimicDeliverable.applicability_status = RELEASE_DELIVERABLE_APPLICABILITY.NOT_APPLICABLE;

  const blockers = buildFixtureReleaseBlockers([
    { stage_name: "Concept", status: "APPROVED" },
    { stage_name: "Release", status: "PENDING" },
  ], releasePackage);

  assert.ok(blockers.some((blocker) => (
    blocker.code === "DELIVERABLE_INCOMPLETE"
    && blocker.deliverable === RELEASE_DELIVERABLE_CODES.DRAFTING
  )));
  assert.equal(blockers.some((blocker) => (
    blocker.deliverable === RELEASE_DELIVERABLE_CODES.MIMIC_DISPLAY
  )), false);
});

test("eligible package creation is idempotent and audits only the creation", async () => {
  const mocks = installServiceMocks(null);
  try {
    const { ensureFixtureReleasePackage } = require("../services/fixtureReleaseDeliverablesService");
    const first = await ensureFixtureReleasePackage({ fixtureId: FIXTURE_ID, createdBy: "LEAD-1" });
    const second = await ensureFixtureReleasePackage({ fixtureId: FIXTURE_ID, createdBy: "LEAD-1" });

    assert.equal(first.id, second.id);
    assert.equal(first.deliverables.length, 10);
    assert.equal(mocks.getEnsureCalls(), 2);
    assert.deepEqual(mocks.audit.map((entry) => entry.actionType), ["FIXTURE_RELEASE_PACKAGE_CREATED"]);
  } finally {
    mocks.restore();
  }
});

test("repository keeps one package per release cycle and versions a reopened fixture", async () => {
  const { ensurePackageForApproved2D } = require("../repositories/fixtureReleaseDeliverablesRepository");

  const sameCycle = makePackageRepositoryClient();
  const first = await ensurePackageForApproved2D(
    { fixtureId: FIXTURE_ID, createdBy: "LEAD-1" },
    sameCycle.client,
  );
  const duplicate = await ensurePackageForApproved2D(
    { fixtureId: FIXTURE_ID, createdBy: "LEAD-1" },
    sameCycle.client,
  );
  assert.equal(first.created, true);
  assert.equal(duplicate.created, false);
  assert.equal(first.package.version, 1);
  assert.equal(duplicate.package.id, first.package.id);
  assert.deepEqual(sameCycle.state.insertedVersions, [1]);
  assert.ok(sameCycle.state.statements.some((statement) => statement.includes("FOR UPDATE OF fixture")));
  assert.ok(sameCycle.state.statements.some((statement) => statement.includes("ON CONFLICT (fixture_id, version) DO NOTHING")));
  assert.ok(sameCycle.state.statements.some((statement) => statement.includes("IN ('release', 'released')")));

  const reopenedWithoutPackage = makePackageRepositoryClient({
    snapshotAt: "2026-01-02T00:00:00.000Z",
  });
  const reopenedFirstPackage = await ensurePackageForApproved2D(
    { fixtureId: FIXTURE_ID, createdBy: "LEAD-1" },
    reopenedWithoutPackage.client,
  );
  assert.equal(reopenedFirstPackage.package.version, 1);

  const reopened = makePackageRepositoryClient({
    snapshotAt: "2026-01-02T00:00:00.000Z",
    packages: [{
      id: "00000000-0000-0000-0000-000000000001",
      fixture_id: FIXTURE_ID,
      project_id: PROJECT_ID,
      fixture_no: "FX-001",
      department_id: "design",
      version: 1,
      status: RELEASE_PACKAGE_STATUSES.READY_FOR_RELEASE,
      created_at: "2026-01-01T00:00:00.000Z",
    }],
  });
  const reopenedVersion = await ensurePackageForApproved2D(
    { fixtureId: FIXTURE_ID, createdBy: "LEAD-1" },
    reopened.client,
  );
  const reopenedDuplicate = await ensurePackageForApproved2D(
    { fixtureId: FIXTURE_ID, createdBy: "LEAD-1" },
    reopened.client,
  );
  assert.equal(reopenedVersion.package.version, 2);
  assert.equal(reopenedDuplicate.package.version, 2);
  assert.deepEqual(reopened.state.insertedVersions, [2]);

  const currentlyReleased = makePackageRepositoryClient({
    isWorkflowComplete: true,
    snapshotAt: "2026-01-02T00:00:00.000Z",
    packages: reopened.state.packages.slice(0, 1),
  });
  const blocked = await ensurePackageForApproved2D(
    { fixtureId: FIXTURE_ID, createdBy: "LEAD-1" },
    currentlyReleased.client,
  );
  assert.equal(blocked.created, false);
  assert.deepEqual(currentlyReleased.state.insertedVersions, []);
});

test("package loading returns assignee, approver, creator, and event actor names without N+1 queries", async () => {
  const queries = [];
  const event = {
    id: "event-1",
    event_type: "ASSIGNED",
    previous_status: "READY",
    new_status: "READY",
    actor_id: "LEAD-1",
    actor_name: "Release Leader",
    reason: null,
    metadata: { assignee_id: "EMP-1" },
    created_at: "2026-07-01T08:00:00.000Z",
  };
  const client = {
    query: async (sql) => {
      const statement = String(sql).replace(/\s+/g, " ").trim();
      queries.push(statement);
      if (statement.includes("FROM design.fixture_release_packages package")) {
        return {
          rows: [{
            id: "package-1",
            fixture_id: FIXTURE_ID,
            project_id: PROJECT_ID,
            department_id: "design",
            created_by: "LEAD-1",
            created_by_name: "Release Leader",
          }],
        };
      }
      if (statement.includes("WITH event_history AS")) {
        return {
          rows: [{
            id: "deliverable-1",
            package_id: "package-1",
            deliverable_code: RELEASE_DELIVERABLE_CODES.DRAFTING,
            sequence: 1,
            status: RELEASE_DELIVERABLE_STATUSES.READY,
            applicability_status: RELEASE_DELIVERABLE_APPLICABILITY.REQUIRED,
            assignee_id: "EMP-1",
            assignee_name: "2D Designer",
            approved_by: "LEAD-1",
            approved_by_name: "Release Leader",
            events: [event],
          }],
        };
      }
      throw new Error("Unexpected package load query");
    },
  };

  const { getPackageByFixtureId } = require("../repositories/fixtureReleaseDeliverablesRepository");
  const releasePackage = await getPackageByFixtureId(FIXTURE_ID, client);

  assert.equal(queries.length, 2);
  assert.match(queries[0], /package_creator\.name AS created_by_name/);
  assert.match(queries[1], /JSONB_AGG/);
  assert.match(queries[1], /fixture_release_deliverable_events/);
  assert.match(queries[1], /actor\.name/);
  assert.equal(releasePackage.created_by_name, "Release Leader");
  assert.equal(releasePackage.deliverables[0].assignee_name, "2D Designer");
  assert.equal(releasePackage.deliverables[0].approved_by_name, "Release Leader");
  assert.deepEqual(releasePackage.deliverables[0].events, [event]);
});

test("release package GET response is actor-specific and exposes summaries, blockers, overdue state, and history", async () => {
  const releasePackage = makePackage({
    assigneeByCode: {
      [RELEASE_DELIVERABLE_CODES.DRAFTING]: "EMP-1",
    },
  });
  Object.assign(releasePackage.deliverables[0], {
    assignee_name: "2D Designer",
    approved_by_name: "Release Leader",
    due_at: "2000-01-01T00:00:00.000Z",
    events: [{
      event_type: "ASSIGNED",
      actor_id: "LEAD-1",
      actor_name: "Release Leader",
      reason: null,
      created_at: "2026-07-01T08:00:00.000Z",
    }],
  });
  const progress = [
    { stage_name: "Concept", status: "APPROVED" },
    { stage_name: "DAP", status: "APPROVED" },
    { stage_name: "3D Finish", status: "APPROVED" },
    { stage_name: "2D Finish", status: "APPROVED" },
    { stage_name: "Release", status: "PENDING" },
  ];
  const mocks = installServiceMocks(releasePackage);

  try {
    const { getFixtureReleasePackageResponse } = require("../services/fixtureReleaseDeliverablesService");
    const leaderResponse = await getFixtureReleasePackageResponse(
      makeLeader(),
      FIXTURE_ID,
      progress,
    );
    const draftingForLeader = leaderResponse.release_package.deliverables[0];

    assert.deepEqual(leaderResponse.statuses.main_workflow, {
      code: "COMPLETED",
      label: "Completed",
    });
    assert.equal(leaderResponse.statuses.release_deliverables.code, "IN_PROGRESS");
    assert.equal(leaderResponse.statuses.release_deliverables.approved, 0);
    assert.equal(leaderResponse.statuses.release_deliverables.total, 9);
    assert.equal(leaderResponse.statuses.release.code, "BLOCKED");
    assert.equal(leaderResponse.statuses.release.label, "Blocked by deliverables");
    assert.equal(leaderResponse.available_actions.length, 0);
    assert.ok(leaderResponse.blockers.some(
      (blocker) => blocker.code === "MIMIC_APPLICABILITY_UNRESOLVED",
    ));
    assert.equal(draftingForLeader.deliverable_label, "Drafting");
    assert.equal(draftingForLeader.assignee_name, "2D Designer");
    assert.equal(draftingForLeader.approved_by_name, "Release Leader");
    assert.equal(draftingForLeader.is_overdue, true);
    assert.equal(draftingForLeader.is_current_actionable, true);
    assert.deepEqual(draftingForLeader.available_actions, ["ASSIGN"]);
    assert.equal(draftingForLeader.events[0].actor_name, "Release Leader");

    const memberResponse = await getFixtureReleasePackageResponse(
      makeMember(),
      FIXTURE_ID,
      progress,
    );
    assert.deepEqual(
      memberResponse.release_package.deliverables[0].available_actions,
      ["START"],
    );
    assert.equal(memberResponse.available_actions.length, 0);
  } finally {
    mocks.restore();
  }
});

test("ready release status exposes RELEASE only to an authorized actor", async () => {
  const statusByCode = Object.fromEntries(
    RELEASE_DELIVERABLE_DEFINITIONS.map((definition) => [
      definition.code,
      RELEASE_DELIVERABLE_STATUSES.APPROVED,
    ]),
  );
  const releasePackage = makePackage({
    status: RELEASE_PACKAGE_STATUSES.READY_FOR_RELEASE,
    statusByCode,
  });
  const mimic = releasePackage.deliverables.find(
    (deliverable) => deliverable.deliverable_code === RELEASE_DELIVERABLE_CODES.MIMIC_DISPLAY,
  );
  mimic.is_required = false;
  mimic.applicability_status = RELEASE_DELIVERABLE_APPLICABILITY.NOT_APPLICABLE;
  mimic.status = RELEASE_DELIVERABLE_STATUSES.NOT_APPLICABLE;

  const progress = [
    { stage_name: "Concept", status: "APPROVED" },
    { stage_name: "DAP", status: "APPROVED" },
    { stage_name: "3D Finish", status: "APPROVED" },
    { stage_name: "2D Finish", status: "APPROVED" },
    { stage_name: "Release", status: "PENDING" },
  ];
  const mocks = installServiceMocks(releasePackage);

  try {
    const { getFixtureReleasePackageResponse } = require("../services/fixtureReleaseDeliverablesService");
    const authorized = await getFixtureReleasePackageResponse(makeLeader(), FIXTURE_ID, progress);
    assert.deepEqual(authorized.statuses.release_deliverables, {
      code: "COMPLETE",
      label: "Complete",
      approved: 9,
      total: 9,
    });
    assert.deepEqual(authorized.statuses.release, {
      code: "READY_FOR_RELEASE",
      label: "Ready for Release",
      can_release: true,
    });
    assert.deepEqual(authorized.blockers, []);
    assert.deepEqual(authorized.available_actions, ["RELEASE"]);

    const unauthorized = await getFixtureReleasePackageResponse(makeMember(), FIXTURE_ID, progress);
    assert.equal(unauthorized.statuses.release.code, "READY_FOR_RELEASE");
    assert.equal(unauthorized.statuses.release.can_release, false);
    assert.deepEqual(unauthorized.available_actions, []);
  } finally {
    mocks.restore();
  }
});

test("schema backfill excludes historical project releases but keeps completed-unreleased legacy eligibility", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "repositories", "designSchemaRepository.js"),
    "utf8",
  );
  const backfillSql = source.match(/WITH normalized_progress AS \([\s\S]+?ON CONFLICT \(fixture_id, version\) DO NOTHING/)?.[0] || "";

  assert.match(backfillSql, /JOIN design\.projects project/);
  assert.match(backfillSql, /project\.status[\s\S]+NOT IN \('completed', 'released'\)/);
  assert.match(backfillSql, /project_release_snapshot\.id IS NULL[\s\S]+project\.is_modified[\s\S]+project\.updated_at > project_release_snapshot\.captured_at/);
  assert.match(backfillSql, /snapshot\.trigger[\s\S]+project_release/);
  assert.match(
    backfillSql,
    /COALESCE\(fixture\.is_workflow_complete, FALSE\) = TRUE\s+OR COALESCE\(progress\.has_approved_2d, FALSE\)/,
  );
});
test("assignment, assignee-only execution, approval, and sequential unlocking are enforced", async () => {
  const mocks = installServiceMocks();
  try {
    const service = require("../services/fixtureReleaseDeliverablesService");
    const leader = makeLeader();
    const member = makeMember();
    const otherMember = makeMember("EMP-2");

    await assert.rejects(
      () => service.assignReleaseDeliverable(member, FIXTURE_ID, "deliverable-1", { assignee_id: "EMP-1" }),
      (error) => error.statusCode === 403,
    );
    await service.assignReleaseDeliverable(leader, FIXTURE_ID, "deliverable-1", { assignee_id: "EMP-1" });
    await service.assignReleaseDeliverable(leader, FIXTURE_ID, "deliverable-2", { assignee_id: "EMP-1" });

    await assert.rejects(
      () => service.startReleaseDeliverable(member, FIXTURE_ID, "deliverable-2"),
      (error) => error.statusCode === 409 && /next eligible/i.test(error.message),
    );
    await assert.rejects(
      () => service.startReleaseDeliverable(otherMember, FIXTURE_ID, "deliverable-1"),
      (error) => error.statusCode === 403,
    );

    await service.startReleaseDeliverable(member, FIXTURE_ID, "deliverable-1");
    await service.submitReleaseDeliverable(member, FIXTURE_ID, "deliverable-1", { comment: "Ready" });
    const approved = await service.reviewReleaseDeliverable(leader, FIXTURE_ID, "deliverable-1", { decision: "APPROVE" });

    assert.equal(approved.deliverables[0].status, RELEASE_DELIVERABLE_STATUSES.APPROVED);
    assert.equal(approved.deliverables[1].status, RELEASE_DELIVERABLE_STATUSES.READY);
    assert.deepEqual(
      mocks.events.map((event) => event.eventType),
      ["ASSIGNED", "ASSIGNED", "STARTED", "SUBMITTED", "APPROVED"],
    );
  } finally {
    mocks.restore();
  }
});

test("assignment rejects cross-department users and overlength assignee IDs", async () => {
  const mocks = installServiceMocks(makePackage(), {
    assigneeFactory: (employeeId) => makeMember(employeeId, { department_id: "controls" }),
  });
  try {
    const { assignReleaseDeliverable } = require("../services/fixtureReleaseDeliverablesService");
    await assert.rejects(
      () => assignReleaseDeliverable(makeLeader(), FIXTURE_ID, "deliverable-1", {
        assignee_id: "EMP-1",
      }),
      (error) => error.statusCode === 400 && /Design 2D users/i.test(error.message),
    );
    await assert.rejects(
      () => assignReleaseDeliverable(makeLeader(), FIXTURE_ID, "deliverable-1", {
        assignee_id: "E".repeat(51),
      }),
      (error) => error.statusCode === 400 && /50 characters or fewer/i.test(error.message),
    );
  } finally {
    mocks.restore();
  }
});

test("rejection requires a reason and records CHANGES_REQUIRED", async () => {
  const releasePackage = makePackage({
    statusByCode: { [RELEASE_DELIVERABLE_CODES.DRAFTING]: RELEASE_DELIVERABLE_STATUSES.PENDING_APPROVAL },
    assigneeByCode: { [RELEASE_DELIVERABLE_CODES.DRAFTING]: "EMP-1" },
  });
  const mocks = installServiceMocks(releasePackage);
  try {
    const { reviewReleaseDeliverable } = require("../services/fixtureReleaseDeliverablesService");
    await assert.rejects(
      () => reviewReleaseDeliverable(makeLeader(), FIXTURE_ID, "deliverable-1", { decision: "REJECT" }),
      (error) => error.statusCode === 400 && /reason is required/i.test(error.message),
    );
    const result = await reviewReleaseDeliverable(makeLeader(), FIXTURE_ID, "deliverable-1", {
      decision: "REJECT",
      reason: "Correct the title block",
    });
    assert.equal(result.deliverables[0].status, RELEASE_DELIVERABLE_STATUSES.CHANGES_REQUIRED);
    assert.equal(result.deliverables[0].latest_comment, "Correct the title block");
  } finally {
    mocks.restore();
  }
});

test("an assignee cannot self-approve even with approver permission", async () => {
  const releasePackage = makePackage({
    statusByCode: { [RELEASE_DELIVERABLE_CODES.DRAFTING]: RELEASE_DELIVERABLE_STATUSES.PENDING_APPROVAL },
    assigneeByCode: { [RELEASE_DELIVERABLE_CODES.DRAFTING]: "LEAD-1" },
  });
  const mocks = installServiceMocks(releasePackage);
  try {
    const { reviewReleaseDeliverable } = require("../services/fixtureReleaseDeliverablesService");
    await assert.rejects(
      () => reviewReleaseDeliverable(makeLeader(), FIXTURE_ID, "deliverable-1", { decision: "APPROVE" }),
      (error) => error.statusCode === 403 && /cannot approve or reject.*own/i.test(error.message),
    );
  } finally {
    mocks.restore();
  }
});

function packageReadyForMimic() {
  const statusByCode = {};
  RELEASE_DELIVERABLE_DEFINITIONS.slice(0, 8).forEach((definition) => {
    statusByCode[definition.code] = RELEASE_DELIVERABLE_STATUSES.APPROVED;
  });
  return makePackage({ statusByCode });
}

test("Mimic Display Required becomes READY and keeps Wear-Out locked", async () => {
  const mocks = installServiceMocks(packageReadyForMimic());
  try {
    const { resolveMimicApplicability } = require("../services/fixtureReleaseDeliverablesService");
    const result = await resolveMimicApplicability(makeLeader(), FIXTURE_ID, "deliverable-9", {
      applicability: "REQUIRED",
    });
    assert.equal(result.deliverables[8].applicability_status, RELEASE_DELIVERABLE_APPLICABILITY.REQUIRED);
    assert.equal(result.deliverables[8].status, RELEASE_DELIVERABLE_STATUSES.READY);
    assert.equal(result.deliverables[9].status, RELEASE_DELIVERABLE_STATUSES.LOCKED);
  } finally {
    mocks.restore();
  }
});

test("Mimic Display Not Applicable requires a reason and unlocks Wear-Out", async () => {
  const mocks = installServiceMocks(packageReadyForMimic());
  try {
    const { resolveMimicApplicability } = require("../services/fixtureReleaseDeliverablesService");
    await assert.rejects(
      () => resolveMimicApplicability(makeLeader(), FIXTURE_ID, "deliverable-9", {
        applicability: "NOT_APPLICABLE",
      }),
      (error) => error.statusCode === 400 && /reason is required/i.test(error.message),
    );
    const result = await resolveMimicApplicability(makeLeader(), FIXTURE_ID, "deliverable-9", {
      applicability: "NOT_APPLICABLE",
      reason: "Fixture has no operator mimic",
    });
    assert.equal(result.deliverables[8].status, RELEASE_DELIVERABLE_STATUSES.NOT_APPLICABLE);
    assert.equal(result.deliverables[9].status, RELEASE_DELIVERABLE_STATUSES.READY);
  } finally {
    mocks.restore();
  }
});
