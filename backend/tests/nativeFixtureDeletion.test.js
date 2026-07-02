const assert = require("node:assert/strict");
const test = require("node:test");

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://user:pass@localhost:5432/tasktracker_test";

const { pool } = require("../db");
const { deleteNativeProjectFixture } = require("../services/nativeIngestion/sessionService");

function makeUser() {
  return {
    employee_id: "LEAD-1",
    department_id: "design",
    role: { id: "team_leader", name: "Team Leader", permissions: {} },
    permissions: [],
  };
}

function installFakeClient(handler) {
  const originalConnect = pool.connect;
  const calls = [];
  const client = {
    async query(sql, params = []) {
      const compactSql = String(sql).replace(/\s+/g, " ").trim();
      calls.push({ sql: compactSql, params });
      return handler(compactSql, params);
    },
    release() {},
  };
  pool.connect = async () => client;
  return {
    calls,
    restore() {
      pool.connect = originalConnect;
    },
  };
}

test("native fixture delete blocks active task references", async () => {
  const fake = installFakeClient((sql) => {
    if (["BEGIN", "ROLLBACK"].includes(sql)) return { rowCount: 0, rows: [] };
    if (sql.includes("FROM design.fixtures f")) {
      return {
        rowCount: 1,
        rows: [{
          fixture_id: "fixture-1",
          project_id: "project-1",
          fixture_no: "FX-1",
          project_no: "P-001",
          department_id: "design",
        }],
      };
    }
    if (sql.includes("FROM tasks")) return { rowCount: 1, rows: [{ total_count: 1, active_count: 1 }] };
    if (sql.includes("FROM fixture_workflow_progress")) return { rowCount: 1, rows: [{ touched_count: 0 }] };
    if (sql.includes("SELECT COUNT(*)")) return { rowCount: 1, rows: [{ count: 0 }] };
    throw new Error(`Unexpected SQL: ${sql}`);
  });

  try {
    await assert.rejects(
      () => deleteNativeProjectFixture(makeUser(), "fixture-1", { department_id: "design" }),
      (error) => error.statusCode === 409 && error.errorCode === "FIXTURE_DELETE_BLOCKED" && /active task/.test(error.message),
    );
    assert.equal(fake.calls.some((call) => call.sql.includes("DELETE FROM design.fixtures")), false);
    assert.equal(fake.calls.some((call) => call.sql === "ROLLBACK"), true);
  } finally {
    fake.restore();
  }
});

test("native fixture delete hard deletes when no dependencies exist", async () => {
  const fake = installFakeClient((sql) => {
    if (["BEGIN", "COMMIT"].includes(sql)) return { rowCount: 0, rows: [] };
    if (sql.includes("FROM design.fixtures f")) {
      return {
        rowCount: 1,
        rows: [{
          fixture_id: "fixture-1",
          project_id: "project-1",
          fixture_no: "FX-1",
          project_no: "P-001",
          department_id: "design",
        }],
      };
    }
    if (sql.includes("FROM tasks")) return { rowCount: 1, rows: [{ total_count: 0, active_count: 0 }] };
    if (sql.includes("FROM fixture_workflow_progress")) return { rowCount: 1, rows: [{ touched_count: 0 }] };
    if (sql.includes("SELECT COUNT(*)") || sql.includes("FROM design.fixture_stage_contributions") || sql.includes("FROM design.workflow_completion_snapshots")) {
      return { rowCount: 1, rows: [{ count: 0 }] };
    }
    if (sql.includes("DELETE FROM fixture_workflow")) return { rowCount: 1, rows: [] };
    if (sql.includes("DELETE FROM design.fixtures")) return { rowCount: 1, rows: [] };
    if (sql.includes("INSERT INTO audit_logs")) return { rowCount: 1, rows: [] };
    throw new Error(`Unexpected SQL: ${sql}`);
  });

  try {
    const result = await deleteNativeProjectFixture(makeUser(), "fixture-1", { department_id: "design" });

    assert.deepEqual(result, {
      deleted: true,
      fixture_id: "fixture-1",
      fixture_no: "FX-1",
      project_id: "project-1",
    });
    assert.equal(fake.calls.some((call) => call.sql.includes("DELETE FROM design.fixtures")), true);
    assert.equal(fake.calls.some((call) => call.sql === "COMMIT"), true);
  } finally {
    fake.restore();
  }
});