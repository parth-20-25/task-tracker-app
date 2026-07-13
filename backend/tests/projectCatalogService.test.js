const assert = require("node:assert/strict");
const test = require("node:test");

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://user:pass@localhost:5432/tasktracker_test";

function clearProjectCatalogServiceCache() {
  delete require.cache[require.resolve("../services/projectCatalogService")];
}

function loadProjectCatalogService() {
  clearProjectCatalogServiceCache();
  return require("../services/projectCatalogService");
}

function installOutsourceMocks() {
  const db = require("../db");
  const projectRepository = require("../repositories/designProjectCatalogRepository");
  const auditRepository = require("../repositories/auditRepository");

  const originals = {
    connect: db.pool.connect,
    findFixtureByIdForUser: projectRepository.findFixtureByIdForUser,
    upsertFixtureOutsourceRecord: projectRepository.upsertFixtureOutsourceRecord,
    markFixtureOutsourceBroughtInHouse: projectRepository.markFixtureOutsourceBroughtInHouse,
    touchProject: projectRepository.touchProject,
    createAuditLog: auditRepository.createAuditLog,
  };

  const queries = [];
  const calls = {
    upsert: [],
    broughtInHouse: [],
    touchedProjects: [],
    audit: [],
  };
  const visibleFixture = {
    fixture_id: "fixture-1",
    project_id: "project-1",
    department_id: "design",
    fixture_no: "F-001",
    is_outsourced: false,
    vendor_name: null,
  };
  const updatedFixture = {
    ...visibleFixture,
    is_outsourced: true,
    vendor_name: "Supplier X",
    outsourced_stages: ["Concept", "3D", "2D"],
    outsource_status: "outsourced",
  };
  let findFixtureCalls = 0;
  const client = {
    query: async (sql) => {
      queries.push(String(sql).trim());
      return { rows: [], rowCount: 0 };
    },
    release: () => {
      queries.push("RELEASE");
    },
  };

  db.pool.connect = async () => client;
  projectRepository.findFixtureByIdForUser = async () => {
    findFixtureCalls += 1;
    return findFixtureCalls === 1 ? visibleFixture : updatedFixture;
  };
  projectRepository.upsertFixtureOutsourceRecord = async (entry, txClient) => {
    assert.equal(txClient, client);
    calls.upsert.push(entry);
    return {
      fixture_id: entry.fixtureId,
      supplier_name: entry.supplierName,
      outsourced_stages: entry.outsourcedStages,
      outsource_status: "outsourced",
    };
  };
  projectRepository.markFixtureOutsourceBroughtInHouse = async (entry, txClient) => {
    assert.equal(txClient, client);
    calls.broughtInHouse.push(entry);
    return {
      fixture_id: entry.fixtureId,
      outsource_status: "brought_in_house",
    };
  };
  projectRepository.touchProject = async (projectId, txClient) => {
    assert.equal(txClient, client);
    calls.touchedProjects.push(projectId);
  };
  auditRepository.createAuditLog = async (entry, txClient) => {
    assert.equal(txClient, client);
    calls.audit.push(entry);
  };

  clearProjectCatalogServiceCache();

  return {
    calls,
    queries,
    restore() {
      db.pool.connect = originals.connect;
      projectRepository.findFixtureByIdForUser = originals.findFixtureByIdForUser;
      projectRepository.upsertFixtureOutsourceRecord = originals.upsertFixtureOutsourceRecord;
      projectRepository.markFixtureOutsourceBroughtInHouse = originals.markFixtureOutsourceBroughtInHouse;
      projectRepository.touchProject = originals.touchProject;
      auditRepository.createAuditLog = originals.createAuditLog;
      clearProjectCatalogServiceCache();
    },
  };
}

