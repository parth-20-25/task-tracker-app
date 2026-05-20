import { memo, useCallback, useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ImageIcon, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { classificationClassName, classificationLabel } from "@/lib/ingestionSpreadsheet/classificationStyles";
import { rowDecisionKey } from "@/lib/ingestionSpreadsheet/gridModel";
import {
  COLUMN_LABELS,
  GRID_COLUMNS,
  ROW_HEIGHT_PX,
  OVERSCAN,
  type CellCoord,
  type EditableColumnId,
  type SelectionRange,
  type SpreadsheetColumnId,
  type SpreadsheetRow,
} from "@/lib/ingestionSpreadsheet/types";
import type { CellValidationIssue } from "@/lib/ingestionSpreadsheet/validation";
import { cn } from "@/lib/utils";

const COLUMN_WIDTH: Record<SpreadsheetColumnId, string> = {
  status: "w-[88px]",
  row_ref: "w-[72px]",
  fixture_no: "w-[140px]",
  part_name: "w-[180px]",
  fixture_type: "w-[160px]",
  qty: "w-[64px]",
  remark: "w-[120px]",
  part_image: "w-[88px]",
  conflict: "w-[200px]",
};

interface VirtualizedIngestionGridProps {
  rows: SpreadsheetRow[];
  getDisplayValue: (row: SpreadsheetRow, columnId: EditableColumnId) => string;
  onCellChange: (rowKey: string, columnId: EditableColumnId, value: string) => void;
  validationIssueMap: Map<string, CellValidationIssue[]>;
  decisions: Record<string, "incoming" | "existing">;
  onDecisionChange: (rowKey: string, value: "incoming" | "existing") => void;
  selection: SelectionRange | null;
  activeCell: CellCoord | null;
  onActiveCellChange: (coord: CellCoord) => void;
  onSelectionChange: (range: SelectionRange | null) => void;
  onRowSelectToggle: (rowIndex: number, extend: boolean) => void;
  selectedRowIndexes: number[];
  onPaste: (raw: string) => void;
  onFillDown: () => void;
  scrollToRowIndex: number | null;
  uploadMode: "excel" | "paste";
  queuedPartPreview?: string | null;
  onQueuePartImage?: (rowKey: string, file: File) => void;
  onValidateRejected?: (row: SpreadsheetRow) => void;
  validatingRowKey?: string | null;
}

function cellIssueKey(rowKey: string, columnId: EditableColumnId) {
  return `${rowKey}::${columnId}`;
}

const GridRow = memo(function GridRow({
  row,
  rowIndex,
  virtualStyle,
  ...props
}: {
  row: SpreadsheetRow;
  rowIndex: number;
  virtualStyle: React.CSSProperties;
} & Omit<VirtualizedIngestionGridProps, "rows" | "scrollToRowIndex">) {
  const isSelected = props.selectedRowIndexes.includes(rowIndex);
  const hasRowError = row.classification === "INVALID" || row.classification === "DUPLICATE";

  const renderEditable = (columnId: EditableColumnId) => {
    const issue = props.validationIssueMap.get(cellIssueKey(row.rowKey, columnId))?.[0];
    const value = props.getDisplayValue(row, columnId);
    return (
      <Input
        value={value}
        disabled={!row.isEditable}
        onChange={(event) => props.onCellChange(row.rowKey, columnId, event.target.value)}
        className={cn(
          "h-8 border-transparent bg-transparent px-2 text-xs shadow-none focus-visible:ring-1",
          issue && "border-red-400 bg-red-50/60 dark:bg-red-950/30",
        )}
        title={issue?.message}
      />
    );
  };

  const decisionKey = row.incoming ? rowDecisionKey(row) : row.rowKey;

  return (
    <div
      style={virtualStyle}
      className={cn(
        "absolute left-0 top-0 flex w-full border-b text-xs",
        isSelected && "bg-primary/5",
        hasRowError && "bg-red-50/20 dark:bg-red-950/10",
        row.classification === "CONFLICT" && !props.decisions[decisionKey] && "bg-orange-50/30 dark:bg-orange-950/10",
      )}
      onMouseDown={() => props.onRowSelectToggle(rowIndex, false)}
    >
      <div className={cn("shrink-0 px-2 py-2", COLUMN_WIDTH.status)}>
        <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold", classificationClassName(row.classification))}>
          {classificationLabel(row.classification)}
        </span>
        {hasRowError ? <AlertTriangle className="mt-1 h-3 w-3 text-red-600" /> : null}
      </div>
      <div className={cn("shrink-0 px-2 py-2 text-muted-foreground", COLUMN_WIDTH.row_ref)}>
        {row.excelRow ?? row.rowReference}
      </div>
      <div className={cn("shrink-0", COLUMN_WIDTH.fixture_no)}>{renderEditable("fixture_no")}</div>
      <div className={cn("shrink-0", COLUMN_WIDTH.part_name)}>{renderEditable("part_name")}</div>
      <div className={cn("shrink-0", COLUMN_WIDTH.fixture_type)}>{renderEditable("fixture_type")}</div>
      <div className={cn("shrink-0", COLUMN_WIDTH.qty)}>{renderEditable("qty")}</div>
      <div className={cn("shrink-0 truncate px-2 py-2 text-muted-foreground", COLUMN_WIDTH.remark)}>
        {row.remark || row.skipReason || row.errorMessage || "—"}
      </div>
      <div className={cn("shrink-0 px-1 py-1", COLUMN_WIDTH.part_image)}>
        {(row.partImageUrl || props.queuedPartPreview) ? (
          <img
            src={props.queuedPartPreview || row.partImageUrl || ""}
            alt=""
            loading="lazy"
            className="h-8 w-12 rounded object-cover"
          />
        ) : props.uploadMode === "paste" && props.onQueuePartImage ? (
          <label className="flex h-8 cursor-pointer items-center justify-center rounded border border-dashed text-muted-foreground hover:bg-muted/40">
            <ImageIcon className="h-3.5 w-3.5" />
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  props.onQueuePartImage?.(row.rowKey, file);
                }
              }}
            />
          </label>
        ) : (
          <span className="px-1 text-[10px] text-muted-foreground">—</span>
        )}
      </div>
      <div className={cn("shrink-0 px-2 py-1", COLUMN_WIDTH.conflict)}>
        {row.classification === "CONFLICT" && row.incoming && row.existing ? (
          <Select
            value={props.decisions[decisionKey] || ""}
            onValueChange={(value: "incoming" | "existing") => props.onDecisionChange(decisionKey, value)}
          >
            <SelectTrigger className="h-8 text-[11px]">
              <SelectValue placeholder="Choose resolution" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="existing">Keep existing</SelectItem>
              <SelectItem value="incoming">Use incoming</SelectItem>
            </SelectContent>
          </Select>
        ) : row.isEditable ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 text-[11px]"
            disabled={props.validatingRowKey === row.rowKey}
            onClick={() => props.onValidateRejected?.(row)}
          >
            Revalidate
          </Button>
        ) : (
          <span className="text-[10px] text-muted-foreground">—</span>
        )}
      </div>
    </div>
  );
});

