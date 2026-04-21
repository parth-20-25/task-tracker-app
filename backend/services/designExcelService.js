const xlsx = require('xlsx');
const { AppError } = require("../lib/AppError");
const { pool } = require("../db");
const { isDesignDepartment } = require("../lib/designDepartment");
const {
  upsertProjectByNumber,
  findOrCreateScope,
  findFixturesByScopeForDedupe,
  createUploadBatch,
  createUploadErrors,
  upsertFixture
} = require("../repositories/designProjectCatalogRepository");

function normalizeScopeName(name) {
  return String(name || '').toLowerCase().trim().replace(/[^a-z]/g, '');
}

async function parseAndPreviewUpload(user, file) {
  if (!isDesignDepartment(user)) {
    throw new AppError(403, "This flow is only available to the Design department");
  }

  if (!file) {
    throw new AppError(400, "No file uploaded");
  }

  let workbook;
  try {
    workbook = xlsx.read(file.buffer, { type: 'buffer' });
  } catch (err) {
    throw new AppError(400, "Failed to parse Excel file");
  }

  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rawData = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: "" });

  let headerResult = null;
  let source_cell = "";
  const scannedCandidates = [];

  const maxRows = Math.min(rawData.length, 10);
  for (let r = 0; r < maxRows; r++) {
    const row = rawData[r];
    if (!row) continue;
    for (let c = 0; c < row.length; c++) {
      const cellVal = String(row[c] || '');
      if (cellVal.toLowerCase().includes('wbs-')) {
        const rawStr = cellVal;
        
        // Normalization
        let normStr = rawStr.trim().replace(/\s+/g, ' ');
        const lowerNorm = normStr.toLowerCase();
        
        // Remove leading junk characters before 'WBS-'
        const wbsIdx = lowerNorm.indexOf('wbs-');
        if (wbsIdx > 0) {
          const leading = normStr.substring(0, wbsIdx);
          if (/^[^a-zA-Z0-9]*$/.test(leading)) {
            normStr = normStr.substring(wbsIdx);
          }
        }
        
        let candidateParsed = null;
        
        // Flexible parsing logic
        if (normStr.toLowerCase().startsWith('wbs-')) {
          const afterWbs = normStr.substring(4).trim();
          const dashIdx = afterWbs.indexOf('-');
          
          if (dashIdx !== -1) {
            const project_code = afterWbs.substring(0, dashIdx).trim();
            const remaining = afterWbs.substring(dashIdx + 1).trim();
            
            let scope_name = '';
            let company_name = '';
            
            if (remaining.includes('_')) {
              const lastU = remaining.lastIndexOf('_');
              scope_name = remaining.substring(0, lastU).trim();
              company_name = remaining.substring(lastU + 1).trim();
            } else {
              const tokens = remaining.split(' ');
              const takeQty = tokens.length >= 4 ? 3 : (tokens.length - 1 || 1);
              company_name = tokens.slice(-takeQty).join(' ');
              scope_name = tokens.slice(0, -takeQty).join(' ') || remaining;
            }
            
            if (project_code && scope_name && company_name) {
              candidateParsed = {
                project_code,
                scope_name,
                company_name
              };
            }
          }
        }
        
        const cellRef = xlsx.utils.encode_cell({ r, c });
        scannedCandidates.push({
          cell: cellRef,
          raw: rawStr,
          normalized: normStr,
          parsed: candidateParsed
        });
        
        if (candidateParsed && !headerResult) {
          headerResult = candidateParsed;
          source_cell = cellRef;
        }
      }
    }
  }

  // Debug Logging
  const logPayload = {
    header_found: !!headerResult,
    candidates_scanned: scannedCandidates,
  };
  if (headerResult) {
    logPayload.raw = scannedCandidates.find(c => c.cell === source_cell)?.raw || '';
    logPayload.project_code = headerResult.project_code;
    logPayload.scope_name = headerResult.scope_name;
    logPayload.company_name = headerResult.company_name;
    logPayload.source_cell = source_cell;
  }
  
  console.log(JSON.stringify(logPayload, null, 2));

  if (!headerResult) {
    throw new AppError(400, "WBS header not detected in first 10 rows. Ensure the sheet contains a header starting with 'WBS-' anywhere in the top section.");
  }

  const project_code = headerResult.project_code;
  const scope_name_display = headerResult.scope_name;
  const company_name = headerResult.company_name;
  const scope_name_normalized = normalizeScopeName(scope_name_display);

  let tableHeaderRowIndex = -1;
  let headers = [];
  for (let i = 0; i < rawData.length; i++) {
    const row = rawData[i].map(c => String(c).trim().toLowerCase());
    if (row.includes("fixture no") || row.includes("fixture_no")) {
      tableHeaderRowIndex = i;
      headers = row;
      break;
    }
  }

  if (tableHeaderRowIndex === -1) {
    throw new AppError(400, "Could not find data table. Missing 'FIXTURE NO' column header.");
  }

  const rawRows = [];
  for (let i = tableHeaderRowIndex + 1; i < rawData.length; i++) {
    const rowArr = rawData[i];
    if (rowArr.every(c => !String(c).trim())) continue;

    const rowObj = {};
    for (let j = 0; j < headers.length; j++) {
      if (headers[j]) {
        rowObj[headers[j]] = String(rowArr[j] || "").trim();
      }
    }
    rawRows.push({ rowObj, rowIndex: i + 1 });
  }

  const accepted = [];
  const conflicts = [];
  const rejected = [];

  const client = await pool.connect();
  let existingFixtures = [];
  try {
    const projectCheck = await client.query('SELECT id FROM design.projects WHERE project_no = $1 AND department_id = $2', [project_code, user.department_id]);
    if (projectCheck.rows.length > 0) {
      const projectId = projectCheck.rows[0].id;
      const scopeCheck = await client.query('SELECT id, scope_name FROM design.scopes WHERE project_id = $1', [projectId]);
      for (const sc of scopeCheck.rows) {
        if (normalizeScopeName(sc.scope_name) === scope_name_normalized) {
          existingFixtures = await findFixturesByScopeForDedupe(sc.id, client);
          break;
        }
      }
    }
  } finally {
    client.release();
  }

  const fixtureMap = new Map();
  existingFixtures.forEach(f => fixtureMap.set(String(f.fixture_no).trim(), f));

  rawRows.forEach((item) => {
    const { rowObj, rowIndex } = item;
    
    const getCol = (keyMatches) => {
      const key = headers.find(h => keyMatches.includes(h));
      return key ? rowObj[key] : '';
    };

    const fixture_no = getCol(['fixture no', 'fixture_no']);
    const op_no = getCol(['op.no', 'op_no', 'op no']);
    const part_name = getCol(['part name', 'part_name']);
    const fixture_type = getCol(['fixture type', 'fixture_type']);
    const qtyRaw = getCol(['qty', 'quantity']);

    const rowNum = rowIndex;

    if (!fixture_no || !op_no || !part_name || !fixture_type || !qtyRaw) {
      const missing = [];
      if (!fixture_no) missing.push("FIXTURE NO");
      if (!op_no) missing.push("OP.NO");
      if (!part_name) missing.push("Part Name");
      if (!fixture_type) missing.push("Fixture Type");
      if (!qtyRaw) missing.push("QTY");
      rejected.push({
        row_number: rowNum,
        error_message: `Missing fields: ${missing.join(', ')}`,
        raw_data: rowObj
      });
      return;
    }

    const qty = parseInt(qtyRaw, 10);
    if (isNaN(qty)) {
      rejected.push({ row_number: rowNum, error_message: "QTY must be a number", raw_data: rowObj });
      return;
    }

    const incoming = { row_number: rowNum, fixture_no, op_no, part_name, fixture_type, qty };

    const existing = fixtureMap.get(fixture_no);
    if (!existing) {
      accepted.push({ type: 'NEW', incoming });
      return;
    }

    const isQtyDiff = existing.qty !== incoming.qty;
    const isPartDiff = existing.part_name !== incoming.part_name;
    const isOtherDiff = existing.op_no !== incoming.op_no || existing.fixture_type !== incoming.fixture_type;

    if (!isQtyDiff && !isPartDiff && !isOtherDiff) {
      return; // SKIP
    }

    if (isQtyDiff && !isPartDiff && !isOtherDiff) {
      accepted.push({ type: 'UPDATE_QTY', incoming, existing });
      return;
    }

    if (isPartDiff) {
      conflicts.push({ type: 'CONFLICT_PART_NAME', incoming, existing });
      return;
    }

    conflicts.push({ type: 'CONFLICT_OTHER', incoming, existing });
  });

  return {
    file_info: {
      project_code,
      scope_name_display,
      company_name
    },
    preview: {
      accepted,
      conflicts,
      rejected
    }
  };
}

