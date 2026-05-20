import type { DesignExcelUploadResponse } from "@/types";
import type { IngestionClassification, SpreadsheetRow } from "./types";

function asPreviewRow(value: unknown): SpreadsheetRow["incoming"] | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  return value as SpreadsheetRow["incoming"];
}

function asRejectedRow(value: unknown): SpreadsheetRow["rejected"] | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  return value as SpreadsheetRow["rejected"];
}

function pickIncomingFields(row: {
  incoming?: unknown;
  rejected?: unknown;
}): {
  fixtureNo: string;
  partName: string;
  fixtureType: string;
  qty: string;
  remark: string;
  partImageUrl: string | null;
  incoming?: SpreadsheetRow["incoming"];
} {
  const incoming = asPreviewRow(row.incoming);
  const rejected = asRejectedRow(row.rejected);
  const raw = rejected?.raw_data || {};

  const fixtureNo = String(
    incoming?.fixture_no
    ?? raw?.fixture_no
    ?? raw?.validation?.normalized?.fixture_no
    ?? "",
  ).trim();
  const partName = String(
    incoming?.part_name
    ?? raw?.part_name
    ?? raw?.validation?.normalized?.part_name
    ?? "",
  ).trim();
  const fixtureType = String(
    incoming?.fixture_type
    ?? raw?.fixture_type
    ?? raw?.validation?.normalized?.fixture_type
    ?? "",
  ).trim();
  const qty = String(
    incoming?.qty
    ?? raw?.qty
    ?? raw?.validation?.normalized?.qty
    ?? "",
  ).trim();
  const remark = String(incoming?.remark ?? raw?.remark ?? "").trim();

  return {
    fixtureNo,
    partName,
    fixtureType,
    qty,
    remark,
    partImageUrl: incoming?.image_1_url ?? null,
    incoming,
  };
}

export function buildSpreadsheetRows(preview: DesignExcelUploadResponse): SpreadsheetRow[] {
  const grid = preview.preview.ingestion_grid;
  if (Array.isArray(grid) && grid.length > 0) {
    return grid.map((entry, gridIndex) => {
      const classification = String(entry.classification || "INVALID") as IngestionClassification;
      const fields = pickIncomingFields({
        incoming: entry.incoming,
        rejected: entry.rejected,
      });
      const rejected = asRejectedRow(entry.rejected);
      const isEditable = classification === "INVALID" || classification === "DUPLICATE";

      return {
        rowKey: String(entry.row_key || `${gridIndex}`),
        gridIndex,
        rowNumber: Number(entry.row_number) || gridIndex + 1,
        excelRow: Number.isFinite(Number(entry.excel_row)) ? Number(entry.excel_row) : null,
        rowReference: String(entry.row_reference || ""),
        classification,
        diffType: entry.diff_type ? String(entry.diff_type) : null,
        conflictKind: entry.conflict_kind ? String(entry.conflict_kind) : null,
        fixtureNo: fields.fixtureNo,
        partName: fields.partName,
        fixtureType: fields.fixtureType,
        qty: fields.qty,
        remark: fields.remark,
        partImageUrl: fields.partImageUrl,
        incoming: fields.incoming,
        existing: asPreviewRow(entry.existing),
        rejected,
        errorMessage: entry.error_message ? String(entry.error_message) : rejected?.error_message,
        problemFields: Array.isArray(entry.problem_fields)
          ? entry.problem_fields.map(String)
          : (rejected?.raw_data?.validation?.problem_fields || []).map(String),
        skipReason: entry.skip_reason ? String(entry.skip_reason) : undefined,
        isEditable,
      };
    });
  }

  return fallbackRowsFromPreviewBuckets(preview);
}

