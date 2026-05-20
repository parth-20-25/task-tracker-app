import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applyBulkAction, type BulkActionRequest } from "@/lib/ingestionSpreadsheet/bulkActions";
import {
  alignPasteToSelection,
  columnIdToEditable,
  mapMatrixToEditableColumns,
  parseClipboardMatrix,
} from "@/lib/ingestionSpreadsheet/clipboard";
import { applyFillDown } from "@/lib/ingestionSpreadsheet/fillHandle";
import { buildSpreadsheetRows, rowDecisionKey } from "@/lib/ingestionSpreadsheet/gridModel";
import { DEFAULT_FILTER, filterSpreadsheetRows } from "@/lib/ingestionSpreadsheet/filters";
import { moveSelection, normalizeRange, type SelectionRange } from "@/lib/ingestionSpreadsheet/selection";
import {
  clearSessionDraft,
  hasMeaningfulDraft,
  loadSessionDraft,
  saveSessionDraft,
} from "@/lib/ingestionSpreadsheet/sessionRecovery";
import { createUndoStack } from "@/lib/ingestionSpreadsheet/undoStack";
import {
  buildRowValidationIssues,
  debounce,
  type CellValidationIssue,
} from "@/lib/ingestionSpreadsheet/validation";
import type {
  CellCoord,
  EditableColumnId,
  SpreadsheetFilterState,
  SpreadsheetRow,
  SpreadsheetWorkspaceProps,
} from "@/lib/ingestionSpreadsheet/types";

interface SpreadsheetStateBundle {
  cellOverrides: Record<string, Partial<Record<EditableColumnId, string>>>;
  hiddenRowKeys: Set<string>;
  filter: SpreadsheetFilterState;
}

