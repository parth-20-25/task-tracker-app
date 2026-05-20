import { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MorphLoader } from "@/components/ui/morph-loader";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import { rowDecisionKey } from "@/lib/ingestionSpreadsheet/gridModel";
import { getSelectedEditableRowKeys } from "@/lib/ingestionSpreadsheet/bulkActions";
import type { SpreadsheetWorkspaceProps } from "@/lib/ingestionSpreadsheet/types";
import { ConflictDetailPanel } from "./ConflictDetailPanel";
import { SpreadsheetToolbar } from "./SpreadsheetToolbar";
import { useSpreadsheetState } from "./useSpreadsheetState";
import { ValidationSummaryBar } from "./ValidationSummaryBar";
import { VirtualizedIngestionGrid } from "./VirtualizedIngestionGrid";

export function IngestionSpreadsheetWorkspace(props: SpreadsheetWorkspaceProps) {
  const state = useSpreadsheetState(props);
  const [scrollToRowIndex, setScrollToRowIndex] = useState<number | null>(null);
  const [focusedConflictRowKey, setFocusedConflictRowKey] = useState<string | null>(null);
  const [pendingDestructive, setPendingDestructive] = useState<"delete" | "confirm" | null>(null);

  const focusedConflictRow = useMemo(
    () => state.filteredRows.find((row) => row.rowKey === focusedConflictRowKey) ?? null,
    [state.filteredRows, focusedConflictRowKey],
  );

  const selectedEditableKeys = getSelectedEditableRowKeys(state.filteredRows, state.selectedRowIndexes);

  const handleBulkDelete = () => {
    if (selectedEditableKeys.length === 0) {
      toast({ title: "No editable rows selected", variant: "destructive" });
      return;
    }
    setPendingDestructive("delete");
  };

  const runDestructive = () => {
    if (pendingDestructive === "delete") {
      const warnings = state.runBulkAction({ type: "delete_rows", rowKeys: selectedEditableKeys });
      warnings.forEach((message) => toast({ title: "Bulk action", description: message }));
      setPendingDestructive(null);
      return;
    }
    if (pendingDestructive === "confirm") {
      state.clearDraftOnCommit();
      props.onConfirm();
      setPendingDestructive(null);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 border-b bg-card p-3">
        <h4 className="text-lg font-semibold">
          {props.preview.file_info.project_code}
          {" "}
          —
          {props.preview.file_info.project_name_display ?? props.preview.file_info.project_name}
        </h4>
        <p className="text-sm text-muted-foreground">{props.preview.file_info.company_name}</p>
        {props.preview.ingestion_session_id ? (
          <p className="mt-1 text-[10px] text-muted-foreground">
            Session {props.preview.ingestion_session_id.slice(0, 8)}…
            {props.preview.ingestion_session_expires_at
              ? ` • draft expires ${new Date(props.preview.ingestion_session_expires_at).toLocaleString()}`
              : ""}
          </p>
        ) : null}
      </div>

      <ValidationSummaryBar
        rows={state.rows}
        validationIssues={state.validationIssues}
        validationFilterActive={state.filter.validationOnly}
        onToggleValidationFilter={() => state.setFilter({
          ...state.filter,
          validationOnly: !state.filter.validationOnly,
        })}
        onJumpToError={() => {
          const index = state.scrollToFirstError();
          if (index !== null) {
            setScrollToRowIndex(index);
          }
        }}
      />

      <SpreadsheetToolbar
        filter={state.filter}
        onFilterChange={state.setFilter}
        rows={state.rows}
        filteredRows={state.filteredRows}
        decisions={props.decisions}
        projectCode={props.preview.file_info.project_code}
        selectedCount={state.selectedRowIndexes.length}
        onBulkFixtureType={(value) => {
          const warnings = state.runBulkAction({
            type: "set_fixture_type",
            rowKeys: selectedEditableKeys,
            value,
          });
          warnings.forEach((message) => toast({ title: "Bulk type", description: message }));
        }}
        onBulkOutsourcedToggle={() => {
          const warnings = state.runBulkAction({
            type: "toggle_outsourced",
            rowKeys: selectedEditableKeys,
          });
          warnings.forEach((message) => toast({ title: "Outsourced toggle", description: message }));
        }}
        onBulkDedupe={() => {
          const warnings = state.runBulkAction({
            type: "dedupe_fixture_no",
            rowKeys: selectedEditableKeys,
          });
          warnings.forEach((message) => toast({ title: "Duplicate cleanup", description: message }));
        }}
        onBulkDelete={handleBulkDelete}
        onUndo={() => {
          const label = state.undo();
          if (label) {
            toast({ title: "Undone", description: label });
          }
        }}
        onRedo={() => {
          const label = state.redo();
          if (label) {
            toast({ title: "Redone", description: label });
          }
        }}
        canUndo={state.canUndo()}
        canRedo={state.canRedo()}
      />

      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <VirtualizedIngestionGrid
            rows={state.filteredRows}
            getDisplayValue={state.getDisplayValue}
            onCellChange={state.setCellValue}
            validationIssueMap={state.validationIssueMap}
            decisions={props.decisions}
            onDecisionChange={(rowKey, value) => {
              props.onDecisionsChange({ ...props.decisions, [rowKey]: value });
              setFocusedConflictRowKey(
                state.filteredRows.find((row) => rowDecisionKey(row) === rowKey)?.rowKey ?? null,
              );
            }}
            selection={state.selection}
            activeCell={state.activeCell}
            onActiveCellChange={state.setActiveCell}
            onSelectionChange={state.setSelection}
            selectedRowIndexes={state.selectedRowIndexes}
            onRowSelectToggle={(rowIndex, extend) => {
              setFocusedConflictRowKey(state.filteredRows[rowIndex]?.rowKey ?? null);
              state.setSelectedRowIndexes((current) => {
                if (extend) {
                  return current.includes(rowIndex)
                    ? current.filter((value) => value !== rowIndex)
                    : [...current, rowIndex];
                }
                return [rowIndex];
              });
            }}
            onPaste={state.handlePaste}
            onFillDown={state.handleFillDown}
            scrollToRowIndex={scrollToRowIndex}
            uploadMode={props.uploadMode}
            queuedPartPreview={
              focusedConflictRow
                ? props.queuedPreviewImages[focusedConflictRow.rowKey]?.part?.previewUrl ?? null
                : null
            }
            onQueuePartImage={props.onQueuePartImage}
            onValidateRejected={(row) => {
              if (!row.rejected) {
                return;
              }
              props.onSyncRejectedDraft(row.rejected, {
                fixture_no: state.getDisplayValue(row, "fixture_no"),
                part_name: state.getDisplayValue(row, "part_name"),
                fixture_type: state.getDisplayValue(row, "fixture_type"),
                qty: state.getDisplayValue(row, "qty"),
              });
              void props.onValidateRejectedRow(row.rejected);
            }}
            validatingRowKey={props.validatingRejectedKey}
          />
        </div>
        <div className="hidden w-64 shrink-0 lg:block">
          <ConflictDetailPanel
            row={focusedConflictRow}
            decision={
              focusedConflictRow?.incoming
                ? props.decisions[rowDecisionKey(focusedConflictRow)]
                : undefined
            }
          />
        </div>
      </div>

      <div className="shrink-0 flex flex-col gap-2 border-t bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between">
        <Button variant="ghost" onClick={props.onCancelPreview}>
          Cancel & Reload
        </Button>
        <div className="flex items-center gap-3">
          {state.unresolvedConflictCount > 0 ? (
            <span className="inline-flex items-center gap-1 text-xs text-orange-700 dark:text-orange-300">
              <AlertTriangle className="h-3.5 w-3.5" />
              {state.unresolvedConflictCount} unresolved conflict(s)
            </span>
          ) : null}
          <Button
            onClick={() => setPendingDestructive("confirm")}
            disabled={props.isConfirming || props.hasUnresolvedConflicts}
            className="min-w-36 bg-primary hover:bg-primary/90"
          >
            {props.isConfirming ? (
              <>
                <MorphLoader size={16} color="currentColor" />
                Saving...
              </>
            ) : (
              "Confirm & Save"
            )}
          </Button>
        </div>
      </div>

      <AlertDialog open={pendingDestructive !== null} onOpenChange={(open) => !open && setPendingDestructive(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingDestructive === "delete" ? "Remove selected rows?" : "Commit ingestion?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDestructive === "delete"
                ? "Selected invalid/duplicate rows will be hidden from this draft. This cannot be undone after reload."
                : "This will persist accepted fixtures and resolved conflicts. Unresolved conflicts block commit."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={runDestructive}>
              {pendingDestructive === "delete" ? "Remove" : "Commit"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
