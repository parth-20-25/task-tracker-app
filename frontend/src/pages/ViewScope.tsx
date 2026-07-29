import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import { fetchProjectScope, type ProjectScopeRow } from "@/api/projectScopeApi";
import { Input } from "@/components/ui/input";

const frozen = [
  { key: "sr_no", label: "SR NO.", width: 64, left: 0, align: "text-center" },
  { key: "priority", label: "PRIORITY", width: 88, left: 64, align: "text-center" },
  { key: "project_no", label: "PROJECT NO.", width: 160, left: 152, align: "text-left" },
  { key: "project_description", label: "PROJECT DESCRIPTION", width: 320, left: 312, align: "text-left" },
] as const;

const scopeWidth = 145;
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
  ["concept_hours", "CONCEPT", 110],
  ["dap_hours", "DAP", 100],
  ["three_d_finish_hours", "3D FINISH", 110],
  ["two_d_finish_hours", "2D FINISH", 110],
] as const;

const totalScopeWidth = 100;
const totalHoursWidth = 110;
const daysWidth = 90;
const tableWidth = frozen.reduce((total, column) => total + column.width, 0)
  + (scopeColumns.length * scopeWidth)
  + totalScopeWidth
  + hoursColumns.reduce((total, column) => total + column[2], 0)
  + totalHoursWidth
  + daysWidth;
const tableColumnCount = frozen.length + scopeColumns.length + 1 + hoursColumns.length + 2;

function value(row: ProjectScopeRow, key: keyof ProjectScopeRow, decimals = false, missing = "") {
  const current = row[key];
  if (current === null || current === undefined || current === "") return missing;
  const number = Number(current);
  return decimals ? Number(number.toFixed(2)).toString() : String(current);
}

