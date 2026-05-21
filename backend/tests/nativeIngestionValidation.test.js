const assert = require("node:assert/strict");
const test = require("node:test");

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://user:pass@localhost:5432/tasktracker_test";

const { validateNativeRows } = require("../services/nativeIngestion/validation");

function createFakeClient(existingFixtures) {
  let call = 0;
  return {
    async query() {
      call += 1;
      if (call === 1) {
        return { rows: [] };
      }
      if (call === 2) {
        return {
          rows: [{
            project_id: "project-1",
            project_no: "PARC001",
            project_name: "PARC001",
            customer_name: "ACME",
            department_id: "design",
            status: "active",
          }],
        };
      }
      if (call === 3) {
        return { rows: existingFixtures };
      }
      throw new Error(`Unexpected fake query call ${call}`);
    },
  };
}

test("native validation normalizes identity, finds duplicates, and classifies conflicts", async () => {
  const user = {
    employee_id: "tester",
    department_id: "design",
    permissions: [],
  };

  const existingFixtures = [{
    fixture_id: "fixture-1",
    project_id: "project-1",
    fixture_no: "PARC001",
    part_name: "Existing LH Bracket",
    fixture_type: "Checking Fixture",
    remark: null,
    qty: 1,
    image_1_url: null,
    image_2_url: null,
    revision_no: 0,
    is_workflow_complete: false,
    is_legacy_workflow: false,
    is_outsourced: false,
    vendor_name: null,
    removed_from_latest_ingestion: false,
  }];

  const result = await validateNativeRows(
    user,
    {
      context: {
        project_no: " parc001_ ",
        customer: "ACME",
        department_id: "design",
        revision: "0",
      },
      rows: [
        {
          row_id: "r1",
          fixture_no: "parc001_",
          part_name: "Incoming RH Bracket",
          fixture_type: "Checking Fixture",
          qty: "1",
          is_outsourced: false,
        },
        {
          row_id: "r2",
          fixture_no: "PARC002",
          part_name: "Part A",
          fixture_type: "Checking Fixture",
          qty: "1",
          is_outsourced: false,
        },
        {
          row_id: "r3",
          fixture_no: "parc002_",
          part_name: "Part A",
          fixture_type: "Checking Fixture",
          qty: "1",
          is_outsourced: false,
        },
        {
          row_id: "r4",
          fixture_no: "PARC003",
          part_name: "Part B",
          fixture_type: "Checking Fixture",
          qty: "1",
          is_outsourced: true,
          vendor_name: "",
        },
      ],
    },
    createFakeClient(existingFixtures),
  );

  const byId = new Map(result.rows.map((row) => [row.row_id, row]));

  assert.equal(result.context.project_no, "PARC001");
  assert.equal(byId.get("r1").classification, "CONFLICT");
  assert.equal(byId.get("r1").issues.some((issue) => issue.code === "part_name_conflict"), true);
  assert.equal(byId.get("r2").classification, "DUPLICATE");
  assert.equal(byId.get("r3").classification, "DUPLICATE");
  assert.equal(byId.get("r4").classification, "NEW"); // native fixture numbers normalize before validation
  assert.equal(byId.get("r4").severity, "error");
  assert.equal(byId.get("r4").issues.some((issue) => issue.code === "outsourced_vendor_required"), true);
});