async function confirmUpload(user, payload) {
  if (!isDesignDepartment(user)) {
    throw new AppError(403, "This flow is only available to the Design department");
  }

  const { file_info, resolved_items, rejected_items } = payload;
  if (!file_info || !file_info.project_code || !file_info.scope_name_display || !file_info.company_name) {
    throw new AppError(400, "Missing file info in confirm payload");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const project = await upsertProjectByNumber({
      project_no: file_info.project_code,
      project_name: file_info.project_code,
      customer_name: file_info.company_name,
      department_id: user.department_id,
      uploaded_by: user.employee_id
    }, client);

    const scope = await findOrCreateScope(project.id, file_info.scope_name_display, client);

    let acceptedCount = 0;

    for (const item of resolved_items) {
      const fixtureData = item.data;
      const fixtureObj = {
        scope_id: scope.id,
        fixture_no: fixtureData.fixture_no,
        op_no: fixtureData.op_no,
        part_name: fixtureData.part_name,
        fixture_type: fixtureData.fixture_type,
        qty: fixtureData.qty,
      };

      await upsertFixture(fixtureObj, client);
      acceptedCount++;
    }

    const batchId = await createUploadBatch({
      project_id: project.id,
      scope_id: scope.id,
      uploaded_by: user.employee_id,
      total_rows: (resolved_items.length || 0) + (rejected_items.length || 0),
      accepted_rows: acceptedCount,
      rejected_rows: rejected_items.length || 0
    }, client);

    if (rejected_items && rejected_items.length > 0) {
      const errorsPayload = rejected_items.map(r => ({
        row_number: r.row_number,
        error_message: r.error_message
      }));
      await createUploadErrors(batchId, errorsPayload, client);
    }

    await client.query("COMMIT");
    return { success: true, batch_id: batchId, accepted_count: acceptedCount };
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("UPLOAD_CONFIRM_ERROR", err);
    throw new AppError(500, "Failed to confirm upload");
  } finally {
    client.release();
  }
}

module.exports = {
  parseAndPreviewUpload,
  confirmUpload
};
