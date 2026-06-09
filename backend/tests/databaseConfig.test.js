const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildDatabasePoolConfig,
  resolveDatabaseUrlConfig,
} = require("../config/database");

test("database pool config resolves the database name from DATABASE_URL", () => {
  const config = buildDatabasePoolConfig({
    databaseUrl: "postgresql://parc_user:secret@localhost:5432/parc_task_tracker",
    databaseSsl: "false",
  });

  assert.equal(config.connectionString, "postgresql://parc_user:secret@localhost:5432/parc_task_tracker");
  assert.equal(config.database, "parc_task_tracker");
  assert.equal(config.ssl, false);
});

test("database URL validation rejects pg's username-as-database fallback shape", () => {
  assert.throws(
    () => resolveDatabaseUrlConfig("postgresql://parc_user:secret@localhost:5432"),
    /explicit database name/,
  );

  assert.throws(
    () => resolveDatabaseUrlConfig("postgresql://parc_user:secret@localhost:5432/"),
    /explicit database name/,
  );
});

test("database URL validation rejects unsupported URL values", () => {
  assert.throws(
    () => resolveDatabaseUrlConfig(""),
    /DATABASE_URL is required/,
  );

  assert.throws(
    () => resolveDatabaseUrlConfig("mysql://user:secret@localhost:3306/app"),
    /postgres/,
  );
});
