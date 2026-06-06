const assert = require("node:assert/strict");
const test = require("node:test");

const { resolveDatabaseSslConfig } = require("../lib/databaseSsl");

test("database SSL is disabled automatically for local Postgres", () => {
  assert.equal(
    resolveDatabaseSslConfig({
      databaseUrl: "postgres://user:pass@localhost:5432/tasktracker",
    }),
    false,
  );
});

test("database SSL can be disabled explicitly for local VM deployments", () => {
  assert.equal(
    resolveDatabaseSslConfig({
      databaseUrl: "postgres://user:pass@db.example.com:5432/tasktracker",
      databaseSsl: "false",
    }),
    false,
  );
});

test("database SSL stays enabled for non-local database hosts by default", () => {
  assert.deepEqual(
    resolveDatabaseSslConfig({
      databaseUrl: "postgres://user:pass@db.example.com:5432/tasktracker",
    }),
    { rejectUnauthorized: false },
  );
});

test("database SSL honors sslmode query parameters", () => {
  assert.equal(
    resolveDatabaseSslConfig({
      databaseUrl: "postgres://user:pass@db.example.com:5432/tasktracker?sslmode=disable",
    }),
    false,
  );

  assert.deepEqual(
    resolveDatabaseSslConfig({
      databaseUrl: "postgres://user:pass@localhost:5432/tasktracker?sslmode=require",
    }),
    { rejectUnauthorized: false },
  );
});