export function useSpreadsheetState(props: SpreadsheetWorkspaceProps) {
  const baseRows = useMemo(() => buildSpreadsheetRows(props.preview), [props.preview]);
  const undoStack = useRef(createUndoStack<SpreadsheetStateBundle>());

  const [filter, setFilter] = useState<SpreadsheetFilterState>(DEFAULT_FILTER);
  const [cellOverrides, setCellOverrides] = useState<Record<string, Partial<Record<EditableColumnId, string>>>({});
  const [hiddenRowKeys, setHiddenRowKeys] = useState<Set<string>>(new Set());
  const [selection, setSelection] = useState<SelectionRange | null>(null);
  const [activeCell, setActiveCell] = useState<CellCoord | null>(null);
  const [selectedRowIndexes, setSelectedRowIndexes] = useState<number[]>([]);
  const [validationIssues, setValidationIssues] = useState<CellValidationIssue[]>([]);
  const [draftRecovered, setDraftRecovered] = useState(false);

  const rows = useMemo(
    () => baseRows.filter((row) => !hiddenRowKeys.has(row.rowKey)),
    [baseRows, hiddenRowKeys],
  );

  const filteredRows = useMemo(() => filterSpreadsheetRows(rows, filter), [rows, filter]);
  const filteredIndexByRowKey = useMemo(() => {
    const map = new Map<string, number>();
    filteredRows.forEach((row, index) => map.set(row.rowKey, index));
    return map;
  }, [filteredRows]);

  const pushUndo = useCallback((label: string) => {
    undoStack.current.push(label, {
      cellOverrides: { ...cellOverrides },
      hiddenRowKeys: new Set(hiddenRowKeys),
      filter: { ...filter },
    });
  }, [cellOverrides, hiddenRowKeys, filter]);

  const runDebouncedValidation = useMemo(
    () => debounce(() => {
      setValidationIssues(buildRowValidationIssues(rows, cellOverrides));
    }, 280),
    [rows, cellOverrides],
  );

  useEffect(() => {
    runDebouncedValidation();
  }, [runDebouncedValidation]);

  useEffect(() => {
    const sessionId = props.preview.ingestion_session_id;
    if (!sessionId || draftRecovered) {
      return;
    }
    const draft = loadSessionDraft(sessionId);
    if (hasMeaningfulDraft(draft)) {
      if (draft?.decisions) {
        props.onDecisionsChange({ ...props.decisions, ...draft.decisions });
      }
      if (draft?.cellOverrides) {
        setCellOverrides(draft.cellOverrides);
      }
      if (draft?.filter) {
        setFilter(draft.filter);
      }
      setDraftRecovered(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- restore once per session
  }, [props.preview.ingestion_session_id, draftRecovered]);

  useEffect(() => {
    const sessionId = props.preview.ingestion_session_id;
    if (!sessionId) {
      return;
    }
    const timer = setTimeout(() => {
      saveSessionDraft({
        sessionId,
        expiresAt: props.preview.ingestion_session_expires_at ?? null,
        savedAt: new Date().toISOString(),
        decisions: props.decisions,
        cellOverrides,
        filter,
        uploadMode: props.uploadMode,
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [
    props.preview.ingestion_session_id,
    props.preview.ingestion_session_expires_at,
    props.decisions,
    cellOverrides,
    filter,
    props.uploadMode,
  ]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (Object.keys(cellOverrides).length > 0 || Object.keys(props.decisions).length > 0) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [cellOverrides, props.decisions]);

  const setCellValue = useCallback((rowKey: string, columnId: EditableColumnId, value: string) => {
    pushUndo("edit cell");
    setCellOverrides((current) => ({
      ...current,
      [rowKey]: {
        ...(current[rowKey] || {}),
        [columnId]: value,
      },
    }));
  }, [pushUndo]);

  const getDisplayValue = useCallback((row: SpreadsheetRow, columnId: EditableColumnId) => {
    const override = cellOverrides[row.rowKey]?.[columnId];
    if (override !== undefined) {
      return override;
    }
    if (columnId === "fixture_no") return row.fixtureNo;
    if (columnId === "part_name") return row.partName;
    if (columnId === "fixture_type") return row.fixtureType;
    return row.qty;
  }, [cellOverrides]);

  const handlePaste = useCallback((raw: string) => {
    if (!activeCell) {
      return;
    }
    const editable = columnIdToEditable(activeCell.columnId);
    if (!editable) {
      return;
    }
    const matrix = parseClipboardMatrix(raw);
    if (matrix.length === 0) {
      return;
    }
    const range = selection ? normalizeRange(selection) : null;
    const rowSpan = range ? range.end.rowIndex - range.start.rowIndex + 1 : 1;
    const colSpan = range
      ? Math.abs(
        ["fixture_no", "part_name", "fixture_type", "qty"].indexOf(range.end.columnId as EditableColumnId)
        - ["fixture_no", "part_name", "fixture_type", "qty"].indexOf(range.start.columnId as EditableColumnId),
      ) + 1
      : 1;
    const aligned = alignPasteToSelection(matrix, rowSpan, colSpan);
    const patches = mapMatrixToEditableColumns(aligned, editable);
    pushUndo("paste");
    const startIndex = range?.start.rowIndex ?? activeCell.rowIndex;
    setCellOverrides((current) => {
      const next = { ...current };
      patches.forEach((patch, offset) => {
        const row = filteredRows[startIndex + offset];
        if (!row?.isEditable) {
          return;
        }
        next[row.rowKey] = { ...(next[row.rowKey] || {}), ...patch };
      });
      return next;
    });
  }, [activeCell, selection, filteredRows, pushUndo]);

  const handleFillDown = useCallback(() => {
    if (!activeCell) {
      return;
    }
    const editable = columnIdToEditable(activeCell.columnId);
    if (!editable) {
      return;
    }
    const sourceRow = filteredRows[activeCell.rowIndex];
    if (!sourceRow) {
      return;
    }
    const sourceValue = String(getDisplayValue(sourceRow, editable));
    const indexes = selectedRowIndexes.length > 0
      ? selectedRowIndexes
      : filteredRows.map((_, index) => index).filter((index) => index > activeCell.rowIndex);
    pushUndo("fill down");
    const patches = applyFillDown(filteredRows, indexes, editable, sourceValue);
    setCellOverrides((current) => {
      const next = { ...current };
      Object.entries(patches).forEach(([rowKey, patch]) => {
        next[rowKey] = { ...(next[rowKey] || {}), ...patch };
      });
      return next;
    });
  }, [activeCell, filteredRows, selectedRowIndexes, getDisplayValue, pushUndo]);

  const runBulkAction = useCallback((request: BulkActionRequest) => {
    pushUndo(request.type);
    const result = applyBulkAction(rows, cellOverrides, request);
    setCellOverrides(result.nextOverrides);
    if (result.removedRowKeys.length > 0) {
      setHiddenRowKeys((current) => {
        const next = new Set(current);
        result.removedRowKeys.forEach((key) => next.add(key));
        return next;
      });
    }
    return result.warnings;
  }, [rows, cellOverrides, pushUndo]);

  const undo = useCallback(() => {
    const snapshot = undoStack.current.undo({
      cellOverrides,
      hiddenRowKeys,
      filter,
    });
    if (!snapshot) {
      return null;
    }
    setCellOverrides(snapshot.state.cellOverrides);
    setHiddenRowKeys(snapshot.state.hiddenRowKeys);
    setFilter(snapshot.state.filter);
    return snapshot.label;
  }, [cellOverrides, hiddenRowKeys, filter]);

  const redo = useCallback(() => {
    const snapshot = undoStack.current.redo({
      cellOverrides,
      hiddenRowKeys,
      filter,
    });
    if (!snapshot) {
      return null;
    }
    setCellOverrides(snapshot.state.cellOverrides);
    setHiddenRowKeys(snapshot.state.hiddenRowKeys);
    setFilter(snapshot.state.filter);
    return snapshot.label;
  }, [cellOverrides, hiddenRowKeys, filter]);

  const firstErrorRowKey = validationIssues[0]?.rowKey ?? null;

  const scrollToFirstError = useCallback(() => {
    if (!firstErrorRowKey) {
      return null;
    }
    return filteredIndexByRowKey.get(firstErrorRowKey) ?? null;
  }, [firstErrorRowKey, filteredIndexByRowKey]);

  const clearDraftOnCommit = useCallback(() => {
    if (props.preview.ingestion_session_id) {
      clearSessionDraft(props.preview.ingestion_session_id);
    }
  }, [props.preview.ingestion_session_id]);

  const unresolvedConflictCount = useMemo(
    () => rows.filter((row) => {
      if (row.classification !== "CONFLICT" || !row.incoming) {
        return false;
      }
      return !props.decisions[rowDecisionKey(row)];
    }).length,
    [rows, props.decisions],
  );

  return {
    rows,
    filteredRows,
    filter,
    setFilter,
    cellOverrides,
    setCellValue,
    getDisplayValue,
    selection,
    setSelection,
    activeCell,
    setActiveCell,
    selectedRowIndexes,
    setSelectedRowIndexes,
    validationIssues,
    validationIssueMap: useMemo(() => {
      const map = new Map<string, CellValidationIssue[]>();
      validationIssues.forEach((issue) => {
        const key = `${issue.rowKey}::${issue.columnId}`;
        const list = map.get(key) || [];
        list.push(issue);
        map.set(key, list);
      });
      return map;
    }, [validationIssues]),
    handlePaste,
    handleFillDown,
    runBulkAction,
    undo,
    redo,
    canUndo: () => undoStack.current.canUndo(),
    canRedo: () => undoStack.current.canRedo(),
    scrollToFirstError,
    clearDraftOnCommit,
    unresolvedConflictCount,
    moveActive: (direction: "up" | "down" | "left" | "right") => {
      if (!activeCell) {
        setActiveCell({ rowIndex: 0, columnId: "fixture_no" });
        return;
      }
      setActiveCell(moveSelection(activeCell, direction, filteredRows.length));
    },
  };
}
