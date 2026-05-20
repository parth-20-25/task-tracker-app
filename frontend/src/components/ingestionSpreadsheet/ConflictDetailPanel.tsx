import type { SpreadsheetRow } from "@/lib/ingestionSpreadsheet/types";
import { rowDecisionKey } from "@/lib/ingestionSpreadsheet/gridModel";

interface ConflictDetailPanelProps {
  row: SpreadsheetRow | null;
  decision?: "incoming" | "existing";
}

export function ConflictDetailPanel({ row, decision }: ConflictDetailPanelProps) {
  if (!row || row.classification !== "CONFLICT" || !row.incoming || !row.existing) {
    return (
      <div className="border-l bg-muted/20 p-3 text-xs text-muted-foreground">
        Select a conflict row to compare existing vs incoming values.
      </div>
    );
  }

  const fields = [
    { label: "Part name", existing: row.existing.part_name, incoming: row.incoming.part_name },
    { label: "Fixture type", existing: row.existing.fixture_type, incoming: row.incoming.fixture_type },
    { label: "QTY", existing: String(row.existing.qty), incoming: String(row.incoming.qty) },
  ];

  return (
    <div className="border-l bg-muted/20 p-3 text-xs">
      <p className="mb-2 font-semibold">
        {row.fixtureNo} — manual resolution required
      </p>
      <p className="mb-3 text-muted-foreground">
        {row.diffType?.replace(/_/g, " ") || "Data mismatch"}
        {decision ? ` • Current: ${decision === "incoming" ? "Use incoming" : "Keep existing"}` : " • Unresolved"}
      </p>
      <div className="grid grid-cols-3 gap-2 font-medium text-[10px] uppercase text-muted-foreground">
        <span>Field</span>
        <span>Existing</span>
        <span>Incoming</span>
      </div>
      {fields.map((field) => (
        <div key={field.label} className="mt-1 grid grid-cols-3 gap-2 border-t py-1">
          <span>{field.label}</span>
          <span className={decision === "existing" ? "font-semibold text-foreground" : ""}>{field.existing}</span>
          <span className={decision === "incoming" ? "font-semibold text-primary" : ""}>{field.incoming}</span>
        </div>
      ))}
      <p className="mt-3 text-[10px] text-muted-foreground">
        Row key: {rowDecisionKey(row)}
      </p>
    </div>
  );
}
