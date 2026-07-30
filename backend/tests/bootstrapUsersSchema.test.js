const assert = require("node:assert/strict");
const test = require("node:test");

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://user:pass@localhost:5432/tasktracker_test";

const { ensureUsersTable } = require("../repositories/bootstrapRepository");

test("ensureUsersTable adds profile columns and applies the guarded employee name correction", async () => {
  const queries = [];
  const client = {
    async query(sql, params) {
      queries.push({ sql: String(sql).replace(/\s+/g, " ").trim(), params });
      return { rows: [], rowCount: 0 };
    },
  };

  await ensureUsersTable(client);
  const statements = queries.map((query) => query.sql);

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

  const nameCorrection = queries.find((query) => query.sql.includes("UPDATE users SET name = $2"));
  assert.deepEqual(
    nameCorrection?.params,
    ["650", "PRITHVIRAJ KHANDAGALE", "PRUTHIRAJ KHANDAGALE"],
  );
  assert.match(nameCorrection.sql, /WHERE employee_id = \$1 AND name = \$3/);
  assert.match(nameCorrection.sql, /UPDATE users SET name = \$2, updated_at = NOW\(\) WHERE/);
});
