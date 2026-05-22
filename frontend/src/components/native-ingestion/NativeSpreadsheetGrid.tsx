import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Eye,
  ImagePlus,
  PanelRightOpen,
  Plus,
  Redo2,
  Rows3,
  Trash2,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type {
  NativeColumn,
  NativeEditableColumn,
  NativeIngestionIssue,
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
  onStageImage: (row: NativeIngestionRow, file: File) => Promise<void>;
  isBusy?: boolean;
}

const ROW_HEIGHT = 42;
const ROW_NUMBER_WIDTH = 48;
const MIN_GRID_WIDTH = 1180;

const BASE_COLUMNS: Array<{
  key: NativeColumn;
  label: string;
  width: number;
  editable?: boolean;
  sticky?: boolean;
}> = [
  { key: "fixture_no", label: "Fixture No", width: 148, editable: true, sticky: true },
  { key: "part_name", label: "Part Name", width: 230, editable: true },
  { key: "fixture_type", label: "Fixture Type", width: 176, editable: true },
  { key: "qty", label: "Qty", width: 72, editable: true },
  { key: "status", label: "Status", width: 112 },
  { key: "assigned_team", label: "Assigned Team", width: 150 },
  { key: "reference_image_url", label: "Reference Image", width: 188, editable: true },
  { key: "remark", label: "Remarks", width: 230, editable: true },
];

const DETAIL_COLUMNS: typeof BASE_COLUMNS = [
  { key: "is_outsourced", label: "Outsourced", width: 112, editable: true },
  { key: "vendor_name", label: "Vendor", width: 170, editable: true },
  { key: "validation_state", label: "Row Errors", width: 300 },
];

const EDITABLE_SET = new Set<NativeColumn>(NATIVE_EDITABLE_COLUMNS);

function isEditableColumn(column: NativeColumn): column is NativeEditableColumn {
  return EDITABLE_SET.has(column);
}

function rowStatusClass(row: NativeIngestionRow) {
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
  if (state === "error") return "bg-red-50 ring-1 ring-red-400";
  if (state === "warning") return "bg-amber-50 ring-1 ring-amber-300";
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

function issuesForColumn(row: NativeIngestionRow, column: NativeColumn): NativeIngestionIssue[] {
  return (row.issues || []).filter((issue) => issue.columns?.includes(column as NativeEditableColumn));
}

function issueTitle(issues: NativeIngestionIssue[]) {
  return issues.map((issue) => issue.message).join("\n");
}

function fileFromClipboard(event: React.ClipboardEvent) {
  const items = Array.from(event.clipboardData.items || []);
  for (const item of items) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) return file;
    }
  }
  return null;
}

