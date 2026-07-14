const assert = require("node:assert/strict");
const test = require("node:test");

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://user:pass@localhost:5432/tasktracker_test";

const { owningLeaderPairSql } = require("../repositories/projectVisibility");
const { requireOwningLeaderPair } = require("../services/accessControlService");

test("owning Leader/Co-Leader predicate is direct, symmetric, and has no authority bypass", () => {
  const sql = owningLeaderPairSql("project");

  assert.match(sql, /project\.created_by_user_id/);
  assert.match(sql, /root\.parent_id IN \(creator\.id::text, creator\.employee_id\)/);
  assert.match(sql, /creator\.parent_id::text IN \(root\.user_uuid, root\.employee_id\)/);
  assert.match(sql, /team_leader/);
  assert.match(sql, /team_co_leader/);
  assert.doesNotMatch(sql, /projectAuthority|admin|hierarchy_level/);
});

test("shared ownership helper allows the pair and returns 403 for unrelated users", async () => {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      return { rows: [{ allowed: params[0] !== "UNRELATED" }] };
    },
  };

  for (const employeeId of ["CREATOR_LEADER", "LINKED_CO_LEADER", "CREATOR_CO_LEADER", "LINKED_LEADER"]) {
    await requireOwningLeaderPair({ employee_id: employeeId }, "project-1", client);
  }

  await assert.rejects(
    () => requireOwningLeaderPair({ employee_id: "UNRELATED" }, "project-1", client),
    (error) => error.statusCode === 403,
  );
  assert.equal(calls.length, 5);
  assert.deepEqual(calls[0].params, ["CREATOR_LEADER", "project-1"]);
});
