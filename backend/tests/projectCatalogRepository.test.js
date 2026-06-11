const assert = require("node:assert/strict");
const test = require("node:test");

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://user:pass@localhost:5432/tasktracker_test";

const {
  listFixturesByProjectForUser,
  listProjectSummariesForUser,
  listRecentOutsourceSuppliersForUser,
  rememberRecentOutsourceSupplier,
  upsertFixtureOutsourceRecord,
} = require("../repositories/designProjectCatalogRepository");
const {
  listBatchesWithSummaryForUser,
} = require("../repositories/batchRepository");

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

test("project fixture list falls back when recent outsource tables are not migrated", async () => {
  const queries = [];
  const client = {
    query: async (sql) => {
      const text = String(sql);
      queries.push(text);

      if (/design\.fixture_outsource_records/i.test(text)) {
        const error = new Error('relation "design.fixture_outsource_records" does not exist');
        error.code = "42P01";
        throw error;
      }

      return {
        rows: [{
          fixture_id: "fixture-1",
          project_id: "project-1",
          department_id: "design",
          fixture_no: "FX-001",
          part_name: "Fixture One",
          fixture_type: null,
          remark: null,
          qty: 1,
          image_1_url: null,
          image_2_url: null,
          ingestion_source: "legacy",
          is_outsourced: false,
          vendor_name: null,
          outsource_status: null,
          outsourced_stages: null,
          revision_no: 0,
          is_legacy_workflow: false,
          is_workflow_complete: false,
          workflow_stage: "Concept",
          workflow_stage_label: "Concept",
          workflow_stage_order: 1,
          workflow_stage_total: 4,
          workflow_stage_version: 0,
          workflow_revision_stage: null,
          workflow_revision_stage_version: null,
          workflow_status: "PENDING",
          operational_state: "UNASSIGNED",
          workflow_assigned_to: null,
          workflow_assigned_to_name: null,
        }],
      };
    },
  };

  const rows = await listFixturesByProjectForUser(
    "project-1",
    { employee_id: "MGR-1" },
    "design",
    { activeOnly: true },
    client,
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].fixture_id, "fixture-1");
  assert.equal(rows[0].workflow_stage, "Concept");
  assert.equal(rows[0].outsource_status, null);
  assert.equal(queries.length, 2);
  assert.match(queries[0], /design\.fixture_outsource_records/i);
  assert.doesNotMatch(queries[1], /design\.fixture_outsource_records/i);
  assert.doesNotMatch(queries[1], /design\.workflow_completion_snapshots/i);
});

test("project summary list falls back when recent outsource tables are not migrated", async () => {
  const completionEngine = require("../services/designCompletion/designCompletionEngine");
  const originalEnrichProjectSummariesWithCompletionTruth = completionEngine.enrichProjectSummariesWithCompletionTruth;
  const queries = [];
  const client = {
    query: async (sql) => {
      const text = String(sql);
      queries.push(text);

      if (/design\.fixture_outsource_records/i.test(text)) {
        const error = new Error('relation "design.fixture_outsource_records" does not exist');
        error.code = "42P01";
        throw error;
      }

      return {
        rows: [{
          project_id: "project-1",
          project_no: "PRJ-1",
          project_name: "Project One",
          customer_name: "Customer One",
          department_id: "design",
          department_name: "Design",
          project_status: "active",
          is_modified: false,
          project_created_by_user_id: "MGR-1",
          project_uploaded_by: "MGR-1",
          uploaded_by: "MGR-1",
          uploaded_by_user_id: "MGR-1",
          team_lead_id: null,
          team_lead_name: null,
          uploaded_by_name: "Manager One",
          can_toggle_modification: true,
          total_fixtures: 1,
          total_tasks: 1,
          active_tasks: 0,
          pending_tasks: 1,
          completed_tasks: 0,
        }],
      };
    },
  };

  completionEngine.enrichProjectSummariesWithCompletionTruth = async (rows) => rows;
  try {
    const rows = await listProjectSummariesForUser(
      { employee_id: "MGR-1" },
      { departmentId: "design" },
      client,
    );

    assert.equal(rows.length, 1);
    assert.equal(rows[0].project_id, "project-1");
    assert.equal(rows[0].pending_tasks, 1);
    assert.equal(queries.length, 2);
    assert.match(queries[0], /design\.fixture_outsource_records/i);
    assert.doesNotMatch(queries[1], /design\.fixture_outsource_records/i);
    assert.doesNotMatch(queries[1], /design\.workflow_completion_snapshots/i);
  } finally {
    completionEngine.enrichProjectSummariesWithCompletionTruth = originalEnrichProjectSummariesWithCompletionTruth;
  }
});

