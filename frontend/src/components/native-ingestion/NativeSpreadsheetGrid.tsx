import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ImagePlus, Plus, Rows3, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type {
  NativeColumn,
  NativeEditableColumn,
  NativeIngestionRow,
} from "./NativeIngestionTypes";
import { NATIVE_EDITABLE_COLUMNS } from "./NativeIngestionTypes";
import {
  createEmptyNativeRow,
  padRows,
  parseClipboardMatrix,
  patchRowCell,
  serializeCell,
} from "./nativeIngestionUtils";

interface CellCoord {
  rowIndex: number;
  column: NativeEditableColumn;
}

interface SelectionRange {
  start: CellCoord;
  end: CellCoord;
}

interface NativeSpreadsheetGridProps {
  rows: NativeIngestionRow[];
  onRowsChange: (rows: NativeIngestionRow[]) => void;
  onFocusConflict: (row: NativeIngestionRow | null) => void;
  onStageImage: (row: NativeIngestionRow, imageSlot: "image_1_url" | "image_2_url", file: File) => Promise<void>;
  isBusy?: boolean;
}

const ROW_HEIGHT = 42;

const COLUMNS: Array<{
  key: NativeColumn;
  label: string;
  width: string;
}> = [
  { key: "status", label: "Status", width: "w-[104px]" },
  { key: "fixture_no", label: "Fixture No", width: "w-[148px]" },
  { key: "part_name", label: "Part Name", width: "w-[220px]" },
  { key: "fixture_type", label: "Fixture Type", width: "w-[190px]" },
  { key: "remark", label: "Remark", width: "w-[210px]" },
  { key: "qty", label: "Qty", width: "w-[82px]" },
  { key: "is_outsourced", label: "Outsourced", width: "w-[112px]" },
  { key: "vendor_name", label: "Vendor", width: "w-[176px]" },
  { key: "image_1_url", label: "Image 1", width: "w-[190px]" },
  { key: "image_2_url", label: "Image 2", width: "w-[190px]" },
  { key: "validation_state", label: "Validation State", width: "w-[320px]" },
];

const EDITABLE_SET = new Set<NativeColumn>(NATIVE_EDITABLE_COLUMNS);

function isEditableColumn(column: NativeColumn): column is NativeEditableColumn {
  return EDITABLE_SET.has(column);
}

function rowStatusClass(row: NativeIngestionRow) {
  if (row.classification === "CONFLICT") return "border-orange-200 bg-orange-50 text-orange-800";
  if (row.classification === "DUPLICATE" || row.classification === "INVALID" || row.severity === "error") {
    return "border-red-200 bg-red-50 text-red-800";
  }
  if (row.classification === "UPDATED" || row.severity === "warning") return "border-amber-200 bg-amber-50 text-amber-800";
  if (row.classification === "NEW" || row.classification === "EXISTING" || row.severity === "safe") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }
  return "border-slate-200 bg-slate-50 text-slate-500";
}

function cellStateClass(row: NativeIngestionRow, column: NativeColumn) {
  const state = row.cell_states?.[column as NativeEditableColumn];
  if (state === "error") return "bg-red-50 ring-1 ring-red-300";
  if (state === "conflict") return "bg-orange-50 ring-1 ring-orange-300";
  if (state === "warning") return "bg-amber-50 ring-1 ring-amber-300";
  if (row.severity === "safe" && isEditableColumn(column)) return "bg-emerald-50/50";
  return "";
}

function normalizeRange(range: SelectionRange): SelectionRange {
  const startRow = Math.min(range.start.rowIndex, range.end.rowIndex);
  const endRow = Math.max(range.start.rowIndex, range.end.rowIndex);
  const startCol = Math.min(
    NATIVE_EDITABLE_COLUMNS.indexOf(range.start.column),
    NATIVE_EDITABLE_COLUMNS.indexOf(range.end.column),
  );
  const endCol = Math.max(
    NATIVE_EDITABLE_COLUMNS.indexOf(range.start.column),
    NATIVE_EDITABLE_COLUMNS.indexOf(range.end.column),
  );

  return {
    start: { rowIndex: startRow, column: NATIVE_EDITABLE_COLUMNS[startCol] },
    end: { rowIndex: endRow, column: NATIVE_EDITABLE_COLUMNS[endCol] },
  };
}

function coordInRange(coord: CellCoord, range: SelectionRange | null) {
  if (!range) return false;
  const normalized = normalizeRange(range);
  const colIndex = NATIVE_EDITABLE_COLUMNS.indexOf(coord.column);
  const startCol = NATIVE_EDITABLE_COLUMNS.indexOf(normalized.start.column);
  const endCol = NATIVE_EDITABLE_COLUMNS.indexOf(normalized.end.column);
  return coord.rowIndex >= normalized.start.rowIndex
    && coord.rowIndex <= normalized.end.rowIndex
    && colIndex >= startCol
    && colIndex <= endCol;
}

