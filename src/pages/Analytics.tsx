import { useQuery } from '@tanstack/react-query';
import { fetchAnalytics } from '@/api/analyticsApi';
import { MetricCard } from '@/components/MetricCard';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { analyticsQueryKeys } from '@/lib/queryKeys';
import { formatDurationMinutes } from '@/lib/formatDuration';
import { AlertTriangle, CheckCircle2, Clock, RotateCcw, Timer } from 'lucide-react';

export default function Analytics() {
  const analyticsQuery = useQuery({
    queryKey: analyticsQueryKeys.all,
    queryFn: fetchAnalytics,
  });

  const data = analyticsQuery.data;

  if (!data) {
    return <p className="text-sm text-muted-foreground">Loading analytics...</p>;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">Analytics</h1>
        <p className="text-sm text-muted-foreground">KPI summary, department performance, and downtime signals.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <MetricCard label="Closed" value={data.summary.closed} icon={CheckCircle2} color="text-success" />
        <MetricCard label="Under Review" value={data.summary.under_review} icon={Clock} color="text-warning" />
        <MetricCard label="Overdue" value={data.summary.overdue} icon={AlertTriangle} color="text-destructive" />
        <MetricCard label="Rework Rate" value={`${data.summary.rework_rate}%`} icon={RotateCcw} color="text-destructive" />
        <MetricCard label="Avg Actual" value={formatDurationMinutes(data.summary.average_actual_minutes)} icon={Timer} color="text-info" />
      </div>

      <Card>
        <CardHeader className="p-4 pb-2">
          <h2 className="font-semibold">Department Performance</h2>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Department</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Closed</TableHead>
                <TableHead>Overdue</TableHead>
                <TableHead>Rework</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.department_performance.map(row => (
                <TableRow key={row.department}>
                  <TableCell className="font-medium">{row.department}</TableCell>
                  <TableCell>{row.total}</TableCell>
                  <TableCell>{row.closed}</TableCell>
                  <TableCell>{row.overdue}</TableCell>
                  <TableCell>{row.rework}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-4 pb-2">
          <h2 className="font-semibold">Downtime</h2>
        </CardHeader>
        <CardContent className="p-4 grid md:grid-cols-3 gap-3">
          {data.downtime.map(row => (
            <div key={row.machine} className="border rounded-lg p-3">
              <p className="text-sm font-medium">{row.machine}</p>
              <p className="text-xs text-muted-foreground mt-1">{row.tasks} task(s), {formatDurationMinutes(row.downtime_minutes)} downtime</p>
            </div>
          ))}
          {data.downtime.length === 0 && <p className="text-sm text-muted-foreground">No machine downtime tagged yet.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
