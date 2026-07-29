import { useQuery } from "@tanstack/react-query";
import { fetchProjectScope, type ProjectScopeRow } from "@/api/projectScopeApi";

const frozen = [
  { key: "sr_no", label: "SR NO.", width: 70, left: 0 },
  { key: "priority", label: "PRIORITY", width: 90, left: 70 },
  { key: "project_no", label: "PROJECT NO.", width: 135, left: 160 },
  { key: "project_description", label: "PROJECT DESCRIPTION", width: 260, left: 295 },
] as const;

const scopeColumns = [
  ["robotic_welding_fix", "ROBOTIC WELDING FIX"],
  ["manual_welding_fix", "MANUAL WELDING FIX"],
  ["spms", "SPMS"],
  ["manual_auto_inspection", "MANUAL INSPECTION / AUTO INSPECTION"],
  ["hand_gauge", "HAND GAUGE"],
  ["robotic_cell_shuttle", "ROBOTIC CELL / SHUTTLE"],
  ["servo_pumatic_gantry", "SERVO / PUMATIC GANTRY"],
] as const;

const hoursColumns = [
  ["concept_hours", "CONCEPT"],
  ["dap_hours", "DAP"],
  ["three_d_finish_hours", "3D FINISH"],
  ["two_d_finish_hours", "2D FINISH"],
] as const;

function value(row: ProjectScopeRow, key: keyof ProjectScopeRow, decimals = false) {
  const current = row[key];
  if (current === null || current === undefined || current === "") return "";
  const number = Number(current);
  return decimals ? Number(number.toFixed(2)).toString() : String(current);
}

export default function ViewScope() {
  const query = useQuery({ queryKey: ["project-scope"], queryFn: fetchProjectScope, refetchOnWindowFocus: false });
  const projects = query.data?.projects ?? [];

  return (
    <div className="flex h-[calc(100vh-7rem)] min-h-0 flex-col gap-2">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">View Scope</h1>
          <p className="text-xs text-muted-foreground">Active project WBS scope and normalized planned hours</p>
        </div>
        <span className="text-xs text-muted-foreground">{projects.length} active project{projects.length === 1 ? "" : "s"}</span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto border bg-white">
        <table className="min-w-[2180px] table-fixed border-collapse text-[11px] leading-tight">
          <thead className="sticky top-0 z-30 bg-slate-100 text-slate-800">
            <tr>
              <th colSpan={4} className="border px-1.5 py-1 text-center font-semibold">PROJECT DETAILS</th>
              <th colSpan={7} className="border px-1.5 py-1 text-center font-semibold">SCOPE OF WORK</th>
              <th rowSpan={2} className="w-[95px] border px-1.5 py-1 align-middle font-semibold">TOTAL SCOPE</th>
              <th colSpan={4} className="border px-1.5 py-1 text-center font-semibold">WORK HRS REQUIRED</th>
              <th colSpan={2} className="border px-1.5 py-1 text-center font-semibold">PLANNING TOTALS</th>
            </tr>
            <tr>
              {frozen.map((column) => (
                <th
                  key={column.key}
                  style={{ left: column.left, width: column.width, minWidth: column.width }}
                  className="sticky z-40 border bg-slate-100 px-1.5 py-1 text-left font-semibold"
                >
                  {column.label}
                </th>
              ))}
              {scopeColumns.map(([key, label]) => <th key={key} className="w-[145px] border px-1.5 py-1 text-center font-semibold">{label}</th>)}
              {hoursColumns.map(([key, label]) => <th key={key} className="w-[95px] border px-1.5 py-1 text-center font-semibold">{label}</th>)}
              <th className="w-[100px] border px-1.5 py-1 text-center font-semibold">TOTAL HOURS</th>
              <th className="w-[75px] border px-1.5 py-1 text-center font-semibold">DAYS</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((row) => (
              <tr key={row.project_id} className="h-7 even:bg-slate-50 hover:bg-blue-50">
                {frozen.map((column) => (
                  <td
                    key={column.key}
                    style={{ left: column.left, width: column.width, minWidth: column.width }}
                    className="sticky z-10 truncate border bg-inherit px-1.5 py-1"
                    title={String(row[column.key] ?? "")}
                  >
                    {value(row, column.key)}
                  </td>
                ))}
                {scopeColumns.map(([key]) => <td key={key} className="border px-1.5 py-1 text-right tabular-nums">{value(row, key)}</td>)}
                <td className="border bg-slate-100/80 px-1.5 py-1 text-right font-semibold tabular-nums">{value(row, "total_scope")}</td>
                {hoursColumns.map(([key]) => <td key={key} className="border px-1.5 py-1 text-right tabular-nums">{value(row, key, true)}</td>)}
                <td className="border bg-slate-100/80 px-1.5 py-1 text-right font-semibold tabular-nums">{value(row, "total_hours", true)}</td>
                <td className="border bg-slate-100/80 px-1.5 py-1 text-right font-semibold tabular-nums">{value(row, "days", true)}</td>
              </tr>
            ))}
            {!query.isLoading && projects.length === 0 ? (
              <tr><td colSpan={18} className="border p-6 text-center text-sm text-muted-foreground">No active projects.</td></tr>
            ) : null}
          </tbody>
        </table>
        {query.isLoading ? <p className="p-6 text-center text-sm text-muted-foreground">Loading project scope…</p> : null}
        {query.isError ? <p className="p-6 text-center text-sm text-destructive">{query.error instanceof Error ? query.error.message : "Could not load project scope."}</p> : null}
      </div>
    </div>
  );
}