function nextCell(coord: CellCoord, key: string, rowCount: number): CellCoord {
  const colIndex = NATIVE_EDITABLE_COLUMNS.indexOf(coord.column);
  if (key === "ArrowUp") return { ...coord, rowIndex: Math.max(0, coord.rowIndex - 1) };
  if (key === "ArrowDown" || key === "Enter") return { ...coord, rowIndex: Math.min(rowCount - 1, coord.rowIndex + 1) };
  if (key === "ArrowLeft") return { rowIndex: coord.rowIndex, column: NATIVE_EDITABLE_COLUMNS[Math.max(0, colIndex - 1)] };
  if (key === "ArrowRight" || key === "Tab") {
    if (colIndex >= NATIVE_EDITABLE_COLUMNS.length - 1) {
      return { rowIndex: Math.min(rowCount - 1, coord.rowIndex + 1), column: NATIVE_EDITABLE_COLUMNS[0] };
    }
    return { rowIndex: coord.rowIndex, column: NATIVE_EDITABLE_COLUMNS[colIndex + 1] };
  }
  return coord;
}

export function NativeSpreadsheetGrid({
  rows,
  onRowsChange,
  onFocusConflict,
  onStageImage,
  isBusy,
}: NativeSpreadsheetGridProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [activeCell, setActiveCell] = useState<CellCoord | null>(null);
  const [selection, setSelection] = useState<SelectionRange | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [fillTarget, setFillTarget] = useState<CellCoord | null>(null);
  const [fillSource, setFillSource] = useState<CellCoord | null>(null);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  const selectedCount = selectedRows.size;

  const focusCell = useCallback((coord: CellCoord) => {
    setActiveCell(coord);
    setSelection({ start: coord, end: coord });
    window.setTimeout(() => {
      const target = scrollRef.current?.querySelector<HTMLInputElement | HTMLButtonElement>(
        `[data-native-cell="${coord.rowIndex}:${coord.column}"]`,
      );
      target?.focus();
    }, 0);
  }, []);

  const setCell = useCallback((rowIndex: number, column: NativeEditableColumn, value: string | boolean) => {
    onRowsChange(rows.map((row, index) => (
      index === rowIndex ? patchRowCell(row, column, value) : row
    )));
  }, [onRowsChange, rows]);

  const applyPaste = useCallback((text: string) => {
    if (!activeCell) return;
    const matrix = parseClipboardMatrix(text);
    if (matrix.length === 0) return;

    const startCol = NATIVE_EDITABLE_COLUMNS.indexOf(activeCell.column);
    const neededRows = activeCell.rowIndex + matrix.length;
    let nextRows = rows;
    if (neededRows > rows.length) {
      nextRows = padRows(rows, neededRows);
    }

    const patched = nextRows.map((row) => ({ ...row }));
    matrix.forEach((line, rowOffset) => {
      const rowIndex = activeCell.rowIndex + rowOffset;
      line.forEach((cell, colOffset) => {
        const column = NATIVE_EDITABLE_COLUMNS[startCol + colOffset];
        if (!column || !patched[rowIndex]) return;
        patched[rowIndex] = patchRowCell(patched[rowIndex], column, cell);
      });
    });
    onRowsChange(padRows(patched));
  }, [activeCell, onRowsChange, rows]);

  const serializeSelection = useCallback(() => {
    if (!activeCell) return "";
    const range = selection ? normalizeRange(selection) : { start: activeCell, end: activeCell };
    const startCol = NATIVE_EDITABLE_COLUMNS.indexOf(range.start.column);
    const endCol = NATIVE_EDITABLE_COLUMNS.indexOf(range.end.column);
    const lines: string[] = [];

    for (let rowIndex = range.start.rowIndex; rowIndex <= range.end.rowIndex; rowIndex += 1) {
      const row = rows[rowIndex];
      if (!row) continue;
      const cells = [];
      for (let colIndex = startCol; colIndex <= endCol; colIndex += 1) {
        cells.push(serializeCell(row, NATIVE_EDITABLE_COLUMNS[colIndex]));
      }
      lines.push(cells.join("\t"));
    }

    return lines.join("\n");
  }, [activeCell, rows, selection]);

  const deleteSelectedRows = () => {
    if (selectedRows.size === 0) return;
    const next = rows.filter((_, index) => !selectedRows.has(index));
    setSelectedRows(new Set());
    onRowsChange(padRows(next));
  };

  const insertRowAbove = () => {
    const index = activeCell?.rowIndex ?? 0;
    const next = [...rows];
    next.splice(index, 0, createEmptyNativeRow(index));
    onRowsChange(padRows(next, next.length));
    focusCell({ rowIndex: index, column: "fixture_no" });
  };

  const appendRows = () => {
    const next = padRows([...rows, createEmptyNativeRow(rows.length)], rows.length + 8);
    onRowsChange(next);
    focusCell({ rowIndex: rows.length, column: "fixture_no" });
  };

  useEffect(() => {
    if (!fillSource) return;

    const handleMouseUp = () => {
      if (!fillTarget || fillTarget.column !== fillSource.column) {
        setFillSource(null);
        setFillTarget(null);
        return;
      }
      const sourceRow = rows[fillSource.rowIndex];
      if (!sourceRow) return;

      const value = serializeCell(sourceRow, fillSource.column);
      const start = Math.min(fillSource.rowIndex, fillTarget.rowIndex);
      const end = Math.max(fillSource.rowIndex, fillTarget.rowIndex);
      const patched = rows.map((row, index) => {
        if (index <= start || index > end) return row;
        return patchRowCell(row, fillSource.column, value);
      });
      onRowsChange(patched);
      setFillSource(null);
      setFillTarget(null);
    };

    window.addEventListener("mouseup", handleMouseUp);
    return () => window.removeEventListener("mouseup", handleMouseUp);
  }, [fillSource, fillTarget, onRowsChange, rows]);

  const renderCell = (row: NativeIngestionRow, rowIndex: number, column: NativeColumn) => {
    const active = activeCell?.rowIndex === rowIndex && activeCell.column === column;
    const selectableColumn = isEditableColumn(column);
    const inSelection = selectableColumn && coordInRange({ rowIndex, column }, selection);

    const baseClass = cn(
      "relative flex h-10 shrink-0 items-center border-r border-slate-200 bg-white px-1",
      COLUMNS.find((item) => item.key === column)?.width,
      cellStateClass(row, column),
      inSelection && "outline outline-1 outline-primary/60",
      active && "z-[1] outline outline-2 outline-primary",
    );

    const activate = (event: React.MouseEvent) => {
      if (!selectableColumn) return;
      const coord = { rowIndex, column };
      if (event.shiftKey && activeCell) {
        setSelection({ start: activeCell, end: coord });
      } else {
        setActiveCell(coord);
        setSelection({ start: coord, end: coord });
      }
    };

    if (column === "status") {
      return (
        <div key={column} className={baseClass}>
          <span className={cn("rounded border px-1.5 py-0.5 text-[10px] font-bold", rowStatusClass(row))}>
            {row.classification || row.status || "DRAFT"}
          </span>
        </div>
      );
    }

    if (column === "validation_state") {
      return (
        <div key={column} className={cn(baseClass, "text-xs text-slate-600")} title={row.validation_state || ""}>
          <span className="truncate">{row.validation_state || ""}</span>
        </div>
      );
    }

    if (column === "is_outsourced") {
      return (
        <div
          key={column}
          className={cn(baseClass, "justify-center")}
          onMouseDown={activate}
          onMouseEnter={() => fillSource?.column === column && setFillTarget({ rowIndex, column })}
        >
          <Checkbox
            data-native-cell={`${rowIndex}:${column}`}
            checked={row.is_outsourced}
            onCheckedChange={(checked) => setCell(rowIndex, column, checked === true)}
            disabled={isBusy}
          />
        </div>
      );
    }

    if (column === "image_1_url" || column === "image_2_url") {
      return (
        <div
          key={column}
          className={baseClass}
          onMouseDown={activate}
          onMouseEnter={() => fillSource?.column === column && setFillTarget({ rowIndex, column })}
        >
          <Input
            data-native-cell={`${rowIndex}:${column}`}
            value={String(row[column] || "")}
            disabled={isBusy}
            onFocus={() => {
              setActiveCell({ rowIndex, column });
              onFocusConflict(row.classification === "CONFLICT" ? row : null);
            }}
            onChange={(event) => setCell(rowIndex, column, event.target.value)}
            onKeyDown={(event) => {
              if (["Tab", "Enter"].includes(event.key)) {
                event.preventDefault();
                focusCell(nextCell({ rowIndex, column }, event.key, rows.length));
              }
            }}
            className="h-8 flex-1 border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-0"
          />
          <label className="ml-1 flex h-7 w-7 cursor-pointer items-center justify-center rounded border hover:bg-muted">
            <ImagePlus className="h-3.5 w-3.5" />
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={isBusy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  void onStageImage(row, column, file);
                }
                event.currentTarget.value = "";
              }}
            />
          </label>
        </div>
      );
    }

    const disabled = column === "vendor_name" && !row.is_outsourced;

    return (
      <div
        key={column}
        className={baseClass}
        onMouseDown={activate}
        onMouseEnter={() => fillSource?.column === column && setFillTarget({ rowIndex, column })}
      >
        <Input
          data-native-cell={`${rowIndex}:${column}`}
          value={String(row[column] || "")}
          disabled={isBusy || disabled}
          onFocus={() => {
            setActiveCell({ rowIndex, column });
            onFocusConflict(row.classification === "CONFLICT" ? row : null);
          }}
          onChange={(event) => setCell(rowIndex, column, event.target.value)}
          onKeyDown={(event) => {
            if (["Tab", "Enter"].includes(event.key)) {
              event.preventDefault();
              focusCell(nextCell({ rowIndex, column }, event.key, rows.length));
            }
          }}
          className={cn(
            "h-8 border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-0",
            disabled && "cursor-not-allowed text-slate-400",
          )}
        />
        {active && (
          <button
            type="button"
            className="absolute bottom-0 right-0 h-2.5 w-2.5 cursor-crosshair bg-primary"
            onMouseDown={(event) => {
              event.preventDefault();
              setFillSource({ rowIndex, column });
              setFillTarget({ rowIndex, column });
            }}
            aria-label="Drag fill"
          />
        )}
      </div>
    );
  };

  const visibleRows = virtualizer.getVirtualItems();
  const totalWidthClass = "min-w-[1960px]";

  return (
    <div className="flex min-h-0 flex-1 flex-col border-t bg-white">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b bg-slate-50 px-3 py-2 text-xs">
        <div className="flex items-center gap-2 text-slate-600">
          <Rows3 className="h-4 w-4" />
          <span>{rows.length} rows</span>
          <span>{selectedCount} selected</span>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={insertRowAbove} disabled={isBusy}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            Insert
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={appendRows} disabled={isBusy}>
            Add Rows
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={deleteSelectedRows}
            disabled={isBusy || selectedCount === 0}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="mr-1 h-3.5 w-3.5" />
            Delete
          </Button>
        </div>
      </div>

      <div
        ref={scrollRef}
        tabIndex={0}
        className="min-h-0 flex-1 overflow-auto outline-none"
        onPaste={(event) => {
          event.preventDefault();
          applyPaste(event.clipboardData.getData("text/plain"));
        }}
        onCopy={(event) => {
          const text = serializeSelection();
          if (text) {
            event.preventDefault();
            event.clipboardData.setData("text/plain", text);
          }
        }}
        onKeyDown={(event) => {
          if (!activeCell) return;
          if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
            event.preventDefault();
            focusCell(nextCell(activeCell, event.key, rows.length));
          }
        }}
      >
        <div className={cn("sticky top-0 z-10 flex border-b border-slate-300 bg-slate-100 text-[11px] font-semibold uppercase text-slate-600", totalWidthClass)}>
          <div className="sticky left-0 z-20 flex h-9 w-12 shrink-0 items-center justify-center border-r bg-slate-100">#</div>
          {COLUMNS.map((column) => (
            <div key={column.key} className={cn("flex h-9 shrink-0 items-center border-r px-2", column.width)}>
              {column.label}
            </div>
          ))}
        </div>

        <div className={cn("relative", totalWidthClass)} style={{ height: virtualizer.getTotalSize() }}>
          {visibleRows.map((virtualRow) => {
            const row = rows[virtualRow.index];
            if (!row) return null;
            const rowSelected = selectedRows.has(virtualRow.index);
            return (
              <div
                key={row.row_id}
                className={cn(
                  "absolute left-0 top-0 flex border-b border-slate-200 text-xs",
                  totalWidthClass,
                  rowSelected && "bg-primary/5",
                )}
                style={{
                  height: virtualRow.size,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <button
                  type="button"
                  className={cn(
                    "sticky left-0 z-[2] flex h-10 w-12 shrink-0 items-center justify-center border-r bg-slate-50 text-[11px] text-slate-500",
                    rowSelected && "bg-primary/10 text-primary",
                  )}
                  onClick={(event) => {
                    setSelectedRows((current) => {
                      const next = event.shiftKey ? new Set(current) : new Set<number>();
                      if (next.has(virtualRow.index)) next.delete(virtualRow.index);
                      else next.add(virtualRow.index);
                      return next;
                    });
                    onFocusConflict(row.classification === "CONFLICT" ? row : null);
                  }}
                >
                  {virtualRow.index + 1}
                </button>
                {COLUMNS.map((column) => renderCell(row, virtualRow.index, column.key))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
