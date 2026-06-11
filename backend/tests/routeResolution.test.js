const assert = require("node:assert/strict");
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
