const fs = require("fs/promises");
const path = require("path");

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://user:pass@localhost:5432/tasktracker_sample";

const {
  buildDesignManagementReportModel,
  generateDesignProjectExecutionTemplateExcel,
  generateDesignManagementPdf,
} = require("../services/designReportService");
const {
  buildDesignReportManagementSample,
} = require("../tests/fixtures/designReportManagementSample");

function htmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function tableHtml(columns, rows) {
  const safeRows = rows.length ? rows : [columns.reduce((acc, column, index) => {
    acc[column.key] = index === 0 ? "No records found" : "";
    return acc;
  }, {})];

  return `
    <table>
      <thead>
        <tr>${columns.map((column) => `<th>${htmlEscape(column.header)}</th>`).join("")}</tr>
      </thead>
      <tbody>
        ${safeRows.map((row) => `
          <tr>
            ${columns.map((column) => {
              const value = row[column.key] ?? "";
              const statusClass = column.status ? ` class="status status-${String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-")}"` : "";
              return `<td${statusClass}>${htmlEscape(value)}</td>`;
            }).join("")}
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function auditPreviewRows(model) {
  return model.fixtureStageExecutionAudit.flatMap((fixture) => (
    fixture.stages.flatMap((stage) => {
      const rowCount = Math.max(stage.workers.length, stage.proofLinks.length, 1);
      return Array.from({ length: rowCount }, (_unused, index) => {
        const worker = stage.workers[index] || {};
        const proof = stage.proofLinks[index] || null;
        return {
          fixture: index === 0 ? fixture.fixtureNumber : "",
          stageRevision: index === 0 ? `${stage.stage} - ${stage.revision}` : "",
          worker: worker.worker || "",
          contributionPercent: worker.contributionPercent || "Contribution % Not Recorded",
          started: worker.started || "",
          plannedEnd: index === 0 ? stage.plannedEnd : "",
          actualEnd: index === 0 ? stage.actualEnd : "",
          transferred: index === 0 ? stage.transferred : "",
          priority: index === 0 ? stage.priority : "",
          proof: proof ? proof.url : (index === 0 ? stage.proofSummary : ""),
        };
      });
    })
  ));
}

function svgEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function truncate(value, maxLength) {
  const text = String(value ?? "");
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function svgText(value, x, y, options = {}) {
  const size = options.size || 14;
  const weight = options.weight || 400;
  const color = options.color || "#172033";
  const anchor = options.anchor || "start";
  return `<text x="${x}" y="${y}" font-family="Arial, sans-serif" font-size="${size}" font-weight="${weight}" fill="${color}" text-anchor="${anchor}">${svgEscape(value)}</text>`;
}

function svgRect(x, y, width, height, fill, stroke = "#B7C3D0") {
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${fill}" stroke="${stroke}" stroke-width="1" />`;
}

function buildSvgTable({ x, y, widths, rowHeight = 34, headers, rows, maxRows = 5 }) {
  const navy = "#0B2A66";
  const line = "#B7C3D0";
  const parts = [];
  const totalWidth = widths.reduce((sum, width) => sum + width, 0);
  parts.push(svgRect(x, y, totalWidth, rowHeight, navy, navy));
  let cursorX = x;
  headers.forEach((header, index) => {
    parts.push(svgText(truncate(header, Math.max(8, Math.floor(widths[index] / 9))), cursorX + 8, y + 22, {
      size: 12,
      weight: 700,
      color: "#FFFFFF",
    }));
    cursorX += widths[index];
  });

  rows.slice(0, maxRows).forEach((row, rowIndex) => {
    const rowY = y + rowHeight * (rowIndex + 1);
    cursorX = x;
    parts.push(svgRect(x, rowY, totalWidth, rowHeight, rowIndex % 2 === 0 ? "#FFFFFF" : "#F3F6FA", line));
    row.forEach((value, columnIndex) => {
      const width = widths[columnIndex];
      parts.push(`<line x1="${cursorX}" y1="${rowY}" x2="${cursorX}" y2="${rowY + rowHeight}" stroke="${line}" />`);
      parts.push(svgText(truncate(value, Math.max(9, Math.floor(width / 8))), cursorX + 8, rowY + 22, {
        size: 11,
        weight: columnIndex === 0 ? 700 : 400,
        color: "#172033",
      }));
      cursorX += width;
    });
    parts.push(`<line x1="${cursorX}" y1="${rowY}" x2="${cursorX}" y2="${rowY + rowHeight}" stroke="${line}" />`);
  });

  return parts.join("");
}

function buildExecutivePreviewSvg(model) {
  const statusColors = model.statusColors || {};
  const cards = [
    ["Total Fixtures", model.kpis.totalFixtures, "#0B2A66"],
    ["Completed", model.kpis.completedFixtures, statusColors.Closed],
    ["In Progress", model.kpis.inProgressFixtures, statusColors["In Progress"]],
    ["On Hold", model.kpis.onHoldFixtures, statusColors["On Hold"]],
    ["Overdue", model.kpis.overdueFixtures, statusColors.Overdue],
    ["Rework", model.kpis.reworkCount, statusColors.Rework],
    ["Review", model.kpis.reviewCount, statusColors.Review],
    ["Completion", model.kpis.completionDisplay, statusColors["In Progress"]],
  ];
  const overview = model.overview.slice(0, 12);
  const fixtureRows = model.fixtureBreakdown.slice(0, 5).map((fixture) => [
    fixture.fixtureNumber,
    fixture.fixtureName,
    fixture.currentStage,
    fixture.currentStatus,
    fixture.assignedTo,
    fixture.dueDate,
    fixture.latestActivity,
  ]);
  const stageRows = model.fixtureStageDetails.slice(0, 4).map((fixture) => [
    fixture.fixtureNumber,
    fixture.conceptStatus,
    fixture.dapStatus,
    fixture.threeDStatus,
    fixture.twoDStatus,
    fixture.conceptRevision,
    fixture.twoDProof,
  ]);
  const proofRows = model.workProofHistory.slice(0, 4).map((proof) => [
    proof.fixtureNumber,
    proof.stage,
    proof.proofAvailability,
    proof.proofLink,
    proof.uploadedBy,
  ]);

  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="1365" height="1000" viewBox="0 0 1365 1000">`,
    svgRect(0, 0, 1365, 1000, "#F4F6F9", "#F4F6F9"),
    svgRect(32, 24, 1301, 70, "#0B2A66", "#0B2A66"),
    svgText("Executive Project Summary", 682, 58, { size: 26, weight: 700, color: "#FFFFFF", anchor: "middle" }),
    svgText(`${model.reportVersion} | ${model.context.project_no} | ${model.context.project_name}`, 682, 82, {
      size: 14,
      weight: 700,
      color: "#DCE6F2",
      anchor: "middle",
    }),
    svgRect(32, 108, 1301, 28, "#26478B", "#26478B"),
    svgText("SECTION 1 - PROJECT OVERVIEW", 44, 127, { size: 13, weight: 700, color: "#FFFFFF" }),
  ];

  overview.forEach((item, index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const x = 32 + col * 650;
    const y = 136 + row * 34;
    parts.push(svgRect(x, y, 180, 34, "#DCE6F2"));
    parts.push(svgRect(x + 180, y, 470, 34, "#FFFFFF"));
    parts.push(svgText(item.label, x + 10, y + 22, { size: 12, weight: 700 }));
    parts.push(svgText(truncate(item.value, 54), x + 190, y + 22, { size: 12 }));
  });

  parts.push(svgRect(32, 354, 1301, 28, "#26478B", "#26478B"));
  parts.push(svgText("SECTION 2 - PROJECT KPI DASHBOARD", 44, 373, { size: 13, weight: 700, color: "#FFFFFF" }));
  cards.forEach(([label, value, color], index) => {
    const x = 32 + (index % 4) * 326;
    const y = 396 + Math.floor(index / 4) * 94;
    parts.push(svgRect(x, y, 306, 78, "#FFFFFF"));
    parts.push(svgRect(x, y, 306, 28, color || "#0B2A66", color || "#0B2A66"));
    parts.push(svgText(label, x + 10, y + 19, { size: 12, weight: 700, color: "#FFFFFF" }));
    parts.push(svgText(value, x + 14, y + 60, { size: 26, weight: 700, color: "#172033" }));
  });

  parts.push(svgRect(32, 594, 1301, 28, "#26478B", "#26478B"));
  parts.push(svgText("SECTION 6 - FIXTURE BREAKDOWN", 44, 613, { size: 13, weight: 700, color: "#FFFFFF" }));
  parts.push(buildSvgTable({
    x: 32,
    y: 622,
    widths: [110, 210, 90, 105, 180, 95, 511],
    headers: ["Fixture", "Fixture Name", "Stage", "Status", "Assigned To", "Due Date", "Latest Activity"],
    rows: fixtureRows,
    maxRows: 4,
  }));

  parts.push(svgRect(32, 794, 1301, 28, "#26478B", "#26478B"));
  parts.push(svgText("FIXTURE STAGE DETAILS - CONCEPT / DAP / 3D / 2D", 44, 813, {
    size: 13,
    weight: 700,
    color: "#FFFFFF",
  }));
  parts.push(buildSvgTable({
    x: 32,
    y: 822,
    widths: [110, 110, 110, 110, 110, 150, 601],
    headers: ["Fixture", "Concept", "DAP", "3D", "2D", "Revision", "Proof Reference"],
    rows: stageRows,
    maxRows: 3,
  }));

  parts.push(svgRect(32, 948, 1301, 28, "#26478B", "#26478B"));
  parts.push(svgText("WORK PROOF HISTORY - CLICKABLE PROOF LINKS", 44, 967, {
    size: 13,
    weight: 700,
    color: "#FFFFFF",
  }));
  parts.push(svgText(
    proofRows.map((row) => `${row[0]} ${row[1]}: ${row[2]} (${row[3]})`).join(" | "),
    44,
    991,
    { size: 11, weight: 700, color: "#172033" },
  ));
  parts.push(`</svg>`);
  return parts.join("");
}

function buildMobilePreviewSvg(model) {
  const statusColors = model.statusColors || {};
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="390" height="900" viewBox="0 0 390 900">`,
    svgRect(0, 0, 390, 900, "#F4F6F9", "#F4F6F9"),
    svgRect(18, 18, 354, 76, "#0B2A66", "#0B2A66"),
    svgText("Executive Summary", 195, 50, { size: 21, weight: 700, color: "#FFFFFF", anchor: "middle" }),
    svgText(model.context.project_no, 195, 74, { size: 13, weight: 700, color: "#DCE6F2", anchor: "middle" }),
    svgRect(18, 112, 354, 30, "#26478B", "#26478B"),
    svgText("Project Overview", 30, 132, { size: 13, weight: 700, color: "#FFFFFF" }),
  ];

  model.overview.slice(0, 7).forEach((item, index) => {
    const y = 142 + index * 38;
    parts.push(svgRect(18, y, 142, 38, "#DCE6F2"));
    parts.push(svgRect(160, y, 212, 38, "#FFFFFF"));
    parts.push(svgText(truncate(item.label, 17), 28, y + 24, { size: 11, weight: 700 }));
    parts.push(svgText(truncate(item.value, 25), 168, y + 24, { size: 11 }));
  });

  const kpis = [
    ["Fixtures", model.kpis.totalFixtures, "#0B2A66"],
    ["Done", model.kpis.completedFixtures, statusColors.Closed],
    ["Overdue", model.kpis.overdueFixtures, statusColors.Overdue],
    ["Complete", model.kpis.completionDisplay, statusColors["In Progress"]],
  ];
  parts.push(svgRect(18, 420, 354, 30, "#26478B", "#26478B"));
  parts.push(svgText("KPI Dashboard", 30, 440, { size: 13, weight: 700, color: "#FFFFFF" }));
  kpis.forEach(([label, value, color], index) => {
    const x = 18 + (index % 2) * 182;
    const y = 462 + Math.floor(index / 2) * 84;
    parts.push(svgRect(x, y, 172, 70, "#FFFFFF"));
    parts.push(svgRect(x, y, 172, 24, color || "#0B2A66", color || "#0B2A66"));
    parts.push(svgText(label, x + 8, y + 17, { size: 11, weight: 700, color: "#FFFFFF" }));
    parts.push(svgText(value, x + 10, y + 54, { size: 22, weight: 700 }));
  });

  parts.push(svgRect(18, 642, 354, 30, "#26478B", "#26478B"));
  parts.push(svgText("Fixture Stage Details", 30, 662, { size: 13, weight: 700, color: "#FFFFFF" }));
  model.fixtureStageDetails.slice(0, 3).forEach((fixture, index) => {
    const y = 678 + index * 66;
    parts.push(svgRect(18, y, 354, 56, index % 2 === 0 ? "#FFFFFF" : "#F3F6FA"));
    parts.push(svgText(`${fixture.fixtureNumber} - ${fixture.fixtureName}`, 28, y + 18, { size: 11, weight: 700 }));
    parts.push(svgText(`Concept ${fixture.conceptStatus} | DAP ${fixture.dapStatus}`, 28, y + 36, { size: 10 }));
    parts.push(svgText(`3D ${fixture.threeDStatus} | 2D ${fixture.twoDStatus} | ${fixture.twoDProof}`, 28, y + 51, { size: 10 }));
  });

  parts.push(svgRect(18, 864, 354, 28, "#0B2A66", "#0B2A66"));
  parts.push(svgText("PARC Task Control System | Proof links preserved in Excel", 195, 882, {
    size: 10,
    weight: 700,
    color: "#FFFFFF",
    anchor: "middle",
  }));
  parts.push(`</svg>`);
  return parts.join("");
}

async function maybeWriteModelPreviewScreenshots(model, outputDir) {
  let sharp = null;
  try {
    sharp = require("sharp");
  } catch (_error) {
    return false;
  }

  await sharp(Buffer.from(buildExecutivePreviewSvg(model))).png().toFile(path.join(outputDir, "PARC_Report_v2_Executive_Summary.png"));
  await sharp(Buffer.from(buildMobilePreviewSvg(model))).png().toFile(path.join(outputDir, "PARC_Report_v2_Mobile_Preview.png"));
  return true;
}

function buildPreviewHtml(model) {
  const kpiCards = [
    ["Total Fixtures", model.kpis.totalFixtures, "navy"],
    ["Completed Fixtures", model.kpis.completedFixtures, "closed"],
    ["In Progress Fixtures", model.kpis.inProgressFixtures, "in-progress"],
    ["On Hold Fixtures", model.kpis.onHoldFixtures, "on-hold"],
    ["Overdue Fixtures", model.kpis.overdueFixtures, "overdue"],
    ["Rework Count", model.kpis.reworkCount, "rework"],
    ["Review Count", model.kpis.reviewCount, "review"],
    ["Completion %", model.kpis.completionDisplay, "in-progress"],
  ];

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${htmlEscape(model.reportVersion)}</title>
  <style>
    :root {
      --navy: #0B2A66;
      --blue: #26478B;
      --panel: #EDEFF4;
      --line: #B7C3D0;
      --text: #172033;
      --assigned: #3A7BD5;
      --in-progress: #28A745;
      --on-hold: #FF9800;
      --review: #009688;
      --rework: #9C27B0;
      --closed: #616161;
      --overdue: #D32F2F;
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: #f4f6f9; color: var(--text); font-family: Arial, sans-serif; }
    .page { width: 1280px; margin: 0 auto; background: white; min-height: 900px; padding: 26px; }
    .title { background: var(--navy); color: white; text-align: center; padding: 14px; font-size: 24px; font-weight: 700; }
    .subtitle { background: var(--blue); color: white; text-align: center; padding: 8px; font-weight: 700; }
    .section { background: var(--blue); color: white; padding: 8px 10px; margin-top: 16px; font-size: 14px; font-weight: 700; }
    .overview { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0; border: 1px solid var(--line); border-bottom: 0; }
    .kv { display: grid; grid-template-columns: 165px 1fr; border-bottom: 1px solid var(--line); min-height: 32px; }
    .kv b { background: #DCE6F2; padding: 8px; border-right: 1px solid var(--line); font-size: 12px; }
    .kv span { padding: 8px; font-size: 12px; }
    .cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-top: 10px; }
    .card { border: 1px solid var(--line); min-height: 76px; }
    .card div:first-child { color: white; padding: 8px; font-weight: 700; font-size: 12px; }
    .card div:last-child { padding: 12px; font-size: 24px; font-weight: 700; }
    .navy div:first-child { background: var(--navy); }
    .assigned div:first-child { background: var(--assigned); }
    .in-progress div:first-child { background: var(--in-progress); }
    .on-hold div:first-child { background: var(--on-hold); }
    .review div:first-child { background: var(--review); }
    .rework div:first-child { background: var(--rework); }
    .closed div:first-child { background: var(--closed); }
    .overdue div:first-child { background: var(--overdue); }
    table { width: 100%; border-collapse: collapse; margin-top: 0; font-size: 11px; }
    th { background: var(--navy); color: white; padding: 7px; text-align: left; border: 1px solid var(--navy); }
    td { padding: 7px; border: 1px solid var(--line); vertical-align: top; }
    tbody tr:nth-child(even) td { background: #F3F3F3; }
    .status { color: white; font-weight: 700; text-align: center; }
    .status-closed { background: var(--closed) !important; }
    .status-in-progress { background: var(--in-progress) !important; }
    .status-on-hold { background: var(--on-hold) !important; }
    .status-overdue { background: var(--overdue) !important; }
    .status-rework { background: var(--rework) !important; }
    .status-review { background: var(--review) !important; }
    .status-available { background: var(--in-progress) !important; }
    .status-missing { background: var(--overdue) !important; }
    .footer { margin-top: 18px; border-top: 1px solid var(--line); color: #5B6472; padding-top: 8px; font-size: 11px; display: flex; justify-content: space-between; }
  </style>
</head>
<body>
  <main class="page">
    <div class="title">Executive Project Summary</div>
    <div class="subtitle">${htmlEscape(model.reportVersion)} | ${htmlEscape(model.context.project_no)} | ${htmlEscape(model.context.project_name)}</div>
    <div class="section">SECTION 1 - PROJECT OVERVIEW</div>
    <div class="overview">
      ${model.overview.map((item) => `<div class="kv"><b>${htmlEscape(item.label)}</b><span>${htmlEscape(item.value)}</span></div>`).join("")}
    </div>
    <div class="section">SECTION 2 - PROJECT KPI DASHBOARD</div>
    <div class="cards">
      ${kpiCards.map(([label, value, color]) => `<div class="card ${color}"><div>${htmlEscape(label)}</div><div>${htmlEscape(value)}</div></div>`).join("")}
    </div>
    <div class="section">SECTION 6 - FIXTURE BREAKDOWN</div>
    ${tableHtml([
      { key: "fixtureNumber", header: "Fixture Number" },
      { key: "fixtureName", header: "Fixture Name" },
      { key: "currentStage", header: "Stage" },
      { key: "currentStatus", header: "Status", status: true },
      { key: "assignedTo", header: "Assigned To" },
      { key: "dueDate", header: "Due Date" },
      { key: "actualHours", header: "Actual" },
      { key: "plannedHours", header: "Planned" },
      { key: "latestActivity", header: "Latest Activity" },
    ], model.fixtureBreakdown)}
    <div class="section">FIXTURE STAGE DETAILS - CONCEPT / DAP / 3D / 2D</div>
    ${tableHtml([
      { key: "fixtureNumber", header: "Fixture Number" },
      { key: "globalStatus", header: "Global Status", status: true },
      { key: "conceptStatus", header: "Concept", status: true },
      { key: "dapStatus", header: "DAP", status: true },
      { key: "threeDStatus", header: "3D", status: true },
      { key: "twoDStatus", header: "2D", status: true },
      { key: "conceptRevision", header: "Concept Revision" },
      { key: "twoDProof", header: "2D Proof" },
    ], model.fixtureStageDetails)}
    <div class="section">FIXTURE STAGE EXECUTION AUDIT - WORKER CONTRIBUTIONS AND PROOF IMAGES</div>
    ${tableHtml([
      { key: "fixture", header: "Fixture" },
      { key: "stageRevision", header: "Stage / Revision" },
      { key: "worker", header: "Worker" },
      { key: "contributionPercent", header: "Contribution %" },
      { key: "started", header: "Started" },
      { key: "plannedEnd", header: "Planned End" },
      { key: "actualEnd", header: "Actual End" },
      { key: "transferred", header: "Transferred" },
      { key: "priority", header: "Priority" },
      { key: "proof", header: "Proof" },
    ], auditPreviewRows(model).slice(0, 12))}
    <div class="section">SECTION 7 - WORK PROOF ANALYTICS</div>
    ${tableHtml([
      { key: "fixtureNumber", header: "Fixture Number" },
      { key: "fixtureName", header: "Fixture Name" },
      { key: "proofCount", header: "Proof Count" },
      { key: "latestUploadDate", header: "Latest Upload Date" },
      { key: "latestUploadedBy", header: "Latest Uploaded By" },
      { key: "proofAvailability", header: "Proof Availability", status: true },
    ], model.proofAnalytics)}
    <div class="section">WORK PROOF HISTORY - CLICKABLE PROOF LINKS</div>
    ${tableHtml([
      { key: "fixtureNumber", header: "Fixture Number" },
      { key: "stage", header: "Stage" },
      { key: "taskId", header: "Task ID" },
      { key: "proofAvailability", header: "Availability", status: true },
      { key: "proofLink", header: "Proof Link" },
      { key: "uploadedAt", header: "Uploaded At" },
      { key: "uploadedBy", header: "Uploaded By" },
    ], model.workProofHistory)}
    <div class="footer">
      <span>PARC Task Control System</span>
      <span>${htmlEscape(model.reportVersion)} | Generated By ${htmlEscape(model.generatedBy)}</span>
    </div>
  </main>
</body>
</html>`;
}

async function maybeWriteScreenshots(htmlPath, outputDir) {
  let chromium = null;
  try {
    ({ chromium } = require("playwright"));
  } catch (_error) {
    return false;
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1365, height: 1000 }, deviceScaleFactor: 1 });
    await page.goto(`file://${htmlPath.replace(/\\/g, "/")}`);
    await page.screenshot({
      path: path.join(outputDir, "PARC_Report_v2_Executive_Summary.png"),
      fullPage: true,
    });

    await page.setViewportSize({ width: 390, height: 900 });
    await page.screenshot({
      path: path.join(outputDir, "PARC_Report_v2_Mobile_Preview.png"),
      fullPage: true,
    });
  } finally {
    await browser.close();
  }

  return true;
}

async function main() {
  const outputDir = path.resolve(process.argv[2] || "C:/tmp/parc-report-v2-sample");
  await fs.mkdir(outputDir, { recursive: true });

  const sample = buildDesignReportManagementSample();
  const model = buildDesignManagementReportModel(sample);
  const xlsxPath = path.join(outputDir, "PARC2600M013_Rowa_4x2_Frunk_Project_Report_v2.xlsx");
  const pdfPath = path.join(outputDir, "PARC2600M013_Rowa_4x2_Frunk_Project_Report_v2.pdf");
  const htmlPath = path.join(outputDir, "PARC2600M013_Rowa_4x2_Frunk_Project_Report_v2_preview.html");
  const jsonPath = path.join(outputDir, "PARC2600M013_Rowa_4x2_Frunk_Project_Report_v2_model.json");

  await fs.writeFile(pdfPath, generateDesignManagementPdf(model));
  await fs.writeFile(htmlPath, buildPreviewHtml(model), "utf8");
  await fs.writeFile(jsonPath, JSON.stringify(model, null, 2), "utf8");
  const screenshots = await maybeWriteScreenshots(htmlPath, outputDir)
    || await maybeWriteModelPreviewScreenshots(model, outputDir);

  await generateDesignProjectExecutionTemplateExcel({
    context: sample.context,
    fixtures: sample.fixtures,
    reportData: sample.reportData,
    filePath: xlsxPath,
  });

  console.log(JSON.stringify({
    outputDir,
    xlsxPath,
    pdfPath,
    htmlPath,
    jsonPath,
    screenshots,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
