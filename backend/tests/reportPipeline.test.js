const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const ExcelJS = require("exceljs");

const { normalizeScopeReportData, validateNormalizedRow } = require("../services/reportService");
const { generateRawScopeExcel } = require("../services/designReportService");

async function run() {
  {
    const rows = await normalizeScopeReportData([
      {
        project_no: "P-101",
        scope_name: "Front Bumper",
        fixture_no: "FX-01",
        op_no: "OP-9",
        part_name: "Bracket",
        fixture_type: "Checking",
        qty: 2,
        designer: "Asha",
        task_status: "in_progress",
        stages: {
          concept: { assigned_at: "2026-04-01T08:00:00Z", completed_at: "2026-04-01T10:00:00Z" },
          dap: { assigned_at: "2026-04-01T11:00:00Z", completed_at: null },
          finish3d: {},
          finish2d: {},
        },
        task_proof_url_array: ["/uploads/task-proofs/a.png", "/uploads/task-proofs/a.png"],
        attachments: [
          { file_url: "/uploads/task-proofs/b.png" },
          { file_url: "/uploads/task-proofs/c.png" },
        ],
      },
    ]);

    assert.equal(rows.length, 1);
    assert.equal(rows[0].fixture_key, "P-101::Front Bumper::FX-01");
    assert.deepEqual(rows[0].proof_urls, [
      "/uploads/task-proofs/a.png",
      "/uploads/task-proofs/b.png",
      "/uploads/task-proofs/c.png",
    ]);
    assert.equal(rows[0].status, "IN_PROGRESS");
    assert.equal(rows[0].stages.concept.duration_minutes, 120);
  }

  {
    const rows = await normalizeScopeReportData([
      {
        project_no: "",
        scope_name: "Dash",
        fixture_no: "FX-02",
        stages: {
          concept: {},
          dap: {},
          finish3d: {},
          finish2d: {},
        },
      },
      {
        project_no: "P-102",
        scope_name: "Dash",
        fixture_no: "FX-03",
        stages: {
          concept: {},
          dap: {},
          finish3d: {},
          finish2d: {},
        },
      },
    ]);

    assert.equal(rows.length, 1);
    assert.equal(rows[0].fixture_key, "P-102::Dash::FX-03");
    assert.equal(rows[0].status, "ASSIGNED");
  }

  {
    const validation = await validateNormalizedRow({
      fixture_key: "P-103::Door::FX-04",
      proof_urls: ["https://example.com/proof.png", null],
      stages: {
        concept: {
          assigned_at: "2026-04-02T12:00:00Z",
          completed_at: "2026-04-02T10:00:00Z",
          duration_minutes: 0,
        },
        dap: { assigned_at: "bad-date", completed_at: null, duration_minutes: null },
        finish3d: { assigned_at: null, completed_at: null, duration_minutes: null },
        finish2d: { assigned_at: null, completed_at: null, duration_minutes: null },
      },
    });

    assert.equal(validation.isValid, false);
    assert.match(validation.errors.join(" | "), /proof_urls contains null/);
    assert.match(validation.errors.join(" | "), /completed_at before assigned_at for concept/);
    assert.match(validation.errors.join(" | "), /invalid assigned_at for dap/);
  }

  {
    const rows = await normalizeScopeReportData([
      {
        project_no: "P-104",
        scope_name: "Console",
        fixture_no: "FX-05",
        task_status: "approved",
        stages: {
          concept: { assigned_at: "2026-04-01T08:00:00Z", completed_at: "2026-04-01T09:00:00Z" },
          dap: { assigned_at: "2026-04-01T09:00:00Z", completed_at: "2026-04-01T10:00:00Z" },
          finish3d: { assigned_at: "2026-04-01T10:00:00Z", completed_at: "2026-04-01T11:00:00Z" },
          finish2d: { assigned_at: "2026-04-01T11:00:00Z", completed_at: "2026-04-01T12:00:00Z" },
        },
      },
      {
        project_no: "P-104",
        scope_name: "Console",
        fixture_no: "FX-06",
        task_status: "in_progress",
        workflow_status: "rejected",
        stages: {
          concept: { assigned_at: "2026-04-01T08:00:00Z", completed_at: "2026-04-01T09:00:00Z" },
          dap: { assigned_at: "2026-04-01T09:00:00Z", completed_at: "2026-04-01T10:00:00Z" },
          finish3d: { assigned_at: "2026-04-01T10:00:00Z", completed_at: "2026-04-01T11:00:00Z" },
          finish2d: { assigned_at: "2026-04-01T11:00:00Z", completed_at: null },
        },
      },
    ]);

    assert.equal(rows[0].status, "COMPLETE");
    assert.equal(rows[1].status, "REWORK");
  }

  {
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "report-pipeline-test-"));
    const filePath = path.join(tempDirectory, "raw-scope-report.xlsx");

    try {
      await generateRawScopeExcel(
        [
          {
            fixture_key: "P-105::Roof::FX-07",
            project_no: "P-105",
            scope_name: "Roof",
            fixture_no: "FX-07",
            op_no: "OP-12",
            part_name: "Top Panel",
            fixture_type: "Checking",
            qty: 1,
            designer: "Riya",
            proof_urls: ["https://example.com/proof.png", "https://example.com/proof-2.png"],
            status: "IN_PROGRESS",
            stages: {
              concept: {
                assigned_at: "2026-04-03T08:00:00Z",
                completed_at: "2026-04-03T10:30:00Z",
                duration_minutes: 150,
              },
              dap: {
                assigned_at: "2026-04-03T11:00:00Z",
                completed_at: null,
                duration_minutes: null,
              },
              finish3d: { assigned_at: null, completed_at: null, duration_minutes: null },
              finish2d: { assigned_at: null, completed_at: null, duration_minutes: null },
            },
          },
        ],
        filePath,
        {
          project_no: "P-105",
          scope_name: "Roof",
          customer_name: "DemoCustomer",
        },
        new Map([
          ["P-105::Roof::FX-07", {
            image1Url: "https://example.com/ref.png",
            image2Url: "https://example.com/work.png",
          }],
        ]),
      );

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(filePath);
      const worksheet = workbook.getWorksheet("Design Report");

      assert.equal(worksheet.getCell("A1").value, "WBS-P-105-Roof-DemoCustomer");
      assert.equal(worksheet.getCell("A2").value, "S.No");
      assert.equal(worksheet.getCell("B2").value, "Fixture No");
      assert.equal(worksheet.getCell("S2").value, "Proof");
      assert.equal(worksheet.getCell("E3").value.text, "View");
      assert.equal(worksheet.getCell("E3").value.hyperlink, "https://example.com/ref.png");
      assert.equal(worksheet.getCell("J3").value, "03/04/26 - 03/04/26");
      assert.equal(worksheet.getCell("L3").value, "TBD");
      assert.equal(worksheet.getCell("K3").value, "2h 30m");
      assert.equal(worksheet.getCell("S3").value.hyperlink, "https://example.com/proof.png");
      assert.equal(worksheet.getCell("B3").fill.fgColor.argb, "FF28A745");
    } finally {
      await fs.rm(tempDirectory, { recursive: true, force: true });
    }
  }

  console.log("reportPipeline.test.js passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