function installAssignmentMocks(stageName, options = {}) {
  const db = require("../db");
  const projectRepository = require("../repositories/designProjectCatalogRepository");
  const workflowRepository = require("../repositories/fixtureWorkflowRepository");
  const contributionRepository = require("../repositories/designStageContributionRepository");
  const auditRepository = require("../repositories/auditRepository");
  const taskService = require("../services/taskService");
  const fixtureWorkflowService = require("../services/fixtureWorkflowService");
  const subdivisionRoutingRepository = require("../repositories/projectSubdivisionRoutingRepository");
  const usersRepository = require("../repositories/usersRepository");

  const originals = {
    connect: db.pool.connect,
    findProjectByIdForUser: projectRepository.findProjectByIdForUser,
    listProjectSummariesForUser: projectRepository.listProjectSummariesForUser,
    findFixtureAssignmentContextByIdForUser: projectRepository.findFixtureAssignmentContextByIdForUser,
    findFixtureByIdForUser: projectRepository.findFixtureByIdForUser,
    getConfiguredWorkflowForDepartment: workflowRepository.getConfiguredWorkflowForDepartment,
    getProgressForFixture: workflowRepository.getProgressForFixture,
    updateProgressRow: workflowRepository.updateProgressRow,
    startStageAttempt: workflowRepository.startStageAttempt,
    listStageContributions: contributionRepository.listStageContributions,
    insertStageContribution: contributionRepository.insertStageContribution,
    createAuditLog: auditRepository.createAuditLog,
    createTaskForUser: taskService.createTaskForUser,
    getCurrentStage: fixtureWorkflowService.getCurrentStage,
    projectHasActive2DRouting: subdivisionRoutingRepository.projectHasActive2DRouting,
    listAssigned2DLeaderTeamEmployeeIds: subdivisionRoutingRepository.listAssigned2DLeaderTeamEmployeeIds,
    findUserByEmployeeId: usersRepository.findUserByEmployeeId,
  };

  const calls = {
    assignmentFixtureLookup: 0,
    outsourceFixtureLookup: 0,
    progressUpdates: [],
    stageAttempts: [],
    contributions: [],
    tasks: [],
    audits: [],
    tx: [],
  };

  const client = {
    query: async (sql) => {
      const normalizedSql = String(sql).trim();
      calls.tx.push(normalizedSql);
      return { rows: [], rowCount: 0 };
    },
    release: () => calls.tx.push("RELEASE"),
  };

  const project = {
    project_id: "project-1",
    project_code: "PRJ-1",
    project_name: "Project One",
    company_name: "Customer One",
    department_id: "design",
  };
  const fixture = {
    fixture_id: "11111111-1111-1111-1111-111111111111",
    project_id: project.project_id,
    department_id: "design",
    fixture_no: "FX-001",
    part_name: "Fixture One",
    qty: 1,
  };
  const workflowStage = { id: `stage-${stageName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, name: stageName };
  const progressRow = {
    fixture_id: fixture.fixture_id,
    department_id: "design",
    stage_name: stageName,
    stage_order: 1,
    stage_version: 0,
    status: "PENDING",
  };
  const lockedProgressRow = {
    ...progressRow,
    stage_name: options.lockedStageName || progressRow.stage_name,
  };

  db.pool.connect = async () => client;
  projectRepository.findProjectByIdForUser = async () => project;
  projectRepository.listProjectSummariesForUser = async () => [{
    project_id: project.project_id,
    project_status: "active",
    is_modified: false,
    completion_percent: 0,
    total_fixtures: 1,
    completed_tasks: 0,
  }];
  projectRepository.findFixtureAssignmentContextByIdForUser = async () => {
    calls.assignmentFixtureLookup += 1;
    return fixture;
  };
  projectRepository.findFixtureByIdForUser = async () => {
    calls.outsourceFixtureLookup += 1;
    const error = new Error('relation "design.fixture_outsource_records" does not exist');
    error.code = "42P01";
    throw error;
  };
  workflowRepository.getConfiguredWorkflowForDepartment = async () => ({
    id: "workflow-design",
    stages: [workflowStage],
  });
  workflowRepository.getProgressForFixture = async () => [lockedProgressRow];
  workflowRepository.updateProgressRow = async (fixtureId, updatedStageName, fields, txClient) => {
    assert.equal(txClient, client);
    calls.progressUpdates.push({ fixtureId, stageName: updatedStageName, fields });
  };
  workflowRepository.startStageAttempt = async (fixtureId, departmentId, updatedStageName, assignedTo, timestamp, txClient) => {
    assert.equal(txClient, client);
    calls.stageAttempts.push({ fixtureId, departmentId, stageName: updatedStageName, assignedTo, timestamp });
  };
  contributionRepository.listStageContributions = async () => [];
  contributionRepository.insertStageContribution = async (entry, txClient) => {
    assert.equal(txClient, client);
    if (options.failContributionInsert) {
      throw new Error("contribution storage unavailable");
    }
    calls.contributions.push(entry);
  };
  taskService.createTaskForUser = async (_user, payload, options) => {
    assert.equal(options.client, client);
    calls.tasks.push(payload);
    return { id: calls.tasks.length, ...payload, status: "assigned" };
  };
  auditRepository.createAuditLog = async (entry, txClient) => {
    assert.equal(txClient, client);
    calls.audits.push(entry);
  };
  fixtureWorkflowService.getCurrentStage = async () => ({
    stage: stageName,
    stage_order: 1,
    status: "PENDING",
    is_complete: false,
  });
  subdivisionRoutingRepository.projectHasActive2DRouting = async () => false;
  subdivisionRoutingRepository.listAssigned2DLeaderTeamEmployeeIds = async () => ["DES-1", "DES-2", "DES-3"];
  usersRepository.findUserByEmployeeId = async (employeeId) => ({
    employee_id: employeeId,
    department_id: "design",
    is_active: true,
    subdivision: {
      subdivision_name: "2D",
    },
  });

  clearProjectCatalogServiceCache();

  return {
    calls,
    restore() {
      db.pool.connect = originals.connect;
      projectRepository.findProjectByIdForUser = originals.findProjectByIdForUser;
      projectRepository.listProjectSummariesForUser = originals.listProjectSummariesForUser;
      projectRepository.findFixtureAssignmentContextByIdForUser = originals.findFixtureAssignmentContextByIdForUser;
      projectRepository.findFixtureByIdForUser = originals.findFixtureByIdForUser;
      workflowRepository.getConfiguredWorkflowForDepartment = originals.getConfiguredWorkflowForDepartment;
      workflowRepository.getProgressForFixture = originals.getProgressForFixture;
      workflowRepository.updateProgressRow = originals.updateProgressRow;
      workflowRepository.startStageAttempt = originals.startStageAttempt;
      contributionRepository.listStageContributions = originals.listStageContributions;
      contributionRepository.insertStageContribution = originals.insertStageContribution;
      auditRepository.createAuditLog = originals.createAuditLog;
      taskService.createTaskForUser = originals.createTaskForUser;
      fixtureWorkflowService.getCurrentStage = originals.getCurrentStage;
      subdivisionRoutingRepository.projectHasActive2DRouting = originals.projectHasActive2DRouting;
      subdivisionRoutingRepository.listAssigned2DLeaderTeamEmployeeIds = originals.listAssigned2DLeaderTeamEmployeeIds;
      usersRepository.findUserByEmployeeId = originals.findUserByEmployeeId;
      clearProjectCatalogServiceCache();
    },
  };
}

test("design assignment still creates task when contribution tracking fails", async () => {
  const mocks = installAssignmentMocks("Concept", { failContributionInsert: true });

  try {
    const { createDesignTaskFromProject } = require("../services/projectCatalogService");
    const task = await createDesignTaskFromProject(
      {
        employee_id: "MGR-1",
        department_id: "design",
        role: { id: "r1", role_key: "admin" },
      },
      {
        department_id: "design",
        project_id: "project-1",
        fixture_id: "11111111-1111-1111-1111-111111111111",
        description: "Fixture One",
        assigned_to: "DES-1",
        assignee_ids: ["DES-1"],
        priority: "high",
        deadline: "2026-06-12T23:59:59.999Z",
      },
    );

    assert.equal(task.id, 1);
    assert.equal(mocks.calls.contributions.length, 0);
    assert.equal(mocks.calls.tasks.length, 1);
    assert.equal(mocks.calls.audits.length, 1);
    assert.ok(mocks.calls.tx.includes("COMMIT"));
    assert.equal(mocks.calls.tx.includes("ROLLBACK"), false);
  } finally {
    mocks.restore();
  }
});

test("active modified projects remain available for project fixture assignment", async () => {
  const { shouldHideProjectFromActiveSelection } = loadProjectCatalogService();

  assert.equal(await shouldHideProjectFromActiveSelection({
    project_status: "active",
    is_modified: true,
    completion_percent: 100,
    completion_strict_complete: true,
    total_fixtures: 5,
    completed_tasks: 5,
  }), false);
});

for (const stageName of ["Concept", "DAP", "3D Finish", "2D Finish"]) {
  test(`design assignment creates ${stageName} task without requiring outsource display tables`, async () => {
    const mocks = installAssignmentMocks(stageName);

    try {
      const { createDesignTaskFromProject } = require("../services/projectCatalogService");
      const task = await createDesignTaskFromProject(
        {
          employee_id: "MGR-1",
          department_id: "design",
          role: { id: "r1", role_key: "admin" },
        },
        {
          department_id: "design",
          project_id: "project-1",
          fixture_id: "11111111-1111-1111-1111-111111111111",
          description: "Fixture One",
          assigned_to: "DES-1",
          assignee_ids: ["DES-1"],
          priority: "high",
          deadline: "2026-06-12T23:59:59.999Z",
        },
      );

      assert.equal(task.id, 1);
      assert.equal(mocks.calls.assignmentFixtureLookup, 1);
      assert.equal(mocks.calls.outsourceFixtureLookup, 0);
      assert.equal(mocks.calls.progressUpdates.length, 1);
      assert.equal(mocks.calls.progressUpdates[0].stageName, stageName);
      assert.equal(mocks.calls.progressUpdates[0].fields.status, "IN_PROGRESS");
      assert.equal(mocks.calls.stageAttempts.length, 1);
      assert.equal(mocks.calls.stageAttempts[0].stageName, stageName);
      assert.equal(mocks.calls.contributions.length, 1);
      assert.equal(mocks.calls.tasks.length, 1);
      assert.equal(mocks.calls.tasks[0].current_stage_id, `stage-${stageName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`);
      assert.equal(mocks.calls.audits.length, 1);
      assert.ok(mocks.calls.tx.includes("BEGIN"));
      assert.ok(mocks.calls.tx.includes("COMMIT"));
      assert.equal(mocks.calls.tx.includes("ROLLBACK"), false);
    } finally {
      mocks.restore();
    }
  });
}

test("2D assignment supports multiple assignees with trackable contribution rows", async () => {
  const mocks = installAssignmentMocks("2D Finish");

  try {
    const { createDesignTaskFromProject } = require("../services/projectCatalogService");
    const task = await createDesignTaskFromProject(
      {
        employee_id: "MGR-1",
        department_id: "design",
        role: { id: "r1", role_key: "admin" },
      },
      {
        department_id: "design",
        project_id: "project-1",
        fixture_id: "11111111-1111-1111-1111-111111111111",
        description: "Fixture One",
        assigned_to: "DES-1",
        assignee_ids: ["DES-1", "DES-2", "DES-3"],
        priority: "high",
        deadline: "2026-06-12T23:59:59.999Z",
      },
    );

    assert.equal(task.id, 1);
    assert.deepEqual(mocks.calls.tasks[0].assignee_ids, ["DES-1", "DES-2", "DES-3"]);
    assert.deepEqual(mocks.calls.contributions.map((row) => row.employee_id), ["DES-1", "DES-2", "DES-3"]);
    assert.equal(
      Math.round(mocks.calls.contributions.reduce((sum, row) => sum + Number(row.contribution_percent), 0) * 100) / 100,
      100,
    );
  } finally {
    mocks.restore();
  }
});

test("design assignment rechecks and rejects Release after locking workflow progress", async () => {
  const mocks = installAssignmentMocks("2D Finish", { lockedStageName: "Release" });

  try {
    const { createDesignTaskFromProject } = require("../services/projectCatalogService");
    await assert.rejects(
      () => createDesignTaskFromProject(
        {
          employee_id: "MGR-1",
          department_id: "design",
          role: { id: "r1", role_key: "admin" },
        },
        {
          department_id: "design",
          project_id: "project-1",
          fixture_id: "11111111-1111-1111-1111-111111111111",
          assigned_to: "DES-1",
        },
      ),
      /Release is not a task assignment stage/,
    );

    assert.equal(mocks.calls.progressUpdates.length, 0);
    assert.equal(mocks.calls.tasks.length, 0);
    assert.ok(mocks.calls.tx.includes("ROLLBACK"));
  } finally {
    mocks.restore();
  }
});

for (const stageName of ["Concept", "DAP", "3D Finish"]) {
  test(`design assignment rejects multiple assignees for ${stageName}`, async () => {
    const mocks = installAssignmentMocks(stageName);

    try {
      const { createDesignTaskFromProject } = require("../services/projectCatalogService");
      await assert.rejects(
        () => createDesignTaskFromProject(
          {
            employee_id: "MGR-1",
            department_id: "design",
            role: { id: "r1", role_key: "admin" },
          },
          {
            department_id: "design",
            project_id: "project-1",
            fixture_id: "11111111-1111-1111-1111-111111111111",
            description: "Fixture One",
            assigned_to: "DES-1",
            assignee_ids: ["DES-1", "DES-2"],
            priority: "high",
            deadline: "2026-06-12T23:59:59.999Z",
          },
        ),
        /Multiple assignees are only supported for 2D/,
      );
      assert.equal(mocks.calls.tasks.length, 0);
      assert.ok(mocks.calls.tx.includes("ROLLBACK"));
    } finally {
      mocks.restore();
    }
  });
}

test("unmodified completed active projects stay hidden from active assignment", async () => {
  const { shouldHideProjectFromActiveSelection } = loadProjectCatalogService();

  assert.equal(await shouldHideProjectFromActiveSelection({
    project_status: "active",
    is_modified: false,
    completion_percent: 100,
    total_fixtures: 5,
    completed_tasks: 5,
  }), true);
});

test("terminal projects stay hidden even when marked modified", async () => {
  const { shouldHideProjectFromActiveSelection } = loadProjectCatalogService();

  assert.equal(await shouldHideProjectFromActiveSelection({
    project_status: "completed",
    is_modified: true,
    completion_percent: 100,
  }), true);
});

test("legacy outsourcing toggle defaults omitted stages to all outsourceable workflow stages", async () => {
  const mocks = installOutsourceMocks();

  try {
    const { updateFixtureOutsourcingForUser } = require("../services/projectCatalogService");
    const result = await updateFixtureOutsourcingForUser(
      { employee_id: "MGR-1" },
      "fixture-1",
      {
        is_outsourced: true,
        supplier_name: " Supplier X ",
      },
    );

    assert.equal(result.is_outsourced, true);
    assert.equal(mocks.calls.upsert.length, 1);
    assert.deepEqual(mocks.calls.upsert[0], {
      fixtureId: "fixture-1",
      supplierName: "Supplier X",
      outsourcedStages: ["Concept", "3D", "2D"],
      changedBy: "MGR-1",
    });
    assert.deepEqual(mocks.calls.touchedProjects, ["project-1"]);
    assert.equal(mocks.calls.audit[0].actionType, "DESIGN_FIXTURE_OUTSOURCED");
    assert.ok(mocks.queries.includes("BEGIN"));
    assert.ok(mocks.queries.includes("COMMIT"));
  } finally {
    mocks.restore();
  }
});

test("outsourcing toggle accepts string false payloads from older clients", async () => {
  const mocks = installOutsourceMocks();

  try {
    const { updateFixtureOutsourcingForUser } = require("../services/projectCatalogService");
    await updateFixtureOutsourcingForUser(
      { employee_id: "MGR-1" },
      "fixture-1",
      { is_outsourced: "false" },
    );

    assert.equal(mocks.calls.upsert.length, 0);
    assert.deepEqual(mocks.calls.broughtInHouse, [{
      fixtureId: "fixture-1",
      changedBy: "MGR-1",
    }]);
  } finally {
    mocks.restore();
  }
});