export function VirtualizedIngestionGrid(props: VirtualizedIngestionGridProps) {
  const parentRef = useRef<HTMLDivElement | null>(null);

  const virtualizer = useVirtualizer({
    count: props.rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT_PX,
    overscan: OVERSCAN,
  });

  useEffect(() => {
    if (props.scrollToRowIndex !== null && props.scrollToRowIndex >= 0) {
      virtualizer.scrollToIndex(props.scrollToRowIndex, { align: "center" });
    }
  }, [props.scrollToRowIndex, virtualizer]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "z") {
      event.preventDefault();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === "d") {
      event.preventDefault();
      props.onFillDown();
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      return;
    }
    if (event.clipboardData && event.key === "v" && (event.ctrlKey || event.metaKey)) {
      // handled by onPaste
    }
  }, [props]);

  return (
    <div
      ref={parentRef}
      className="min-h-0 flex-1 overflow-auto border-t focus:outline-none"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onPaste={(event) => {
        event.preventDefault();
        const text = event.clipboardData.getData("text/plain");
        props.onPaste(text);
      }}
    >
      <div className="sticky top-0 z-10 flex border-b bg-muted/80 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {GRID_COLUMNS.map((columnId) => (
          <div key={columnId} className={cn("shrink-0 px-2 py-2", COLUMN_WIDTH[columnId])}>
            {COLUMN_LABELS[columnId]}
          </div>
        ))}
      </div>
      <div style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const row = props.rows[virtualRow.index];
          if (!row) {
            return null;
          }
          return (
            <GridRow
              key={row.rowKey}
              row={row}
              rowIndex={virtualRow.index}
              virtualStyle={{
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
              }}
              {...props}
            />
          );
        })}
      </div>
    </div>
  );
}
