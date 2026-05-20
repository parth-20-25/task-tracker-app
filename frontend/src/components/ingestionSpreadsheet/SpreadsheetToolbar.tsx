import {
  Download,
  Filter,
  Redo2,
  Search,
  Trash2,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { IngestionClassification, SpreadsheetFilterState } from "@/lib/ingestionSpreadsheet/types";
import {
  exportSheetSnapshot,
  exportUnresolvedConflicts,
  exportValidationErrors,
} from "@/lib/ingestionSpreadsheet/exportUtils";
import type { SpreadsheetRow } from "@/lib/ingestionSpreadsheet/types";

interface SpreadsheetToolbarProps {
  filter: SpreadsheetFilterState;
  onFilterChange: (next: SpreadsheetFilterState) => void;
  rows: SpreadsheetRow[];
  filteredRows: SpreadsheetRow[];
  decisions: Record<string, "incoming" | "existing">;
  projectCode: string;
  selectedCount: number;
  onBulkFixtureType: (value: string) => void;
  onBulkOutsourcedToggle: () => void;
  onBulkDelete: () => void;
  onBulkDedupe: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export function SpreadsheetToolbar({
  filter,
  onFilterChange,
  rows,
  filteredRows,
  decisions,
  projectCode,
  selectedCount,
  onBulkFixtureType,
  onBulkOutsourcedToggle,
  onBulkDelete,
  onBulkDedupe,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}: SpreadsheetToolbarProps) {
  return (
    <div className="flex flex-col gap-2 border-b bg-card/80 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={filter.search}
            onChange={(event) => onFilterChange({ ...filter, search: event.target.value })}
            placeholder="Search fixture no, part, type…"
            className="h-9 pl-8"
          />
        </div>
        <Select
          value={filter.classification}
          onValueChange={(value) => onFilterChange({
            ...filter,
            classification: value as IngestionClassification | "ALL",
          })}
        >
          <SelectTrigger className="h-9 w-[150px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            <SelectItem value="NEW">NEW</SelectItem>
            <SelectItem value="UPDATED">UPDATED</SelectItem>
            <SelectItem value="EXISTING">EXISTING</SelectItem>
            <SelectItem value="CONFLICT">CONFLICT</SelectItem>
            <SelectItem value="INVALID">INVALID</SelectItem>
            <SelectItem value="DUPLICATE">DUPLICATE</SelectItem>
            <SelectItem value="SKIPPED">SKIPPED</SelectItem>
          </SelectContent>
        </Select>
        <Button
          type="button"
          size="sm"
          variant={filter.conflictsOnly ? "secondary" : "outline"}
          onClick={() => onFilterChange({ ...filter, conflictsOnly: !filter.conflictsOnly })}
        >
          <Filter className="mr-1 h-3.5 w-3.5" />
          Conflicts
        </Button>
        <Button
          type="button"
          size="sm"
          variant={filter.outsourcedOnly ? "secondary" : "outline"}
          onClick={() => onFilterChange({ ...filter, outsourcedOnly: !filter.outsourcedOnly })}
        >
          Outsourced
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={!canUndo} onClick={onUndo}>
          <Undo2 className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={!canRedo} onClick={onRedo}>
          <Redo2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">
          Showing {filteredRows.length} / {rows.length}
          {selectedCount > 0 ? ` • ${selectedCount} selected` : ""}
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={selectedCount === 0}
          onClick={() => onBulkFixtureType("Checking fixture")}
        >
          Bulk type
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={selectedCount === 0} onClick={onBulkOutsourcedToggle}>
          Toggle outsourced
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={selectedCount === 0} onClick={onBulkDedupe}>
          Dedupe suffix
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={selectedCount === 0}
          onClick={onBulkDelete}
          className="text-destructive hover:text-destructive"
        >
          <Trash2 className="mr-1 h-3.5 w-3.5" />
          Remove selected
        </Button>
        <div className="ml-auto flex flex-wrap gap-1">
          <Button type="button" size="sm" variant="ghost" onClick={() => exportSheetSnapshot(rows, projectCode)}>
            <Download className="mr-1 h-3.5 w-3.5" />
            Snapshot
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => exportValidationErrors(rows, projectCode)}>
            Errors
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => exportUnresolvedConflicts(rows, decisions, projectCode)}
          >
            Conflicts
          </Button>
        </div>
      </div>
    </div>
  );
}
