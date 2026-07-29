import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
        <Input
          aria-label="Employee search"
          className="sm:max-w-xs"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search employees"
          value={search}
        />
        <select
          aria-label="Status filter"
          className="h-10 rounded-md border border-input bg-background px-3 text-sm sm:w-56"
          onChange={(event) => setStatus(event.target.value as TeamActivityStatus | "all")}
          value={status}
        >
          <option value="all">All statuses</option>
          {statuses.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      </div>

      <div className="rounded-md border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee Name</TableHead>
              <TableHead>Current Task</TableHead>
              <TableHead className="w-40 text-right">Total Active Tasks</TableHead>
              <TableHead className="w-48">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.employee_id}>
                <TableCell className="font-medium">{row.employee_name}</TableCell>
                <TableCell className="whitespace-pre-line text-xs leading-5">{row.current_task}</TableCell>
                <TableCell className="text-right tabular-nums">{row.total_active_tasks}</TableCell>
                <TableCell>
                  <span className={cn("inline-flex rounded-full px-2 py-1 text-xs font-medium", statusClass[row.status])}>
                    {row.status}
                  </span>
                </TableCell>
              </TableRow>
            ))}
            {!query.isLoading && rows.length === 0 ? (
              <TableRow><TableCell colSpan={4} className="h-24 text-center text-muted-foreground">No matching employees.</TableCell></TableRow>
            ) : null}
          </TableBody>
        </Table>
        {query.isLoading ? <p className="p-6 text-center text-sm text-muted-foreground">Loading team activity…</p> : null}
        {query.isError ? <p className="p-6 text-center text-sm text-destructive">{query.error instanceof Error ? query.error.message : "Could not load team activity."}</p> : null}
      </div>
    </div>
  );
}
