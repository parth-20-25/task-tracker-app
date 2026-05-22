const assert = require("node:assert/strict");
const test = require("node:test");
const XLSX = require("xlsx");

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://user:pass@localhost:5432/tasktracker_test";

const { pool } = require("../db");
const { createNativeIngestionSession } = require("../services/nativeIngestion/sessionService");
const { buildNativeTemplateWorkbook, TEMPLATE_HEADERS } = require("../services/nativeIngestion/excelParser");
const { normalizeNativeContext, parseProjectIdentity } = require("../services/nativeIngestion/normalization");
const { resolveNativeDepartmentId, validateNativeRows } = require("../services/nativeIngestion/validation");

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

function authorityUser(roleName) {
  return {
    employee_id: `${roleName.replace(/\W+/g, "_").toUpperCase()}001`,
    department_id: null,
    permissions: [],
    role: {
      id: roleName.toLowerCase().replace(/\W+/g, "_"),
      name: roleName,
      hierarchy_level: 1,
      permissions: {},
    },
  };
}

test("native bootstrap resolves Admin, CEO, and Director as organization-scope without department_id", () => {
  for (const roleName of ["Admin", "CEO", "Director"]) {
    assert.equal(
      resolveNativeDepartmentId(authorityUser(roleName), null, { requireDepartment: false }),
      null,
      `${roleName} should open native workspace in organization scope`,
    );
  }
});

test("native workspace bootstrap creates organization-scope sessions for authority users", async () => {
  const originalQuery = pool.query;
  const calls = [];
  pool.query = async (sql, params) => {
    calls.push({ sql, params });
    return {
      rows: [{
        id: `session-${calls.length}`,
        expires_at: "2026-05-25T00:00:00.000Z",
        created_at: "2026-05-22T00:00:00.000Z",
      }],
    };
  };

  try {
    for (const roleName of ["Admin", "CEO", "Director"]) {
      const session = await createNativeIngestionSession(authorityUser(roleName), { context: {} });
      const insertCall = calls.at(-1);

      assert.equal(insertCall.params[0], null, `${roleName} session department_id should be null`);
      assert.equal(session.context.department_id, "");
    }
  } finally {
    pool.query = originalQuery;
  }
});

test("native department-scope users still require a department context", () => {
  const teamLeaderWithoutDepartment = {
    employee_id: "TL001",
    department_id: null,
    permissions: [],
    role: {
      id: "team_leader",
      name: "Team Leader",
      hierarchy_level: 4,
      permissions: {},
    },
  };

  assert.throws(
    () => resolveNativeDepartmentId(teamLeaderWithoutDepartment, null, { requireDepartment: false }),
    /Invalid native ingestion department context/,
  );
});

test("native project identity parser accepts required separators without corrupting project names", () => {
  assert.deepEqual(
    parseProjectIdentity("PARC2600M001 - Fuel Tank Weld Line - Belrise Industries Limited"),
    {
      project_code: "PARC2600M001",
      project_name: "Fuel Tank Weld Line",
      customer_name: "Belrise Industries Limited",
    },
  );
  assert.deepEqual(
    parseProjectIdentity("PARC2600M001_Fuel-Tank Weld Line_Belrise Industries Limited"),
    {
      project_code: "PARC2600M001",
      project_name: "Fuel-Tank Weld Line",
      customer_name: "Belrise Industries Limited",
    },
  );
  assert.deepEqual(
    parseProjectIdentity("PARC2600M001  Fuel Tank Weld Line  Belrise Industries Limited"),
    {
      project_code: "PARC2600M001",
      project_name: "Fuel Tank Weld Line",
      customer_name: "Belrise Industries Limited",
    },
  );
});

test("native context exposes only the intended top-level project identity fields", () => {
  const context = normalizeNativeContext({
    project_identity: "PARC2600M001 - Fuel Tank Weld Line - Belrise Industries Limited",
    vendor: "wrong-top-level",
    operational_batch: "wrong-top-level",
    revision: "wrong-top-level",
    upload_source: "wrong-top-level",
  }, { department_id: "design" });

  assert.equal(context.project_code, "PARC2600M001");
  assert.equal(context.project_name, "Fuel Tank Weld Line");
  assert.equal(context.customer_name, "Belrise Industries Limited");
  assert.equal(context.department_id, "design");
  assert.equal(context.upload_mode, "full_project_update");
  assert.equal(Object.hasOwn(context, "vendor"), false);
  assert.equal(Object.hasOwn(context, "operational_batch"), false);
  assert.equal(Object.hasOwn(context, "revision"), false);
  assert.equal(Object.hasOwn(context, "upload_source"), false);
});

test("native template is import-compatible and exposes one reference image column", () => {
  const workbook = XLSX.read(buildNativeTemplateWorkbook(), { type: "buffer" });
  const sheet = workbook.Sheets["Native Ingestion"];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });

  assert.deepEqual(rows[0], TEMPLATE_HEADERS);
  assert.equal(TEMPLATE_HEADERS.includes("Reference Image"), true);
  assert.equal(TEMPLATE_HEADERS.includes("IMAGE 1"), false);
  assert.equal(TEMPLATE_HEADERS.includes("IMAGE 2"), false);
  assert.equal(TEMPLATE_HEADERS.includes("Upload Source"), false);
  assert.equal(TEMPLATE_HEADERS.includes("Operational Batch"), false);
});

test("native validation normalizes identity, finds duplicates, and classifies updates", async () => {
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
    assigned_team: "Design Team",
    is_workflow_complete: false,
    is_legacy_workflow: false,
    is_outsourced: false,
    vendor_name: null,
    removed_from_latest_ingestion: false,
  }, {
    fixture_id: "fixture-2",
    project_id: "project-1",
    fixture_no: "PARC009",
    part_name: "Deleted candidate",
    fixture_type: "Checking Fixture",
    remark: null,
    qty: 1,
    image_1_url: null,
    assigned_team: null,
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
        project_identity: " parc001 - Fuel Tank Weld Line - ACME ",
        department_id: "design",
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
        {
          row_id: "r5",
          fixture_no: "PARC004",
          part_name: "Part C",
          fixture_type: "Checking Fixture",
          qty: "1",
          reference_image_url: "not an image reference",
          is_outsourced: false,
        },
      ],
    },
    createFakeClient(existingFixtures),
  );

  const byId = new Map(result.rows.map((row) => [row.row_id, row]));

  assert.equal(result.context.project_code, "PARC001");
  assert.equal(result.context.project_name, "Fuel Tank Weld Line");
  assert.equal(result.context.customer_name, "ACME");
  assert.equal(byId.get("r1").classification, "UPDATED");
  assert.equal(byId.get("r1").issues.length, 0);
  assert.equal(byId.get("r2").classification, "DUPLICATE");
  assert.equal(byId.get("r3").classification, "DUPLICATE");
  assert.equal(byId.get("r4").classification, "NEW"); // native fixture numbers normalize before validation
  assert.equal(byId.get("r4").severity, "error");
  assert.equal(byId.get("r4").issues.some((issue) => issue.code === "outsourced_vendor_required"), true);
  assert.equal(byId.get("r5").issues.some((issue) => issue.code === "image_malformed"), true);
  assert.equal(result.summary.valid_rows, 1);
  assert.equal(result.summary.invalid_rows, 4);
  assert.equal(result.summary.duplicate_rows, 2);
  assert.deepEqual(result.summary.deleted_fixture_nos, ["PARC009"]);
});
