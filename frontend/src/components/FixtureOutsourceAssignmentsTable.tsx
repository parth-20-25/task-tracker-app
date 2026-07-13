import { ChevronDown, Loader2 } from "lucide-react";

import type { FixtureOutsourceAssignment } from "@/api/outsourceAssignmentsApi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fixtureOutsourceStatusLabel } from "@/lib/outsourceAssignments";
import { cn } from "@/lib/utils";

interface FixtureOutsourceAssignmentsTableProps {
  assignments: FixtureOutsourceAssignment[];
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
}

function formatDeadline(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function FixtureOutsourceAssignmentsTable({
  assignments,
  isLoading,
  error,
  onRetry,
}: FixtureOutsourceAssignmentsTableProps) {
  if (isLoading) {
    return <p className="flex items-center gap-2 py-3 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading outsourced stages...</p>;
  }
  if (error) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
        <p>{error.message}</p>
        <Button type="button" size="sm" variant="outline" className="mt-2" onClick={onRetry}>Retry</Button>
      </div>
    );
  }
  if (assignments.length === 0) {
    return <p className="text-xs text-muted-foreground">No stage-scoped outsourcing records.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <Table className="min-w-[1080px]">
        <TableHeader>
          <TableRow>
            <TableHead>Fixture</TableHead>
            <TableHead>Outsourced workflow stage</TableHead>
            <TableHead>External vendor</TableHead>
            <TableHead>Internal coordinator</TableHead>
            <TableHead>Deadline</TableHead>
            <TableHead>Outsourcing status</TableHead>
            <TableHead>Official stage</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {assignments.map((assignment) => (
            <TableRow key={assignment.id} className={cn(assignment.status === "CANCELLED" && "opacity-70")}>
              <TableCell className="align-top">
                <div className="font-medium">{assignment.fixture_no}</div>
                <details className="mt-1 text-xs text-muted-foreground">
                  <summary className="flex cursor-pointer list-none items-center gap-1"><ChevronDown className="h-3 w-3" /> History ({assignment.events.length})</summary>
                  {assignment.events.length ? (
                    <ul className="mt-1 space-y-1 border-l pl-2">
                      {assignment.events.map((event) => (
                        <li key={event.id}>{event.event_type.replace(/_/g, " ")} · {formatDeadline(event.created_at)}{event.reason ? " · " + event.reason : ""}</li>
                      ))}
                    </ul>
                  ) : <p className="mt-1">No history.</p>}
                </details>
              </TableCell>
              <TableCell className="align-top">
                <div className="font-medium">{assignment.workflow_stage_name}</div>
                <div className="text-xs text-muted-foreground">{assignment.workflow_stage_code} v{assignment.workflow_stage_version}</div>
              </TableCell>
              <TableCell className="align-top">
                <div className="font-medium">{assignment.vendor_name}</div>
                <div className="text-xs text-muted-foreground">Vendor{assignment.vendor_code ? " · " + assignment.vendor_code : ""}</div>
              </TableCell>
              <TableCell className="align-top">
                <div className="font-medium">{assignment.internal_coordinator_name || assignment.internal_coordinator_id}</div>
                <div className="text-xs text-muted-foreground">Internal coordinator</div>
              </TableCell>
              <TableCell className="align-top">{formatDeadline(assignment.deadline)}</TableCell>
              <TableCell className="align-top"><Badge variant="outline">{fixtureOutsourceStatusLabel(assignment.status)}</Badge></TableCell>
              <TableCell className="align-top"><Badge variant="secondary">{assignment.official_stage_status || "Pending"}</Badge></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
