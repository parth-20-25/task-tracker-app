import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertCircle,
  BarChart3,
  CheckCircle2,
  Clock,
  Layers3,
  RefreshCw,
  TimerReset,
} from "lucide-react";

import {
  fetchAnalyticsOverview,
  type AnalyticsFilters,
  type AnalyticsOverviewPayload,
} from "@/api/analytics/overviewApi";
import { analyticsOverviewQueryKeys } from "@/lib/queryKeys";
import AnalyticsFilterBar from "./AnalyticsFilterBar";
import ReworkIntelligence from "./ReworkIntelligence";
import DeadlineHonesty from "./DeadlineHonesty";
import UserPerformance from "./UserPerformance";
import WorkflowHealth from "./WorkflowHealth";
import PredictiveInsights from "./PredictiveInsights";

function minutesToHours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

const GRADIENT_COLORS = [
  "#0f766e",
  "#0284c7",
  "#2563eb",
  "#4f46e5",
  "#7c3aed",
  "#c2410c",
  "#ca8a04",
  "#15803d",
];

function getBarColor(index: number): string {
  return GRADIENT_COLORS[index % GRADIENT_COLORS.length];
}

interface TooltipPayload {
  payload?: {
    stage_name: string;
    avg_minutes: number;
  };
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayload[] }) {
  if (!active || !payload?.length || !payload[0].payload) return null;
  const row = payload[0].payload;

  return (
    <div className="min-w-[180px] space-y-1.5 rounded-xl border border-border/60 bg-background/95 p-3 text-sm shadow-xl backdrop-blur-sm">
      <p className="mb-2 border-b border-border/40 pb-1.5 font-semibold text-foreground">{row.stage_name}</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <span className="text-muted-foreground">Average</span>
        <span className="font-medium text-foreground">{formatDuration(row.avg_minutes)}</span>
      </div>
    </div>
  );
}

function ComparisonTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { department_name: string; workflow_health_score: number; on_time_rate_pct: number; rework_rate_pct: number } }> }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;

  return (
    <div className="min-w-[190px] space-y-1.5 rounded-xl border border-border/60 bg-background/95 p-3 text-sm shadow-xl backdrop-blur-sm">
      <p className="mb-2 border-b border-border/40 pb-1.5 font-semibold text-foreground">{row.department_name}</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <span className="text-muted-foreground">Health Score</span>
        <span className="font-medium text-foreground">{row.workflow_health_score}</span>
        <span className="text-muted-foreground">On-Time</span>
        <span className="font-medium text-foreground">{row.on_time_rate_pct.toFixed(2)}%</span>
        <span className="text-muted-foreground">Rework</span>
        <span className="font-medium text-foreground">{row.rework_rate_pct.toFixed(2)}%</span>
      </div>
    </div>
  );
}

interface SummaryMetricProps {
  label: string;
  value: string;
  sub: string;
  icon: React.ReactNode;
  accent: string;
}

function SummaryMetric({ label, value, sub, icon, accent }: SummaryMetricProps) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-border/60 bg-card p-4 shadow-sm transition-shadow hover:shadow-md">
      <div className={`rounded-xl p-2.5 ${accent}`}>{icon}</div>
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-0.5 truncate text-xl font-bold text-foreground">{value}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>
      </div>
    </div>
  );
}