export function NativeSpreadsheetGrid({
  rows,
  onRowsChange,
  onStageImage,
  isBusy,
}: NativeSpreadsheetGridProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [activeCell, setActiveCell] = useState<CellCoord | null>(null);
  const [selection, setSelection] = useState<SelectionRange | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [fillTarget, setFillTarget] = useState<CellCoord | null>(null);
  const [fillSource, setFillSource] = useState<CellCoord | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [previewImage, setPreviewImage] = useState<{ url: string; label: string } | null>(null);
  const [past, setPast] = useState<NativeIngestionRow[][]>([]);
  const [future, setFuture] = useState<NativeIngestionRow[][]>([]);

  const columns = useMemo(() => (showDetails ? [...BASE_COLUMNS, ...DETAIL_COLUMNS] : BASE_COLUMNS), [showDetails]);
  const totalWidth = Math.max(
    MIN_GRID_WIDTH,
    ROW_NUMBER_WIDTH + columns.reduce((sum, column) => sum + column.width, 0),
  );

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  const selectedCount = selectedRows.size;

  const commitRows = useCallback((nextRows: NativeIngestionRow[]) => {
    setPast((current) => [...current.slice(-49), rows]);
    setFuture([]);
    onRowsChange(nextRows);
  }, [onRowsChange, rows]);

  const undo = useCallback(() => {
    setPast((current) => {
      const previous = current[current.length - 1];
      if (!previous) return current;
      setFuture((existing) => [rows, ...existing].slice(0, 50));
      onRowsChange(previous);
      return current.slice(0, -1);
    });
  }, [onRowsChange, rows]);

  const redo = useCallback(() => {
    setFuture((current) => {
      const next = current[0];
      if (!next) return current;
      setPast((existing) => [...existing.slice(-49), rows]);
      onRowsChange(next);
      return current.slice(1);
    });
  }, [onRowsChange, rows]);

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
    commitRows(rows.map((row, index) => (
      index === rowIndex ? patchRowCell(row, column, value) : row
    )));
  }, [commitRows, rows]);

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
    commitRows(padRows(patched));
  }, [activeCell, commitRows, rows]);

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

  const copySelection = useCallback(async () => {
    const text = serializeSelection();
    if (!text) return;
    await navigator.clipboard?.writeText(text);
  }, [serializeSelection]);

  const pasteFromClipboard = useCallback(async () => {
    const text = await navigator.clipboard?.readText();
    applyPaste(text || "");
  }, [applyPaste]);

  const deleteSelectedRows = () => {
    if (selectedRows.size === 0) return;
    const next = rows.filter((_, index) => !selectedRows.has(index));
    setSelectedRows(new Set());
    commitRows(padRows(next));
  };

  const insertRowAbove = () => {
    const index = activeCell?.rowIndex ?? 0;
    const next = [...rows];
    next.splice(index, 0, createEmptyNativeRow(index));
    commitRows(padRows(next, next.length));
    focusCell({ rowIndex: index, column: "fixture_no" });
  };

  const appendRows = () => {
    const next = padRows([...rows, createEmptyNativeRow(rows.length)], rows.length + 8);
    commitRows(next);
    focusCell({ rowIndex: rows.length, column: "fixture_no" });
  };

  const reorderRows = (direction: "up" | "down") => {
    if (selectedRows.size === 0) return;
    const ordered = [...selectedRows].sort((a, b) => direction === "up" ? a - b : b - a);
    const next = [...rows];
    for (const index of ordered) {
      const target = direction === "up" ? index - 1 : index + 1;
      if (target < 0 || target >= next.length || selectedRows.has(target)) continue;
      [next[index], next[target]] = [next[target], next[index]];
    }
    const shifted = new Set<number>();
    selectedRows.forEach((index) => {
      const target = direction === "up" ? Math.max(0, index - 1) : Math.min(next.length - 1, index + 1);
      shifted.add(target);
    });
    setSelectedRows(shifted);
    commitRows(padRows(next, next.length));
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
      commitRows(patched);
      setFillSource(null);
      setFillTarget(null);
    };

    window.addEventListener("mouseup", handleMouseUp);
    return () => window.removeEventListener("mouseup", handleMouseUp);
  }, [commitRows, fillSource, fillTarget, rows]);

  const renderCell = (row: NativeIngestionRow, rowIndex: number, column: NativeColumn) => {
    const columnDef = columns.find((item) => item.key === column);
    const active = activeCell?.rowIndex === rowIndex && activeCell.column === column;
    const selectableColumn = isEditableColumn(column);
    const inSelection = selectableColumn && coordInRange({ rowIndex, column }, selection);
    const issues = issuesForColumn(row, column);
    const sticky = columnDef?.sticky;
    const stickyLeft = column === "fixture_no" ? ROW_NUMBER_WIDTH : undefined;

    const baseClass = cn(
      "relative flex h-10 shrink-0 items-center border-r border-slate-200 bg-white px-1",
      cellStateClass(row, column),
      inSelection && "outline outline-1 outline-primary/60",
      active && "z-[4] outline outline-2 outline-primary",
      sticky && "sticky z-[3] shadow-[1px_0_0_#e2e8f0]",
    );

    const style: React.CSSProperties = {
      width: columnDef?.width,
      minWidth: columnDef?.width,
      left: stickyLeft,
    };

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
      const errorCount = row.issues?.filter((issue) => issue.severity === "error").length || 0;
      return (
        <div key={column} className={baseClass} style={style} title={issueTitle(row.issues || [])}>
          <span className={cn("rounded border px-1.5 py-0.5 text-[10px] font-bold", rowStatusClass(row))}>
            {row.classification || row.status || "EMPTY"}
            {errorCount ? ` (${errorCount})` : ""}
          </span>
        </div>
      );
    }

    if (column === "assigned_team") {
      return (
        <div key={column} className={cn(baseClass, "text-xs text-slate-600")} style={style}>
          <span className="truncate">{row.assigned_team || row.existing?.assigned_team || ""}</span>
        </div>
      );
    }

    if (column === "validation_state") {
      return (
        <div key={column} className={cn(baseClass, "text-xs text-slate-600")} style={style} title={row.validation_state || issueTitle(row.issues || [])}>
          <span className="truncate">{row.validation_state || ""}</span>
        </div>
      );
    }

    if (column === "is_outsourced") {
      return (
        <div
          key={column}
          className={cn(baseClass, "justify-center")}
          style={style}
          title={issueTitle(issues)}
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

    if (column === "reference_image_url") {
      const imageUrl = row.reference_image_url;
      return (
        <div
          key={column}
          className={baseClass}
          style={style}
          title={issueTitle(issues) || row.storage_warning || ""}
          onMouseDown={activate}
          onMouseEnter={() => fillSource?.column === column && setFillTarget({ rowIndex, column })}
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
          }}
          onDrop={(event) => {
            event.preventDefault();
            const file = Array.from(event.dataTransfer.files || []).find((item) => item.type.startsWith("image/"));
            if (file) {
              void onStageImage(row, file);
            }
          }}
        >
          {imageUrl ? (
            <button
              type="button"
              className="mr-1 flex h-8 w-9 shrink-0 items-center justify-center overflow-hidden rounded border bg-slate-50"
              onClick={() => setPreviewImage({ url: imageUrl, label: row.fixture_no || `Row ${rowIndex + 1}` })}
              aria-label="Open reference image"
            >
              <img src={imageUrl} alt="" className="h-full w-full object-cover" />
            </button>
          ) : (
            <span className="mr-1 flex h-8 w-9 shrink-0 items-center justify-center rounded border border-dashed bg-slate-50 text-slate-400">
              <Eye className="h-3.5 w-3.5" />
            </span>
          )}
          <Input
            data-native-cell={`${rowIndex}:${column}`}
            value={imageUrl || ""}
            disabled={isBusy}
            onFocus={() => setActiveCell({ rowIndex, column })}
            onChange={(event) => setCell(rowIndex, column, event.target.value)}
            onKeyDown={(event) => {
              if (["Tab", "Enter"].includes(event.key)) {
                event.preventDefault();
                focusCell(nextCell({ rowIndex, column }, event.key, rows.length));
              }
            }}
            className="h-8 min-w-0 flex-1 border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-0"
          />
          <label className="ml-1 flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded border hover:bg-muted">
            <ImagePlus className="h-3.5 w-3.5" />
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={isBusy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  void onStageImage(row, file);
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
        style={style}
        title={issueTitle(issues)}
        onMouseDown={activate}
        onMouseEnter={() => selectableColumn && fillSource?.column === column && setFillTarget({ rowIndex, column })}
      >
        <Input
          data-native-cell={`${rowIndex}:${column}`}
          value={String(row[column as NativeEditableColumn] || "")}
          disabled={isBusy || disabled || !selectableColumn}
          onFocus={() => selectableColumn && setActiveCell({ rowIndex, column: column as NativeEditableColumn })}
          onChange={(event) => selectableColumn && setCell(rowIndex, column as NativeEditableColumn, event.target.value)}
          onKeyDown={(event) => {
            if (!selectableColumn) return;
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
        {active && selectableColumn && (
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

  return (
    <div className="flex min-h-0 flex-1 flex-col border-t bg-white">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b bg-slate-50 px-3 py-2 text-xs">
        <div className="flex items-center gap-2 text-slate-600">
          <Rows3 className="h-4 w-4" />
          <span>{rows.length} rows</span>
          <span>{selectedCount} selected</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Button type="button" size="sm" variant="outline" onClick={undo} disabled={isBusy || past.length === 0} title="Undo">
            <Undo2 className="h-3.5 w-3.5" />
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={redo} disabled={isBusy || future.length === 0} title="Redo">
            <Redo2 className="h-3.5 w-3.5" />
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => void copySelection()} disabled={isBusy || !activeCell} title="Copy">
            <Copy className="h-3.5 w-3.5" />
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => void pasteFromClipboard()} disabled={isBusy || !activeCell}>
            Paste
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={insertRowAbove} disabled={isBusy}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            Insert
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={appendRows} disabled={isBusy}>
            Add
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => reorderRows("up")} disabled={isBusy || selectedCount === 0} title="Move selected rows up">
            <ArrowUp className="h-3.5 w-3.5" />
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => reorderRows("down")} disabled={isBusy || selectedCount === 0} title="Move selected rows down">
            <ArrowDown className="h-3.5 w-3.5" />
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
          <Button type="button" size="sm" variant={showDetails ? "secondary" : "outline"} onClick={() => setShowDetails((value) => !value)}>
            <PanelRightOpen className="mr-1 h-3.5 w-3.5" />
            Details
          </Button>
        </div>
      </div>

      <div
        ref={scrollRef}
        tabIndex={0}
        className="min-h-0 flex-1 overflow-auto outline-none"
        onPaste={(event) => {
          const image = fileFromClipboard(event);
          if (image && activeCell?.column === "reference_image_url") {
            event.preventDefault();
            const row = rows[activeCell.rowIndex];
            if (row) void onStageImage(row, image);
            return;
          }

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
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
            event.preventDefault();
            undo();
            return;
          }
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
            event.preventDefault();
            redo();
            return;
          }
          if (!activeCell) return;
          if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
            event.preventDefault();
            focusCell(nextCell(activeCell, event.key, rows.length));
          }
        }}
      >
        <div
          className="sticky top-0 z-10 flex border-b border-slate-300 bg-slate-100 text-[11px] font-semibold uppercase text-slate-600"
          style={{ width: totalWidth, minWidth: totalWidth }}
        >
          <div className="sticky left-0 z-30 flex h-9 w-12 shrink-0 items-center justify-center border-r bg-slate-100">#</div>
          {columns.map((column) => (
            <div
              key={column.key}
              className={cn(
                "flex h-9 shrink-0 items-center border-r bg-slate-100 px-2",
                column.sticky && "sticky z-20 shadow-[1px_0_0_#cbd5e1]",
              )}
              style={{ width: column.width, minWidth: column.width, left: column.sticky ? ROW_NUMBER_WIDTH : undefined }}
            >
              {column.label}
            </div>
          ))}
        </div>

        <div className="relative" style={{ height: virtualizer.getTotalSize(), width: totalWidth, minWidth: totalWidth }}>
          {visibleRows.map((virtualRow) => {
            const row = rows[virtualRow.index];
            if (!row) return null;
            const rowSelected = selectedRows.has(virtualRow.index);
            return (
              <div
                key={row.row_id}
                className={cn(
                  "absolute left-0 top-0 flex border-b border-slate-200 text-xs",
                  rowSelected && "bg-primary/5",
                )}
                style={{
                  height: virtualRow.size,
                  transform: `translateY(${virtualRow.start}px)`,
                  width: totalWidth,
                  minWidth: totalWidth,
                }}
              >
                <button
                  type="button"
                  className={cn(
                    "sticky left-0 z-[5] flex h-10 w-12 shrink-0 items-center justify-center border-r bg-slate-50 text-[11px] text-slate-500",
                    rowSelected && "bg-primary/10 text-primary",
                  )}
                  onClick={(event) => {
                    setSelectedRows((current) => {
                      const next = event.shiftKey ? new Set(current) : new Set<number>();
                      if (next.has(virtualRow.index)) next.delete(virtualRow.index);
                      else next.add(virtualRow.index);
                      return next;
                    });
                  }}
                >
                  {virtualRow.index + 1}
                </button>
                {columns.map((column) => renderCell(row, virtualRow.index, column.key))}
              </div>
            );
          })}
        </div>
      </div>

      <Dialog open={Boolean(previewImage)} onOpenChange={(open) => !open && setPreviewImage(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{previewImage?.label || "Reference Image"}</DialogTitle>
            <DialogDescription>Reference image attached to the fixture row.</DialogDescription>
          </DialogHeader>
          {previewImage ? (
            <div className="max-h-[72vh] overflow-auto bg-slate-950 p-2">
              <img src={previewImage.url} alt="" className="mx-auto max-h-[68vh] object-contain" />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
