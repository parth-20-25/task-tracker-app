const assert = require("node:assert/strict");
const test = require("node:test");

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://user:pass@localhost:5432/tasktracker_test";

const { listUsers } = require("../repositories/usersRepository");

test("listUsers includes authoritative incomplete task workload", async () => {
  let capturedSql = "";
  let capturedParams = [];
  const client = {
    query: async (sql, params) => {
      capturedSql = String(sql);
      capturedParams = params;
      return {
        rows: [{
          employee_id: "EMP-1",
          name: "Rahul",
          is_active: true,
          incomplete_task_count: "2",
        }],
      };
    },
  };

  const users = await listUsers(client);

  assert.equal(users[0].incomplete_task_count, 2);
  assert.deepEqual(capturedParams, [["created", "assigned", "in_progress", "on_hold", "under_review", "rework"]]);
  assert.match(capturedSql, /task\.status = ANY\(\$1::text\[\]\)/);
  assert.match(capturedSql, /task\.verification_status[\s\S]*<> 'approved'/);
  assert.match(capturedSql, /task\.approved_at IS NULL/);
  assert.match(capturedSql, /task\.lifecycle_status[\s\S]*<> 'completed'/);
  assert.match(capturedSql, /task\.assignee_ids[\s\S]*\? u\.employee_id/);
});
