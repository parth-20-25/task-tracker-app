const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://user:pass@localhost:5432/tasktracker_test";

const { createApp } = require("../app");

function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => resolve(server));
    server.on("error", reject);
  });
}

test("task detail API route resolves before auth instead of returning Express 404", async () => {
  const server = await listen(createApp());

  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/tasks/123`);

    assert.equal(response.status, 401);
    assert.match(await response.text(), /No token provided/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("native ingestion API routes are mounted by createApp before auth", async () => {
  const server = await listen(createApp());

  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/design/native-ingestion/template`);

    assert.equal(response.status, 401);
    assert.match(await response.text(), /No token provided/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("legacy fixture upload route returns retired 410 instead of authorizing legacy upload", async () => {
  const server = await listen(createApp());

  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/upload/design-excel`, {
      method: "POST",
    });
    const body = await response.json();

    assert.equal(response.status, 410);
    assert.equal(body.message, "Legacy fixture upload has been retired. Use native fixture upload.");
    assert.equal(body.details.replacement, "/api/design/native-ingestion/sessions");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("production server app retires legacy fixture upload before auth", async () => {
  const { app: productionApp } = require("../server");
  const server = await listen(productionApp);

  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/upload/design-excel`, {
      method: "POST",
    });

    assert.equal(response.status, 410);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("analytics overview API route is mounted by createApp before auth", async () => {
  const server = await listen(createApp());

  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/analytics/overview`);

    assert.equal(response.status, 401);
    assert.match(await response.text(), /No token provided/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("project reactivation API route resolves before auth instead of returning Express 404", async () => {
  const server = await listen(createApp());

  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/design/projects/project-1/reactivate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "other" }),
    });

    assert.equal(response.status, 401);
    assert.match(await response.text(), /No token provided/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
test("2D completion assignment API route resolves before auth", async () => {
  const server = await listen(createApp());

  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/design/2d-completion-tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_id: "project-1",
        fixture_id: "fixture-1",
        task_code: "FIXTURE_IGES",
        assigned_to: "940",
        priority: "medium",
        deadline: "2099-01-01T00:00:00.000Z",
      }),
    });

    assert.equal(response.status, 401);
    assert.match(await response.text(), /No token provided/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
test("bulk fixture outsource API route resolves before auth", async () => {
  const server = await listen(createApp());

  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/design/fixtures/outsource/bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: "project-1", fixtureIds: [], outsourceData: {} }),
    });

    assert.equal(response.status, 401);
    assert.match(await response.text(), /No token provided/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
test("control workflow API routes are mounted by createApp before auth", async () => {
  const server = await listen(createApp());

  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/control/sub-departments`);

    assert.equal(response.status, 401);
    assert.match(await response.text(), /No token provided/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("project scope API routes are mounted by createApp before auth", async () => {
  const server = await listen(createApp());

  try {
    const { port } = server.address();
    for (const path of ["/api/project-scope", "/api/project-planning/pending"]) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`);

      assert.equal(response.status, 401);
      assert.match(await response.text(), /No token provided/);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("removed feature API paths return 404 before authentication", async () => {
  const server = await listen(createApp());

  try {
    const { port } = server.address();
    for (const removedPath of ["/api/issues", "/api/issues/123/comments", "/api/shifts", "/api/machines/123"]) {
      const response = await fetch(`http://127.0.0.1:${port}${removedPath}`);
      assert.equal(response.status, 404, removedPath);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("active bootstrap and permissions no longer recreate removed features", () => {
  const bootstrap = fs.readFileSync(path.join(__dirname, "..", "repositories", "bootstrapRepository.js"), "utf8");
  const constants = fs.readFileSync(path.join(__dirname, "..", "config", "constants.js"), "utf8");

  for (const obsolete of [
    "CREATE TABLE IF NOT EXISTS issues",
    "CREATE TABLE IF NOT EXISTS issue_comments",
    "CREATE TABLE IF NOT EXISTS shifts",
    "CREATE TABLE IF NOT EXISTS machines",
    "ADD COLUMN IF NOT EXISTS shift_id",
    "ADD COLUMN IF NOT EXISTS machine_id",
    "ADD COLUMN IF NOT EXISTS machine_name",
    "can_manage_shifts",
    "can_manage_machines",
  ]) {
    assert.equal(bootstrap.includes(obsolete) || constants.includes(obsolete), false, obsolete);
  }
});

test("forward cleanup migration drops only feature-owned schema in dependency order", () => {
  const migration = fs.readFileSync(path.join(__dirname, "..", "migrations", "20260731_remove_issues_shifts_machines.sql"), "utf8");

  assert.ok(migration.indexOf("DROP TABLE IF EXISTS issue_comments") < migration.indexOf("DROP TABLE IF EXISTS issues"));
  assert.match(migration, /DROP COLUMN IF EXISTS shift_id/);
  assert.match(migration, /DROP COLUMN IF EXISTS machine_id/);
  assert.match(migration, /DELETE FROM role_permissions/);
  assert.doesNotMatch(migration, /DROP TABLE[^;]+CASCADE/i);
  assert.match(migration, /COMMIT;\s*$/);
});