export default function ViewScope() {
  const [search, setSearch] = useState("");
  const query = useQuery({ queryKey: ["project-scope"], queryFn: fetchProjectScope, refetchOnWindowFocus: false });
  const projects = query.data?.projects ?? [];
  const normalizedSearch = search.trim().toLowerCase();
  const filteredProjects = normalizedSearch
    ? projects.filter((project) => (
      project.project_no.toLowerCase().includes(normalizedSearch)
      || project.project_description.toLowerCase().includes(normalizedSearch)
    ))
    : projects;
  const count = normalizedSearch
    ? `${filteredProjects.length} of ${projects.length} active projects`
    : `${projects.length} active project${projects.length === 1 ? "" : "s"}`;

  return (
    <div className="flex h-[calc(100vh-7rem)] min-h-0 min-w-0 flex-col gap-3">
      <div>
        <h1 className="text-lg font-semibold">View Scope</h1>
        <p className="text-xs text-muted-foreground">Active project WBS scope and normalized planned hours</p>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="relative w-full max-w-md">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by project number or project name"
            className="h-9 bg-white pl-9 pr-9"
          />
          {search ? (
            <button
              type="button"
              aria-label="Clear project search"
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 rounded p-1 text-muted-foreground hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          ) : null}
        </div>
        <span className="shrink-0 text-xs font-medium text-slate-600">{count}</span>
      </div>

      <div className="min-h-0 min-w-0 flex-1 overflow-auto rounded-md border border-slate-300 bg-white">
        <table className="table-fixed border-separate border-spacing-0 text-[11px] leading-tight text-slate-800" style={{ width: tableWidth, minWidth: tableWidth }}>
          <colgroup>
            {frozen.map((column) => <col key={column.key} style={{ width: column.width }} />)}
            {scopeColumns.map(([key]) => <col key={key} style={{ width: scopeWidth }} />)}
            <col style={{ width: totalScopeWidth }} />
            {hoursColumns.map(([key, , width]) => <col key={key} style={{ width }} />)}
            <col style={{ width: totalHoursWidth }} />
            <col style={{ width: daysWidth }} />
          </colgroup>
          <thead>
            <tr className="h-8 uppercase tracking-wide text-white">
              <th colSpan={4} className="sticky left-0 top-0 z-[60] box-border border-b border-r border-slate-500 bg-slate-700 px-2 text-center font-semibold">PROJECT DETAILS</th>
              <th colSpan={8} className="sticky top-0 z-40 box-border border-b border-r border-blue-600 bg-blue-800 px-2 text-center font-semibold">SCOPE OF WORK</th>
              <th colSpan={4} className="sticky top-0 z-40 box-border border-b border-r border-cyan-600 bg-cyan-800 px-2 text-center font-semibold">WORK HRS REQUIRED</th>
              <th colSpan={2} className="sticky top-0 z-40 box-border border-b border-r border-emerald-600 bg-emerald-800 px-2 text-center font-semibold">TOTALS</th>
            </tr>
            <tr className="h-14">
              {frozen.map((column) => (
                <th key={column.key} style={{ left: column.left, width: column.width, minWidth: column.width }} className={`sticky top-8 z-50 box-border border-b border-r border-slate-300 bg-slate-200 px-2 py-1 font-semibold leading-[1.15] ${column.align} ${column.key === "project_description" ? "shadow-[5px_0_7px_-5px_rgba(15,23,42,0.75)]" : ""}`}>
                  {column.label}
                </th>
              ))}
              {scopeColumns.map(([key, label]) => <th key={key} className="sticky top-8 z-40 box-border border-b border-r border-slate-300 bg-slate-100 px-2 py-1 text-center font-semibold leading-[1.15]">{label}</th>)}
              <th className="sticky top-8 z-40 box-border border-b border-r border-slate-300 bg-blue-100 px-2 py-1 text-center font-bold leading-[1.15]">TOTAL SCOPE</th>
              {hoursColumns.map(([key, label]) => <th key={key} className="sticky top-8 z-40 box-border border-b border-r border-slate-300 bg-slate-100 px-2 py-1 text-center font-semibold leading-[1.15]">{label}</th>)}
              <th className="sticky top-8 z-40 box-border border-b border-r border-slate-300 bg-emerald-100 px-2 py-1 text-center font-bold leading-[1.15]">TOTAL HOURS</th>
              <th className="sticky top-8 z-40 box-border border-b border-r border-slate-300 bg-emerald-100 px-2 py-1 text-center font-bold leading-[1.15]">DAYS</th>
            </tr>
          </thead>
          <tbody>
            {filteredProjects.map((row, index) => {
              const rowBackground = index % 2 === 0 ? "bg-white" : "bg-slate-50";
              return (
                <tr key={row.project_id} className={`group h-10 ${rowBackground} hover:bg-blue-50`}>
                  {frozen.map((column) => (
                    <td key={column.key} style={{ left: column.left, width: column.width, minWidth: column.width }} className={`sticky z-20 box-border overflow-hidden whitespace-nowrap border-b border-r border-slate-200 px-2 py-1 group-hover:bg-blue-50 ${column.align} ${rowBackground} ${column.key === "project_description" ? "shadow-[5px_0_7px_-5px_rgba(15,23,42,0.45)]" : ""}`} title={String(row[column.key] ?? "")}>
                      <span className="block overflow-hidden text-ellipsis whitespace-nowrap">{value(row, column.key)}</span>
                    </td>
                  ))}
                  {scopeColumns.map(([key]) => <td key={key} className="box-border overflow-hidden border-b border-r border-slate-200 px-2 py-1 text-center tabular-nums">{value(row, key)}</td>)}
                  <td className="box-border overflow-hidden border-b border-r border-blue-200 bg-blue-50 px-2 py-1 text-center font-bold tabular-nums group-hover:bg-blue-100">{value(row, "total_scope")}</td>
                  {hoursColumns.map(([key]) => <td key={key} className="box-border overflow-hidden border-b border-r border-slate-200 px-2 py-1 text-center tabular-nums">{value(row, key, true, "—")}</td>)}
                  <td className="box-border overflow-hidden border-b border-r border-emerald-200 bg-emerald-50 px-2 py-1 text-center font-bold tabular-nums group-hover:bg-emerald-100">{value(row, "total_hours", true, "—")}</td>
                  <td className="box-border overflow-hidden border-b border-r border-emerald-200 bg-emerald-50 px-2 py-1 text-center font-bold tabular-nums group-hover:bg-emerald-100">{value(row, "days", true, "—")}</td>
                </tr>
              );
            })}
            {!query.isLoading && filteredProjects.length === 0 ? (
              <tr><td colSpan={tableColumnCount} className="border-b border-r border-slate-200 p-6 text-center text-sm text-muted-foreground">0 projects found</td></tr>
            ) : null}
          </tbody>
        </table>
        {query.isLoading ? <p className="p-6 text-center text-sm text-muted-foreground">Loading project scope…</p> : null}
        {query.isError ? <p className="p-6 text-center text-sm text-destructive">{query.error instanceof Error ? query.error.message : "Could not load project scope."}</p> : null}
      </div>
    </div>
  );
}
