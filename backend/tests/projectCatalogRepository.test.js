const assert = require("node:assert/strict");
const test = require("node:test");

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://user:pass@localhost:5432/tasktracker_test";

const {
  upsertFixtureOutsourceRecord,
} = require("../repositories/designProjectCatalogRepository");

test("fixture outsource upsert does not depend on a fixture_id unique constraint", async () => {
  const queries = [];
  const client = {
    query: async (sql, params = []) => {
      const text = String(sql);
      queries.push(text);

      if (/UPDATE\s+design\.fixture_outsource_records/i.test(text)) {
        return {
          rowCount: 1,
          rows: [{
            fixture_id: params[0],
            supplier_name: params[1],
            outsourced_stages: params[2],
            outsource_status: params[3],
            outsourced_by: params[4],
          }],
        };
      }

      return { rows: [], rowCount: 0 };
    },
  };

  const record = await upsertFixtureOutsourceRecord({
    fixtureId: "fixture-1",
    supplierName: "Supplier X",
    outsourcedStages: ["Concept", "3D"],
    changedBy: "MGR-1",
  }, client);

  assert.equal(record.fixture_id, "fixture-1");
  assert.equal(record.supplier_name, "Supplier X");
  assert.deepEqual(record.outsourced_stages, ["Concept", "3D"]);
  assert.match(queries[0], /UPDATE\s+design\.fixture_outsource_records/i);
  assert.doesNotMatch(queries.join("\n"), /ON\s+CONFLICT\s*\(\s*fixture_id\s*\)/i);
});