test("batch summary list falls back when recent outsource tables are not migrated", async () => {
  const completionEngine = require("../services/designCompletion/designCompletionEngine");
  const originalEnrichProjectSummariesWithCompletionTruth = completionEngine.enrichProjectSummariesWithCompletionTruth;
  const queries = [];
  const client = {
    query: async (sql) => {
      const text = String(sql);
      queries.push(text);

      if (/design\.fixture_outsource_records/i.test(text)) {
        const error = new Error('relation "design.fixture_outsource_records" does not exist');
        error.code = "42P01";
        throw error;
      }

      return {
        rows: [{
          id: "project-1",
          batch_id: null,
          project_id: "project-1",
          project_no: "PRJ-1",
          project_created_by_user_id: "MGR-1",
          project_uploaded_by: "MGR-1",
          project_created_at: "2026-06-11T00:00:00.000Z",
          project_updated_at: "2026-06-11T00:00:00.000Z",
          project_name: "Project One",
          customer_name: "Customer One",
          department_id: "design",
          project_status: "active",
          is_modified: false,
          project_completion_percent: null,
          completion_truth_status: null,
          completion_truth_errors: [],
          uploaded_by: "MGR-1",
          uploaded_by_user_id: "MGR-1",
          uploaded_by_name: "Manager One",
          uploaded_at: null,
          accepted_rows: 0,
          rejected_rows: 0,
          total_fixtures: 1,
          pending_fixtures: 1,
          completed_fixtures: 0,
          active_count: 0,
          can_manage_2d_routing: true,
          can_toggle_modification: true,
        }],
      };
    },
  };

  completionEngine.enrichProjectSummariesWithCompletionTruth = async (rows) => rows;
  try {
    const rows = await listBatchesWithSummaryForUser(
      { employee_id: "MGR-1" },
      "design",
      client,
    );

    assert.equal(rows.length, 1);
    assert.equal(rows[0].project_id, "project-1");
    assert.equal(rows[0].pending_fixtures, 1);
    assert.equal(queries.length, 2);
    assert.match(queries[0], /design\.fixture_outsource_records/i);
    assert.doesNotMatch(queries[1], /design\.fixture_outsource_records/i);
  } finally {
    completionEngine.enrichProjectSummariesWithCompletionTruth = originalEnrichProjectSummariesWithCompletionTruth;
  }
});

test("recent outsource suppliers are optional for normal project fixture screens", async () => {
  const queries = [];
  const client = {
    query: async (sql) => {
      const text = String(sql);
      queries.push(text);
      const error = new Error('relation "design.recent_outsource_suppliers" does not exist');
      error.code = "42P01";
      throw error;
    },
  };

  const suppliers = await listRecentOutsourceSuppliersForUser(
    { employee_id: "MGR-1" },
    "design",
    6,
    client,
  );

  assert.deepEqual(suppliers, []);
  assert.equal(queries.length, 1);
  assert.match(queries[0], /design\.recent_outsource_suppliers/i);
});

test("remembering recent outsource suppliers is optional when supplier table is not migrated", async () => {
  const queries = [];
  const client = {
    query: async (sql) => {
      const text = String(sql);
      queries.push(text);
      const error = new Error('relation "design.recent_outsource_suppliers" does not exist');
      error.code = "42P01";
      throw error;
    },
  };

  const suppliers = await rememberRecentOutsourceSupplier("Supplier X", client);

  assert.deepEqual(suppliers, []);
  assert.equal(queries.length, 1);
  assert.match(queries[0], /INSERT INTO design\.recent_outsource_suppliers/i);
});
