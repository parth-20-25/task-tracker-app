const { canonicalFixtureNo } = require("./normalize");

function gridRowKeyFromIncoming(row) {
  const ref = String(row?.row_reference || row?.excel_row || row?.row_number || "");
  return `${canonicalFixtureNo(row?.fixture_no)}::${ref}`;
}

function formatPreview(diffResults, rejectedRows, skippedRows = []) {
  const accepted = [];
  const conflicts = [];
  const unchanged = [];
  const ingestion_grid = [];

  for (const result of diffResults) {
    if (result.type === "NEW" || result.type === "UPDATE_QTY") {
      accepted.push(result);
      ingestion_grid.push({
        row_key: gridRowKeyFromIncoming(result.incoming),
        row_number: result.incoming.row_number,
        excel_row: result.incoming.excel_row ?? null,
        row_reference: result.incoming.row_reference,
        classification: result.classification || (result.type === "NEW" ? "NEW" : "UPDATED"),
        diff_type: result.type,
        incoming: result.incoming,
        existing: result.existing || null,
      });
    } else if (result.type === "UNCHANGED") {
      unchanged.push(result);
      ingestion_grid.push({
        row_key: gridRowKeyFromIncoming(result.incoming),
        row_number: result.incoming.row_number,
        excel_row: result.incoming.excel_row ?? null,
        row_reference: result.incoming.row_reference,
        classification: "EXISTING",
        diff_type: "UNCHANGED",
        incoming: result.incoming,
        existing: result.existing,
      });
    } else if (
      result.type === "CONFLICT_PART_NAME"
      || result.type === "CONFLICT_OTHER"
      || result.type === "CONFLICT_IMAGES"
    ) {
      conflicts.push(result);
      ingestion_grid.push({
        row_key: gridRowKeyFromIncoming(result.incoming),
        row_number: result.incoming.row_number,
        excel_row: result.incoming.excel_row ?? null,
        row_reference: result.incoming.row_reference,
        classification: "CONFLICT",
        diff_type: result.type,
        conflict_kind: result.conflict_kind || null,
        incoming: result.incoming,
        existing: result.existing,
      });
    }
  }

  const rejected = [...rejectedRows];
  for (const r of rejected) {
    const reason = r.raw_data?.validation?.reason;
    const classification = reason === "duplicate_fixture_no" ? "DUPLICATE" : "INVALID";
    ingestion_grid.push({
      row_key: [
        r.row_reference || "",
        r.excel_row ?? "",
        r.error_message?.slice(0, 48) || "",
      ].join("::"),
      row_number: r.row_number,
      excel_row: r.excel_row ?? null,
      row_reference: r.row_reference,
      classification,
      diff_type: null,
      error_message: r.error_message,
      problem_fields: r.raw_data?.validation?.problem_fields || [],
      rejected: r,
    });
  }

  const skipped = [...skippedRows];
  for (const s of skipped) {
    ingestion_grid.push({
      row_key: gridRowKeyFromIncoming(s),
      row_number: s.row_number,
      excel_row: s.excel_row ?? null,
      row_reference: s.row_reference,
      classification: "SKIPPED",
      diff_type: null,
      skip_reason: s.skip_reason,
      incoming: s,
    });
  }

  ingestion_grid.sort((a, b) => {
    const ae = Number.isFinite(Number(a.excel_row)) ? Number(a.excel_row) : 1e9;
    const be = Number.isFinite(Number(b.excel_row)) ? Number(b.excel_row) : 1e9;
    if (ae !== be) {
      return ae - be;
    }
    return (a.row_number || 0) - (b.row_number || 0);
  });

  const validation_summary = {
    total_rows: ingestion_grid.length,
    by_classification: ingestion_grid.reduce((acc, row) => {
      const k = row.classification || "UNKNOWN";
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {}),
    invalid_rows: rejected.length,
    duplicate_rows: rejected.filter((row) => row.raw_data?.validation?.reason === "duplicate_fixture_no").length,
  };

  return {
    accepted,
    conflicts,
    unchanged,
    rejected,
    skipped,
    ingestion_grid,
    validation_summary,
  };
}

module.exports = {
  formatPreview,
};
