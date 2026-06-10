const assert = require("node:assert/strict");
const test = require("node:test");

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://user:pass@localhost:5432/tasktracker_test";

const {
  shouldHideProjectFromActiveSelection,
} = require("../services/projectCatalogService");

test("active modified projects remain available for project fixture assignment", async () => {
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
  assert.equal(await shouldHideProjectFromActiveSelection({
    project_status: "active",
    is_modified: false,
    completion_percent: 100,
    total_fixtures: 5,
    completed_tasks: 5,
  }), true);
});

test("terminal projects stay hidden even when marked modified", async () => {
  assert.equal(await shouldHideProjectFromActiveSelection({
    project_status: "completed",
    is_modified: true,
    completion_percent: 100,
  }), true);
});
