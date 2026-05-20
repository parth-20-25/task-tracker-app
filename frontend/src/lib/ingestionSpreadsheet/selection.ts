import type { CellCoord, SelectionRange, SpreadsheetColumnId } from "./types";
import { GRID_COLUMNS } from "./types";

export function normalizeRange(range: SelectionRange): SelectionRange {
  const startRow = Math.min(range.start.rowIndex, range.end.rowIndex);
  const endRow = Math.max(range.start.rowIndex, range.end.rowIndex);
  const startColIndex = Math.min(
    GRID_COLUMNS.indexOf(range.start.columnId),
    GRID_COLUMNS.indexOf(range.end.columnId),
  );
  const endColIndex = Math.max(
    GRID_COLUMNS.indexOf(range.start.columnId),
    GRID_COLUMNS.indexOf(range.end.columnId),
  );

  return {
    start: { rowIndex: startRow, columnId: GRID_COLUMNS[startColIndex] },
    end: { rowIndex: endRow, columnId: GRID_COLUMNS[endColIndex] },
  };
}

export function isCellInRange(coord: CellCoord, range: SelectionRange | null): boolean {
  if (!range) {
    return false;
  }
  const normalized = normalizeRange(range);
  const colIndex = GRID_COLUMNS.indexOf(coord.columnId);
  const startCol = GRID_COLUMNS.indexOf(normalized.start.columnId);
  const endCol = GRID_COLUMNS.indexOf(normalized.end.columnId);
  return (
    coord.rowIndex >= normalized.start.rowIndex
    && coord.rowIndex <= normalized.end.rowIndex
    && colIndex >= startCol
    && colIndex <= endCol
  );
}

export function moveSelection(
  coord: CellCoord,
  direction: "up" | "down" | "left" | "right",
  rowCount: number,
): CellCoord {
  const colIndex = GRID_COLUMNS.indexOf(coord.columnId);
  if (direction === "up") {
    return { rowIndex: Math.max(0, coord.rowIndex - 1), columnId: coord.columnId };
  }
  if (direction === "down") {
    return { rowIndex: Math.min(rowCount - 1, coord.rowIndex + 1), columnId: coord.columnId };
  }
  if (direction === "left") {
    return { rowIndex: coord.rowIndex, columnId: GRID_COLUMNS[Math.max(0, colIndex - 1)] };
  }
  return { rowIndex: coord.rowIndex, columnId: GRID_COLUMNS[Math.min(GRID_COLUMNS.length - 1, colIndex + 1)] };
}

export function expandRangeToRow(range: SelectionRange, rowIndex: number): SelectionRange {
  return normalizeRange({
    start: { rowIndex, columnId: range.start.columnId },
    end: { rowIndex, columnId: range.end.columnId },
  });
}
