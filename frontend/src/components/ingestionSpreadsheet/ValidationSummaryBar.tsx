import { AlertTriangle, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { countRowsByClassification } from "@/lib/ingestionSpreadsheet/filters";
import { classificationClassName, classificationLabel } from "@/lib/ingestionSpreadsheet/classificationStyles";
import type { CellValidationIssue, SpreadsheetRow } from "@/lib/ingestionSpreadsheet/types";
import { cn } from "@/lib/utils";

interface ValidationSummaryBarProps {
  rows: SpreadsheetRow[];
  validationIssues: CellValidationIssue[];
  onJumpToError: () => void;
  onToggleValidationFilter: () => void;
  validationFilterActive: boolean;
}

export function ValidationSummaryBar({
  rows,
  validationIssues,
  onJumpToError,
  onToggleValidationFilter,
  validationFilterActive,
}: ValidationSummaryBarProps) {
  const counts = countRowsByClassification(rows);

  return (
    <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-3 py-2 text-xs">
      {Object.entries(counts).map(([classification, count]) => (
        <span
          key={classification}
          className={cn(
            "rounded-full px-2 py-0.5 font-semibold",
            classificationClassName(classification as keyof typeof counts),
          )}
        >
          {classificationLabel(classification as never)}: {count}
        </span>
      ))}
      {validationIssues.length > 0 ? (
        <>
          <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 font-semibold text-red-800 dark:bg-red-950 dark:text-red-300">
            <AlertTriangle className="h-3 w-3" />
            {validationIssues.length} cell issue{validationIssues.length === 1 ? "" : "s"}
          </span>
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onJumpToError}>
            Jump to first error
          </Button>
          <Button
            type="button"
            variant={validationFilterActive ? "secondary" : "ghost"}
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={onToggleValidationFilter}
          >
            <ChevronDown className="mr-1 h-3 w-3" />
            Errors only
          </Button>
        </>
      ) : (
        <span className="text-muted-foreground">No client-side cell issues</span>
      )}
    </div>
  );
}
