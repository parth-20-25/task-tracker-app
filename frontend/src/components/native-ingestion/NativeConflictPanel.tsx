import { GitMerge, RotateCcw, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { NativeIngestionRow } from "./NativeIngestionTypes";

interface NativeConflictPanelProps {
  rows: NativeIngestionRow[];
  focusedRow: NativeIngestionRow | null;
  resolutions: Record<string, "merge" | "replace" | "skip">;
  onFocusRow: (row: NativeIngestionRow) => void;
  onResolutionChange: (rowId: string, resolution: "merge" | "replace" | "skip") => void;
}

function FieldDiff({
  label,
  existing,
  incoming,
}: {
  label: string;
  existing: string | number | null | undefined;
  incoming: string | number | boolean | null | undefined;
}) {
  const left = existing === null || existing === undefined || existing === "" ? "-" : String(existing);
  const right = incoming === null || incoming === undefined || incoming === "" ? "-" : String(incoming);
  const differs = left.toLowerCase() !== right.toLowerCase();

  return (
    <div className={cn("grid grid-cols-[92px_1fr_1fr] gap-2 border-t py-2 text-xs", differs && "bg-orange-50/60")}>
      <span className="font-medium text-slate-600">{label}</span>
      <span className="truncate" title={left}>{left}</span>
      <span className="truncate" title={right}>{right}</span>
    </div>
  );
}

export function NativeConflictPanel({
  rows,
  focusedRow,
  resolutions,
  onFocusRow,
  onResolutionChange,
}: NativeConflictPanelProps) {
  const conflictRows = rows.filter((row) => row.classification === "CONFLICT");
  const row = focusedRow?.classification === "CONFLICT" ? focusedRow : conflictRows[0] || null;

  return (
    <aside className="flex h-full w-[360px] shrink-0 flex-col border-l bg-slate-50">
      <div className="border-b px-4 py-3">
        <p className="text-sm font-semibold">Conflict Resolution</p>
        <p className="text-xs text-slate-500">{conflictRows.length} row(s) require explicit action</p>
      </div>

      <div className="max-h-48 overflow-auto border-b">
        {conflictRows.length === 0 ? (
          <div className="px-4 py-5 text-xs text-slate-500">No conflicts after validation.</div>
        ) : conflictRows.map((conflict) => (
          <button
            type="button"
            key={conflict.row_id}
            onClick={() => onFocusRow(conflict)}
            className={cn(
              "flex w-full items-center justify-between border-b px-4 py-2 text-left text-xs hover:bg-white",
              row?.row_id === conflict.row_id && "bg-white text-primary",
            )}
          >
            <span className="min-w-0 truncate">{conflict.fixture_no || `Row ${conflict.row_number}`}</span>
            <span className="ml-2 shrink-0 text-[10px] uppercase text-slate-500">
              {resolutions[conflict.row_id] || "open"}
            </span>
          </button>
        ))}
      </div>

      {!row ? (
        <div className="p-4 text-xs text-slate-500">
          Select a conflict row to compare production truth with the incoming spreadsheet row.
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="border-b bg-white px-4 py-3">
            <p className="truncate text-sm font-semibold">{row.fixture_no}</p>
            <p className="text-xs text-slate-500">{row.validation_state}</p>
          </div>

          <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
            <div className="grid grid-cols-[92px_1fr_1fr] gap-2 pb-2 text-[10px] font-semibold uppercase text-slate-500">
              <span>Field</span>
              <span>Existing</span>
              <span>Incoming</span>
            </div>
            <FieldDiff label="Part" existing={row.existing?.part_name} incoming={row.part_name} />
            <FieldDiff label="Type" existing={row.existing?.fixture_type} incoming={row.fixture_type} />
            <FieldDiff label="Qty" existing={row.existing?.qty} incoming={row.qty} />
            <FieldDiff label="Remark" existing={row.existing?.remark} incoming={row.remark} />
            <FieldDiff label="Outsource" existing={row.existing?.is_outsourced ? "TRUE" : "FALSE"} incoming={row.is_outsourced ? "TRUE" : "FALSE"} />
            <FieldDiff label="Vendor" existing={row.existing?.vendor_name} incoming={row.vendor_name} />
            <FieldDiff label="Image 1" existing={row.existing?.image_1_url} incoming={row.image_1_url} />
            <FieldDiff label="Image 2" existing={row.existing?.image_2_url} incoming={row.image_2_url} />
          </div>

          <div className="space-y-2 border-t bg-white p-3">
            <Button
              type="button"
              variant={resolutions[row.row_id] === "merge" ? "default" : "outline"}
              className="w-full justify-start"
              onClick={() => onResolutionChange(row.row_id, "merge")}
            >
              <GitMerge className="mr-2 h-4 w-4" />
              Merge
            </Button>
            <Button
              type="button"
              variant={resolutions[row.row_id] === "replace" ? "default" : "outline"}
              className="w-full justify-start"
              onClick={() => onResolutionChange(row.row_id, "replace")}
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              Replace
            </Button>
            <Button
              type="button"
              variant={resolutions[row.row_id] === "skip" ? "default" : "outline"}
              className="w-full justify-start"
              onClick={() => onResolutionChange(row.row_id, "skip")}
            >
              <SkipForward className="mr-2 h-4 w-4" />
              Skip
            </Button>
          </div>
        </div>
      )}
    </aside>
  );
}