export default function AnalyticsDashboard() {
  const [filters, setFilters] = useState<AnalyticsFilters>({});

  const { data, isLoading, isError, refetch } = useQuery<AnalyticsOverviewPayload>({
    queryKey: analyticsOverviewQueryKeys.filtered(filters),
    queryFn: () => fetchAnalyticsOverview(filters),
  });

  const summary = data?.summary ?? {
    assigned_entries: 0,
    completed_entries: 0,
    active_entries: 0,
    measurable_entries: 0,
    completion_rate_pct: 0,
    on_time_rate_pct: 0,
    delayed_entries: 0,
    avg_delay_minutes: 0,
    rework_rate_pct: 0,
    rework_events: 0,
    avg_cycle_minutes: 0,
    bottleneck_stage: "N/A",
  };

  const efficiency = data?.efficiency ?? {
    avg_stage_duration: {},
    bottleneck_stage: "N/A",
  };

  const deadline = data?.deadline ?? {
    on_time: 0,
    delayed: 0,
    measurable_total: 0,
    on_time_rate_pct: 0,
    avg_delay_minutes: 0,
    delay_by_stage: {},
  };

  const chartData = Object.entries(efficiency.avg_stage_duration).map(([stage_name, avg_minutes]) => ({
    stage_name,
    avg_minutes: Number(avg_minutes),
    avg_hours: minutesToHours(Number(avg_minutes)),
  }));

  const comparisonData = data?.comparison?.departments ?? [];
  const scopeLabel = data?.metadata?.scope_mode === "user"
    ? "Personal View"
    : data?.metadata?.scope_mode === "department"
      ? "Department View"
      : "Overall Executive View";

  return (
    <div className="space-y-6 pb-20">
      <AnalyticsFilterBar onFilterChange={setFilters} />

      <WorkflowHealth filters={filters} />

      <PredictiveInsights filters={filters} />

      <div className="rounded-[2rem] border border-border/60 bg-[linear-gradient(135deg,rgba(6,78,59,0.97),rgba(15,23,42,0.94)),radial-gradient(circle_at_top_right,rgba(56,189,248,0.35),transparent_38%)] px-6 py-8 text-white shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-slate-200/90">
              <BarChart3 className="h-3.5 w-3.5" />
              Backend-Verified Analytics
            </div>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">Analytics Overview</h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-200/80">
                Every KPI on this page is calculated on the backend from persisted workflow task records and filtered by your permitted scope.
              </p>
            </div>
          </div>
          <div className="shrink-0 rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-sm text-slate-100/90 backdrop-blur">
            <p className="font-medium">Context: {scopeLabel}</p>
            <p className="text-slate-200/70">Range: {data?.metadata?.start_date || data?.metadata?.end_date ? "Filtered" : "All recorded data"}</p>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 gap-4 animate-pulse lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-24 rounded-2xl bg-muted/60" />
          ))}
        </div>
      ) : isError ? (
        <div className="flex flex-col items-center justify-center space-y-3 py-16 text-center">
          <p className="text-base font-medium text-destructive">Failed to load analytics overview</p>
          <button onClick={() => refetch()} className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted">
            <RefreshCw className="h-4 w-4" /> Retry
          </button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <SummaryMetric
              label="On-Time Delivery"
              value={`${(deadline.on_time_rate_pct ?? 0).toFixed(2)}%`}
              sub={`${deadline.on_time} on time out of ${deadline.measurable_total ?? 0} measurable items`}
              icon={<CheckCircle2 className="h-4 w-4 text-emerald-600" />}
              accent="bg-emerald-50 dark:bg-emerald-950/40"
            />
            <SummaryMetric
              label="Delayed Items"
              value={String(summary.delayed_entries)}
              sub="completed after due time"
              icon={<AlertCircle className="h-4 w-4 text-rose-600" />}
              accent="bg-rose-50 dark:bg-rose-950/40"
            />
            <SummaryMetric
              label="Avg Delay"
              value={formatDuration(summary.avg_delay_minutes)}
              sub="per delayed item"
              icon={<TimerReset className="h-4 w-4 text-indigo-600" />}
              accent="bg-indigo-50 dark:bg-indigo-950/40"
            />
            <SummaryMetric
              label="Bottleneck"
              value={summary.bottleneck_stage}
              sub="slowest average stage"
              icon={<Clock className="h-4 w-4 text-amber-600" />}
              accent="bg-amber-50 dark:bg-amber-950/40"
            />
          </div>

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <SummaryMetric
              label="Assigned Items"
              value={String(summary.assigned_entries)}
              sub="in current filtered scope"
              icon={<Layers3 className="h-4 w-4 text-sky-600" />}
              accent="bg-sky-50 dark:bg-sky-950/40"
            />
            <SummaryMetric
              label="Completed Items"
              value={String(summary.completed_entries)}
              sub={`${summary.completion_rate_pct.toFixed(2)}% completion rate`}
              icon={<CheckCircle2 className="h-4 w-4 text-teal-600" />}
              accent="bg-teal-50 dark:bg-teal-950/40"
            />
            <SummaryMetric
              label="Active Items"
              value={String(summary.active_entries)}
              sub="open workflow load"
              icon={<Clock className="h-4 w-4 text-cyan-600" />}
              accent="bg-cyan-50 dark:bg-cyan-950/40"
            />
            <SummaryMetric
              label="Rework Rate"
              value={`${summary.rework_rate_pct.toFixed(2)}%`}
              sub={`${summary.rework_events} total rework events`}
              icon={<RefreshCw className="h-4 w-4 text-orange-600" />}
              accent="bg-orange-50 dark:bg-orange-950/40"
            />
          </div>

          {comparisonData.length > 0 && (
            <div className="rounded-2xl border border-border/60 bg-card p-6 shadow-sm">
              <div className="mb-5">
                <h2 className="text-base font-semibold text-foreground">Department Comparison</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Cross-department ranking using real workflow health, on-time delivery, and rework signals.
                </p>
              </div>
              <div className="h-[320px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={comparisonData} layout="vertical" margin={{ top: 0, right: 24, left: 8, bottom: 0 }} barSize={26}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                    <XAxis
                      type="number"
                      domain={[0, 100]}
                      tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="department_name"
                      tick={{ fontSize: 11, fill: "hsl(var(--foreground))", fontWeight: 500 }}
                      tickLine={false}
                      axisLine={false}
                      width={110}
                    />
                    <Tooltip content={<ComparisonTooltip />} cursor={{ fill: "hsl(var(--muted))", radius: 4 }} />
                    <Bar dataKey="workflow_health_score" radius={[0, 6, 6, 0]}>
                      {comparisonData.map((_, index) => (
                        <Cell key={index} fill={getBarColor(index)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-border/60 bg-card p-6 shadow-sm">
              <div className="mb-5">
                <h2 className="text-base font-semibold text-foreground">Stage Efficiency</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">Average duration per reliably tracked workflow stage (hours)</p>
              </div>
              <div className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 40 }} barSize={48}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="stage_name" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} angle={-35} textAnchor="end" interval={0} tickLine={false} axisLine={false} height={60} />
                    <YAxis tickFormatter={(value) => `${value}h`} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} width={40} />
                    <Tooltip content={<CustomTooltip />} cursor={{ fill: "hsl(var(--muted))", radius: 6 }} />
                    <Bar dataKey="avg_hours" radius={[6, 6, 0, 0]}>
                      {chartData.map((_, index) => (
                        <Cell key={index} fill={getBarColor(index)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-2xl border border-border/60 bg-card p-6 shadow-sm">
              <div className="mb-5">
                <h2 className="text-base font-semibold text-foreground">Delay by Stage</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">First reliably recorded stage whose completion crossed the due boundary.</p>
              </div>
              <div className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={Object.entries(deadline.delay_by_stage).map(([stage, count]) => ({ stage, count }))}
                    margin={{ top: 8, right: 16, left: 0, bottom: 40 }}
                    barSize={48}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="stage" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} angle={-35} textAnchor="end" interval={0} tickLine={false} axisLine={false} height={60} />
                    <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} width={30} />
                    <Tooltip cursor={{ fill: "hsl(var(--muted))", radius: 6 }} />
                    <Bar dataKey="count" fill="#fb7185" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </>
      )}

      <ReworkIntelligence data={data?.rework} filters={filters} />
      <DeadlineHonesty filters={filters} />
      <UserPerformance filters={filters} />
    </div>
  );
}