function fallbackRowsFromPreviewBuckets(preview: DesignExcelUploadResponse): SpreadsheetRow[] {
  const rows: SpreadsheetRow[] = [];
  let gridIndex = 0;

  const push = (partial: Omit<SpreadsheetRow, "gridIndex">) => {
    rows.push({ ...partial, gridIndex: gridIndex++ });
  };

  for (const item of preview.preview.accepted) {
    push({
      rowKey: `${item.incoming.fixture_no}::${item.incoming.row_number}`,
      rowNumber: item.incoming.row_number,
      excelRow: item.incoming.excel_row ?? null,
      rowReference: item.incoming.row_reference,
      classification: item.classification === "UPDATED" ? "UPDATED" : "NEW",
      diffType: item.type,
      fixtureNo: item.incoming.fixture_no,
      partName: item.incoming.part_name,
      fixtureType: item.incoming.fixture_type,
      qty: String(item.incoming.qty),
      remark: String(item.incoming.remark ?? ""),
      partImageUrl: item.incoming.image_1_url ?? null,
      incoming: item.incoming,
      existing: item.existing,
      problemFields: [],
      isEditable: false,
    });
  }

  for (const item of preview.preview.unchanged || []) {
    push({
      rowKey: `${item.incoming.fixture_no}::${item.incoming.row_number}`,
      rowNumber: item.incoming.row_number,
      excelRow: item.incoming.excel_row ?? null,
      rowReference: item.incoming.row_reference,
      classification: "EXISTING",
      diffType: item.type,
      fixtureNo: item.incoming.fixture_no,
      partName: item.incoming.part_name,
      fixtureType: item.incoming.fixture_type,
      qty: String(item.incoming.qty),
      remark: String(item.incoming.remark ?? ""),
      partImageUrl: item.incoming.image_1_url ?? null,
      incoming: item.incoming,
      existing: item.existing,
      problemFields: [],
      isEditable: false,
    });
  }

  for (const item of preview.preview.conflicts) {
    push({
      rowKey: `${item.incoming.fixture_no}::${item.incoming.row_number}`,
      rowNumber: item.incoming.row_number,
      excelRow: item.incoming.excel_row ?? null,
      rowReference: item.incoming.row_reference,
      classification: "CONFLICT",
      diffType: item.type,
      conflictKind: item.conflict_kind ?? null,
      fixtureNo: item.incoming.fixture_no,
      partName: item.incoming.part_name,
      fixtureType: item.incoming.fixture_type,
      qty: String(item.incoming.qty),
      remark: String(item.incoming.remark ?? ""),
      partImageUrl: item.incoming.image_1_url ?? null,
      incoming: item.incoming,
      existing: item.existing,
      problemFields: [],
      isEditable: false,
    });
  }

  for (const item of preview.preview.skipped) {
    push({
      rowKey: `${item.fixture_no}::${item.row_number}`,
      rowNumber: item.row_number,
      excelRow: item.excel_row ?? null,
      rowReference: item.row_reference,
      classification: "SKIPPED",
      diffType: null,
      fixtureNo: item.fixture_no,
      partName: item.part_name,
      fixtureType: item.fixture_type,
      qty: String(item.qty),
      remark: String(item.remark ?? ""),
      partImageUrl: item.image_1_url ?? null,
      incoming: item,
      problemFields: [],
      skipReason: item.skip_reason,
      isEditable: false,
    });
  }

  for (const rejected of preview.preview.rejected) {
    const fields = pickIncomingFields({ rejected });
    const classification: IngestionClassification =
      rejected.raw_data?.validation?.reason === "duplicate_fixture_no" ? "DUPLICATE" : "INVALID";
    push({
      rowKey: [
        rejected.row_reference,
        rejected.excel_row ?? "",
        rejected.error_message?.slice(0, 48) || "",
      ].join("::"),
      rowNumber: rejected.row_number,
      excelRow: rejected.excel_row ?? null,
      rowReference: rejected.row_reference,
      classification,
      diffType: null,
      fixtureNo: fields.fixtureNo,
      partName: fields.partName,
      fixtureType: fields.fixtureType,
      qty: fields.qty,
      remark: fields.remark,
      partImageUrl: fields.partImageUrl,
      rejected,
      errorMessage: rejected.error_message,
      problemFields: fields.incoming ? [] : (rejected.raw_data?.validation?.problem_fields || []).map(String),
      isEditable: true,
    });
  }

  return rows.sort((a, b) => {
    const ae = a.excelRow ?? 1e9;
    const be = b.excelRow ?? 1e9;
    if (ae !== be) return ae - be;
    return a.rowNumber - b.rowNumber;
  }).map((row, index) => ({ ...row, gridIndex: index }));
}

export function rowDecisionKey(row: SpreadsheetRow): string {
  if (row.incoming) {
    return `${row.incoming.fixture_no}::${row.incoming.row_number}`;
  }
  return row.rowKey;
}

export function isOutsourcedFixtureType(value: string): boolean {
  return /^(vendor|outsourced|outsourcing|o\/s|sub[- ]?con|subcon|scm vendor)$/i.test(value.trim());
}
