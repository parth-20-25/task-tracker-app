import type { EditableColumnId, SpreadsheetColumnId } from "./types";
import { EDITABLE_COLUMNS } from "./types";

export function normalizeClipboardCell(value: string): string {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.+$/g, "")
    .trim();
}

export function parseClipboardMatrix(raw: string): string[][] {
  const normalized = String(raw || "").replace(/\r/g, "").trim();
  if (!normalized) {
    return [];
  }

  const lines = normalized.split("\n").map((line) => line.trim()).filter(Boolean);
  return lines.map((line) => {
    if (line.includes("\t")) {
      return line.split("\t").map(normalizeClipboardCell);
    }
    if (/\s{2,}/.test(line)) {
      return line.split(/\s{2,}/).map(normalizeClipboardCell);
    }
    return [normalizeClipboardCell(line)];
  });
}

const COLUMN_ORDER: SpreadsheetColumnId[] = [
  "fixture_no",
  "part_name",
  "fixture_type",
  "qty",
];

export function mapMatrixToEditableColumns(
  matrix: string[][],
  startColumn: EditableColumnId,
): Array<Partial<Record<EditableColumnId, string>>> {
  const startIndex = EDITABLE_COLUMNS.indexOf(startColumn);
  if (startIndex < 0) {
    return [];
  }

  return matrix.map((cells) => {
    const patch: Partial<Record<EditableColumnId, string>> = {};
    cells.forEach((cell, offset) => {
      const column = EDITABLE_COLUMNS[startIndex + offset];
      if (column) {
        patch[column] = normalizeClipboardCell(cell);
      }
    });
    return patch;
  });
}

export function alignPasteToSelection(
  matrix: string[][],
  rowCount: number,
  columnCount: number,
): string[][] {
  if (matrix.length === 0) {
    return [];
  }

  const sourceCols = Math.max(...matrix.map((r) => r.length), 1);
  const targetRows = rowCount > 0 ? rowCount : matrix.length;
  const targetCols = columnCount > 0 ? columnCount : sourceCols;
  const result: string[][] = [];

  for (let r = 0; r < targetRows; r += 1) {
    const source = matrix[r % matrix.length] || [""];
    const row: string[] = [];
    for (let c = 0; c < targetCols; c += 1) {
      row.push(source[c] ?? "");
    }
    result.push(row);
  }

  return result;
}

export function serializeMatrix(matrix: string[][]): string {
  return matrix.map((row) => row.join("\t")).join("\n");
}

export function columnIdToEditable(columnId: SpreadsheetColumnId): EditableColumnId | null {
  if (COLUMN_ORDER.includes(columnId as EditableColumnId)) {
    return columnId as EditableColumnId;
  }
  return null;
}
