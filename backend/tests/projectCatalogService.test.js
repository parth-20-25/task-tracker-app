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
