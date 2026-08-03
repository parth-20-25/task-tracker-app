import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Eye } from "lucide-react";
import { fetchTeamActivity, type TeamActivityStatus } from "@/api/teamActivityApi";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { teamActivityQueryKeys } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";

const statuses: TeamActivityStatus[] = ["Working", "Not Started", "Available", "Overdue", "Task Selection Required"];

const statusClass: Record<TeamActivityStatus, string> = {
  Working: "bg-emerald-100 text-emerald-800",
  "Not Started": "bg-slate-100 text-slate-700",
  Available: "bg-blue-100 text-blue-800",
  Overdue: "bg-red-100 text-red-800",
  "Task Selection Required": "bg-amber-100 text-amber-900",
};

export default function TeamActivity() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<TeamActivityStatus | "all">("all");
  const [expandedEmployeeId, setExpandedEmployeeId] = useState<string | null>(null);
  const query = useQuery({
    queryKey: teamActivityQueryKeys.all,
    queryFn: fetchTeamActivity,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  });
  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (query.data || []).filter((row) => (
      (!term || row.employee_name.toLowerCase().includes(term) || row.employee_id.toLowerCase().includes(term))
      && (status === "all" || row.status === status)
    ));
  }, [query.data, search, status]);

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-xl font-semibold">Team Activity</h1>
        <p className="text-sm text-muted-foreground">Current activity for employees mapped to your team</p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Input aria-label="Employee search" className="sm:max-w-xs" onChange={(event) => setSearch(event.target.value)} placeholder="Search employees" value={search} />
        <select aria-label="Status filter" className="h-10 rounded-md border border-input bg-background px-3 text-sm sm:w-56" onChange={(event) => setStatus(event.target.value as TeamActivityStatus | "all")} value={status}>
          <option value="all">All statuses</option>
          {statuses.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      </div>

      <div className="rounded-md border bg-background">
        <Table>
          <TableHeader><TableRow><TableHead>Employee Name</TableHead><TableHead>Current Task</TableHead><TableHead className="w-40 text-right">Total Active Tasks</TableHead><TableHead className="w-48">Status</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map((row) => {
              const expanded = expandedEmployeeId === row.employee_id;
              const tasks = row.tasks || [];
              return <Fragment key={row.employee_id}>
                <TableRow key={row.employee_id} onClick={() => setExpandedEmployeeId(expanded ? null : row.employee_id)} className="cursor-pointer">
                  <TableCell className="font-medium"><span className="inline-flex items-center gap-1">{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}{row.employee_name}</span></TableCell>
                  <TableCell className="whitespace-pre-line text-xs leading-5">{row.current_task}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.total_active_tasks}</TableCell>
                  <TableCell><span className={cn("inline-flex rounded-full px-2 py-1 text-xs font-medium", statusClass[row.status])}>{row.status}</span></TableCell>
                </TableRow>
                {expanded ? <TableRow key={`${row.employee_id}-tasks`}><TableCell colSpan={4} className="bg-slate-50 p-3"><table className="w-full text-left text-xs"><thead className="text-muted-foreground"><tr><th className="pb-2 font-medium">Project No</th><th className="pb-2 font-medium">Task/Fixture</th><th className="pb-2 font-medium">Stage</th><th className="pb-2 font-medium">Status</th><th className="pb-2 font-medium">Assignee</th><th className="pb-2 text-center font-medium">Proof</th></tr></thead><tbody>{tasks.map((task) => <tr key={task.task_id} className="border-t"><td className="py-2">{task.project_no}</td><td className="py-2">{task.task_or_fixture}</td><td className="py-2">{task.stage}</td><td className="py-2">{task.status}</td><td className="py-2">{task.assignee}</td><td className="py-2 text-center">{task.proof_urls.at(-1) ? <a href={task.proof_urls.at(-1)} target="_blank" rel="noreferrer" aria-label={`View proof for ${task.task_or_fixture}`} onClick={(event) => event.stopPropagation()} className="inline-flex rounded p-1 text-slate-600 hover:bg-slate-200 hover:text-slate-950"><Eye className="h-4 w-4" /></a> : "—"}</td></tr>)}{tasks.length === 0 ? <tr><td colSpan={6} className="py-2 text-muted-foreground">No active tasks.</td></tr> : null}</tbody></table></TableCell></TableRow> : null}
              </Fragment>;
            })}
            {!query.isLoading && rows.length === 0 ? <TableRow><TableCell colSpan={4} className="h-24 text-center text-muted-foreground">No matching employees.</TableCell></TableRow> : null}
          </TableBody>
        </Table>
        {query.isLoading ? <p className="p-6 text-center text-sm text-muted-foreground">Loading team activity…</p> : null}
        {query.isError ? <p className="p-6 text-center text-sm text-destructive">{query.error instanceof Error ? query.error.message : "Could not load team activity."}</p> : null}
      </div>
    </div>
  );
}