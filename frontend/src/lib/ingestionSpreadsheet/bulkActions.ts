import type { EditableColumnId, SpreadsheetRow } from "./types";

export type BulkActionType =
  | "set_fixture_type"
  | "toggle_outsourced"
  | "set_vendor_type"
  | "delete_rows"
  | "dedupe_fixture_no";

export interface BulkActionRequest {
  type: BulkActionType;
  rowKeys: string[];
  value?: string;
}

export function applyBulkAction(
  rows: SpreadsheetRow[],
  cellOverrides: Record<string, Partial<Record<EditableColumnId, string>>>,
  request: BulkActionRequest,
): {
  nextOverrides: Record<string, Partial<Record<EditableColumnId, string>>>;
  removedRowKeys: string[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const removedRowKeys: string[] = [];
  const nextOverrides = { ...cellOverrides };
  const selected = new Set(request.rowKeys);

  const editableSelected = rows.filter((row) => selected.has(row.rowKey) && row.isEditable);

  if (request.type === "delete_rows") {
    if (editableSelected.length === 0) {
      warnings.push("Only invalid/duplicate rows can be removed from the draft grid.");
      return { nextOverrides, removedRowKeys, warnings };
    }
    for (const row of editableSelected) {
      removedRowKeys.push(row.rowKey);
      delete nextOverrides[row.rowKey];
    }
    return { nextOverrides, removedRowKeys, warnings };
  }

  if (editableSelected.length === 0) {
    warnings.push("Bulk edit applies to editable invalid/duplicate rows only.");
    return { nextOverrides, removedRowKeys, warnings };
  }

  for (const row of editableSelected) {
    const patch = { ...(nextOverrides[row.rowKey] || {}) };

    if (request.type === "set_fixture_type" && request.value) {
      patch.fixture_type = request.value.trim();
    }
    if (request.type === "toggle_outsourced") {
      const current = (patch.fixture_type ?? row.fixtureType).trim();
      patch.fixture_type = /outsourced|vendor/i.test(current) ? "Checking fixture" : "Outsourced";
    }
    if (request.type === "set_vendor_type" && request.value) {
      patch.fixture_type = request.value.trim();
    }
    if (request.type === "dedupe_fixture_no") {
      patch.fixture_no = `${row.fixtureNo}-dup-${row.gridIndex + 1}`;
      warnings.push("Duplicate fixture numbers were suffixed for manual correction.");
    }

    nextOverrides[row.rowKey] = patch;
  }

  return { nextOverrides, removedRowKeys, warnings };
}

export function getSelectedEditableRowKeys(
  rows: SpreadsheetRow[],
  selectedRowIndexes: number[],
): string[] {
  return selectedRowIndexes
    .map((index) => rows[index])
    .filter((row): row is SpreadsheetRow => !!row?.isEditable)
    .map((row) => row.rowKey);
}
