import type { EditableColumnId } from "./types";
import type { SpreadsheetRow } from "./types";

export function applyFillDown(
  rows: SpreadsheetRow[],
  selectedRowIndexes: number[],
  columnId: EditableColumnId,
  sourceValue: string,
): Record<string, Partial<Record<EditableColumnId, string>>> {
  const patches: Record<string, Partial<Record<EditableColumnId, string>>> = {};

  for (const rowIndex of selectedRowIndexes) {
    const row = rows[rowIndex];
    if (!row?.isEditable) {
      continue;
    }
    patches[row.rowKey] = {
      ...(patches[row.rowKey] || {}),
      [columnId]: sourceValue,
    };
  }

  return patches;
}

export function duplicateRowValues(
  row: SpreadsheetRow,
): Partial<Record<EditableColumnId, string>> {
  return {
    fixture_no: row.fixtureNo,
    part_name: row.partName,
    fixture_type: row.fixtureType,
    qty: row.qty,
  };
}
