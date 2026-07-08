import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Clock3, ExternalLink, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useAcknowledgeNotificationMutation,
  useMyOverdueAlertsQuery,
  useTeamOverdueAlertsQuery,
} from "@/hooks/queries/useOverdueNotificationsQuery";
import { cn } from "@/lib/utils";
import type { OverdueAlert } from "@/types";

function formatOverdueDelay(totalMinutes: number) {
  const minutes = Math.max(0, Math.floor(Number(totalMinutes) || 0));

  if (minutes < 60) {
    return `${minutes}m overdue`;
  }

  if (minutes < 24 * 60) {
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return remainder > 0 ? `${hours}h ${remainder}m overdue` : `${hours}h overdue`;
  }

  const days = Math.floor(minutes / (24 * 60));
  const hours = Math.floor((minutes % (24 * 60)) / 60);
  return hours > 0 ? `${days}d ${hours}h overdue` : `${days}d overdue`;
}

function formatDeadline(value: string) {
  const deadline = new Date(value);
  return Number.isFinite(deadline.getTime()) ? deadline.toLocaleString() : "No deadline";
}

function formatStatus(value: string) {
  return String(value || "unknown").replace(/_/g, " ");
}

const EMPTY_ALERTS: OverdueAlert[] = [];

function buildAlertKey(alerts: OverdueAlert[]) {
  return alerts
    .map((alert) => `${alert.notification_id}:${alert.overdue_minutes}`)
    .sort()
    .join("|");
}

function AlertRow({
  alert,
  isTeamAlert,
  isAcknowledging,
  onAcknowledge,
  onOpenTask,
}: {
  alert: OverdueAlert;
  isTeamAlert: boolean;
  isAcknowledging: boolean;
  onAcknowledge: (notificationId: string) => void;
  onOpenTask: (taskId: number) => void;
}) {
  const delayLabel = alert.time_overdue || formatOverdueDelay(alert.overdue_minutes);

  return (
    <div className="rounded-md border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className={cn(
                "border-amber-200 bg-amber-50 text-amber-900",
                alert.severity === "critical" && "border-red-200 bg-red-50 text-red-900",
              )}
            >
              {delayLabel}
            </Badge>
            <Badge variant="outline" className="capitalize">
              {formatStatus(alert.current_status)}
            </Badge>
          </div>

          {isTeamAlert ? (
            <div className="grid gap-1 text-sm sm:grid-cols-2">
              <span className="font-medium">Employee</span>
              <span>{alert.employee_name || "Unknown"} ({alert.employee_id || "No ID"})</span>
            </div>
          ) : null}

          <div className="grid gap-1 text-sm sm:grid-cols-2">
            <span className="font-medium">Project number</span>
            <span>{alert.project_number || "Not recorded"}</span>
            <span className="font-medium">Project name</span>
            <span>{alert.project_name || "Not recorded"}</span>
            <span className="font-medium">Stage/task name</span>
            <span>{alert.stage_task_name}</span>
            <span className="font-medium">Deadline</span>
            <span>{formatDeadline(alert.deadline)}</span>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2 md:justify-end">
          <Button type="button" size="sm" variant="outline" onClick={() => onOpenTask(alert.task_id)}>
            <ExternalLink className="mr-2 h-4 w-4" />
            {isTeamAlert ? "Open Details" : "Open Task"}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => onAcknowledge(alert.notification_id)}
            disabled={isAcknowledging}
          >
            <CheckCircle2 className="mr-2 h-4 w-4" />
            Acknowledge
          </Button>
        </div>
      </div>
    </div>
  );
}

export function OverdueAlertModal({ includeTeam = false }: { includeTeam?: boolean }) {
  const navigate = useNavigate();
  const myAlertsQuery = useMyOverdueAlertsQuery(true);
  const teamAlertsQuery = useTeamOverdueAlertsQuery(includeTeam);
  const acknowledgeMutation = useAcknowledgeNotificationMutation();
  const [dismissedAlertKey, setDismissedAlertKey] = useState("");

  const myAlerts = myAlertsQuery.data ?? EMPTY_ALERTS;
  const teamAlerts = includeTeam ? teamAlertsQuery.data ?? EMPTY_ALERTS : EMPTY_ALERTS;
  const allAlerts = useMemo(() => [...myAlerts, ...teamAlerts], [myAlerts, teamAlerts]);
  const alertKey = useMemo(() => buildAlertKey(allAlerts), [allAlerts]);
  const isLoading = myAlertsQuery.isLoading || (includeTeam && teamAlertsQuery.isLoading);
  const shouldOpen = !isLoading && allAlerts.length > 0 && dismissedAlertKey !== alertKey;

  useEffect(() => {
    if (allAlerts.length === 0) {
      setDismissedAlertKey("");
    }
  }, [allAlerts.length]);

  const handleOpenTask = (taskId: number) => {
    if (alertKey) {
      setDismissedAlertKey(alertKey);
    }
    navigate(`/tasks/${taskId}`);
  };

  const handleOpenChange = (open: boolean) => {
    if (!open && alertKey) {
      setDismissedAlertKey(alertKey);
    }
  };

  return (
    <Dialog open={shouldOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[86vh] max-w-4xl overflow-hidden p-0">
        <DialogHeader className="border-b bg-slate-50 px-5 py-4">
          <DialogTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            Overdue Alerts
          </DialogTitle>
          <DialogDescription>
            Review overdue work assigned to you and, if applicable, overdue work under your team scope.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-5 overflow-y-auto px-5 py-4">
          {myAlerts.length > 0 ? (
            <section className="space-y-3" aria-labelledby="my-overdue-alerts-heading">
              <div className="flex items-center gap-2">
                <Clock3 className="h-4 w-4 text-amber-600" />
                <h3 id="my-overdue-alerts-heading" className="text-sm font-semibold">
                  My Overdue Tasks
                </h3>
              </div>
              <div className="space-y-2">
                {myAlerts.map((alert) => (
                  <AlertRow
                    key={alert.notification_id}
                    alert={alert}
                    isTeamAlert={false}
                    isAcknowledging={acknowledgeMutation.isPending}
                    onAcknowledge={acknowledgeMutation.mutate}
                    onOpenTask={handleOpenTask}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {teamAlerts.length > 0 ? (
            <section className="space-y-3" aria-labelledby="team-overdue-alerts-heading">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-red-600" />
                <h3 id="team-overdue-alerts-heading" className="text-sm font-semibold">
                  Team Overdue Alert
                </h3>
              </div>
              <div className="space-y-2">
                {teamAlerts.map((alert) => (
                  <AlertRow
                    key={alert.notification_id}
                    alert={alert}
                    isTeamAlert
                    isAcknowledging={acknowledgeMutation.isPending}
                    onAcknowledge={acknowledgeMutation.mutate}
                    onOpenTask={handleOpenTask}
                  />
                ))}
              </div>
            </section>
          ) : null}
        </div>

        <DialogFooter className="border-t px-5 py-4">
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
            Close / Remind Later
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}