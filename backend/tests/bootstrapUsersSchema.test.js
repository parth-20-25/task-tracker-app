const assert = require("node:assert/strict");
const test = require("node:test");

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://user:pass@localhost:5432/tasktracker_test";

const { ensureUsersTable } = require("../repositories/bootstrapRepository");

test("ensureUsersTable adds profile columns selected by shared user queries", async () => {
  const statements = [];
  const client = {
    async query(sql) {
      statements.push(String(sql).replace(/\s+/g, " ").trim());
      return { rows: [], rowCount: 0 };
    },
  };

  await ensureUsersTable(client);

  const expectedColumns = [
    "username TEXT",
    "username_changed_at TIMESTAMP",
    "bio TEXT",
    "avatar_bucket TEXT",
    "avatar_path TEXT",
    "avatar_updated_at TIMESTAMP",
  ];

  for (const column of expectedColumns) {
    assert.ok(
      statements.some((statement) =>
        statement.includes(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ${column}`),
      ),
      `missing users.${column.split(" ")[0]} startup migration`,
    );
  }
});
