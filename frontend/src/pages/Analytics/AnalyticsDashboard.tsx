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
import { BarChart3, Clock, RefreshCw, CheckCircle2, AlertCircle } from "lucide-react";

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

// ─── Helpers ────────────────────────────────────────────────────────────────

function minutesToHours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// ─── Bar colors ──────────────────────────────────────────────────────────────

const GRADIENT_COLORS = [
  "#6366f1",
  "#818cf8",
  "#a78bfa",
  "#c084fc",
  "#e879f9",
  "#fb7185",
  "#f97316",
  "#facc15",
];

function getBarColor(index: number): string {
  return GRADIENT_COLORS[index % GRADIENT_COLORS.length];
}

// ─── Custom Tooltip ──────────────────────────────────────────────────────────

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
    <div className="rounded-xl border border-border/60 bg-background/95 p-3 shadow-xl backdrop-blur-sm text-sm space-y-1.5 min-w-[180px]">
      <p className="font-semibold text-foreground border-b border-border/40 pb-1.5 mb-2">{row.stage_name}</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <span className="text-muted-foreground">Avg</span>
        <span className="font-medium text-foreground">{formatDuration(row.avg_minutes)}</span>
      </div>
    </div>
  );
}

// ─── Summary metrics ─────────────────────────────────────────────────────────

interface SummaryMetricProps {
  label: string;
  value: string;
  sub: string;
  icon: React.ReactNode;
  accent: string;
}

function SummaryMetric({ label, value, sub, icon, accent }: SummaryMetricProps) {
  return (
    <div className={`rounded-2xl border border-border/60 bg-card p-4 flex gap-3 items-start shadow-sm hover:shadow-md transition-shadow`}>
      <div className={`rounded-xl p-2.5 ${accent}`}>{icon}</div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{label}</p>
        <p className="text-xl font-bold text-foreground mt-0.5 truncate">{value}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

const DEFAULT_EFFICIENCY: AnalyticsOverviewPayload["efficiency"] = {
  avg_stage_duration: {},
  bottleneck_stage: "N/A",
};

const DEFAULT_DEADLINE: AnalyticsOverviewPayload["deadline"] = {
  on_time: 0,
  delayed: 0,
  avg_delay_minutes: 0,
  delay_by_stage: {},
};

export default function AnalyticsDashboard() {
  const [filters, setFilters] = useState<AnalyticsFilters>({});

  const { data, isLoading, isError, refetch } = useQuery<AnalyticsOverviewPayload>({
    queryKey: analyticsOverviewQueryKeys.filtered(filters),
    queryFn: () => fetchAnalyticsOverview(filters),
  });

  const efficiency = {
    ...DEFAULT_EFFICIENCY,
    ...(data?.efficiency ?? {}),
    avg_stage_duration: data?.efficiency?.avg_stage_duration ?? DEFAULT_EFFICIENCY.avg_stage_duration,
  };

  const deadline = {
    ...DEFAULT_DEADLINE,
    ...(data?.deadline ?? {}),
    delay_by_stage: data?.deadline?.delay_by_stage ?? DEFAULT_DEADLINE.delay_by_stage,
  };

  const stages = Object.entries(efficiency.avg_stage_duration).map(([name, avg]) => ({
    stage_name: name,
    avg_minutes: avg as number,
  }));

  const chartData = stages.map((row) => ({
    ...row,
    avg_hours: minutesToHours(row.avg_minutes),
  }));

  return (
    <div className="space-y-6 pb-20">
      <AnalyticsFilterBar onFilterChange={setFilters} />

      <WorkflowHealth filters={filters} />

      <PredictiveInsights filters={filters} />

      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="rounded-[2rem] border border-border/60 bg-[linear-gradient(135deg,rgba(15,23,42,0.97),rgba(30,41,59,0.92)),radial-gradient(circle_at_top_right,rgba(99,102,241,0.4),transparent_38%)] px-6 py-8 text-white shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-slate-200/90">
              <BarChart3 className="h-3.5 w-3.5" />
              Unified Analytics
            </div>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">Analytics Overview</h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-200/80">
                Department-agnostic performance insights derived from real-time workflow data.
              </p>
            </div>
          </div>
          <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-sm text-slate-100/90 backdrop-blur shrink-0">
            <p className="font-medium">Context: {filters.userId === 'self' ? 'My Analytics' : filters.departmentId ? 'Department' : 'Overall'}</p>
            <p className="text-slate-200/70">Sync status: Active</p>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 animate-pulse">
           {Array.from({ length: 4 }).map((_, i) => (
             <div key={i} className="rounded-2xl bg-muted/60 h-24" />
           ))}
        </div>
      ) : isError ? (
        <div className="flex flex-col items-center justify-center py-16 text-center space-y-3">
          <p className="text-base font-medium text-destructive">Failed to load analytics overview</p>
          <button onClick={() => refetch()} className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors">
            <RefreshCw className="h-4 w-4" /> Retry
          </button>
        </div>
      ) : (
        <>
          {/* ── KPI Grid ────────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <SummaryMetric
              label="On-Time Delivery"
              value={`${Math.round((deadline.on_time / (deadline.on_time + deadline.delayed || 1)) * 100)}%`}
              sub={`${deadline.on_time} fixtures on time`}
              icon={<CheckCircle2 className="h-4 w-4 text-emerald-600" />}
              accent="bg-emerald-50 dark:bg-emerald-950/40"
            />
            <SummaryMetric
              label="Delayed Fixtures"
              value={String(deadline.delayed)}
              sub="crossed final deadline"
              icon={<AlertCircle className="h-4 w-4 text-rose-600" />}
              accent="bg-rose-50 dark:bg-rose-950/40"
            />
            <SummaryMetric
              label="Avg Delay"
              value={formatDuration(deadline.avg_delay_minutes)}
              sub="per delayed fixture"
              icon={<Clock className="h-4 w-4 text-indigo-600" />}
              accent="bg-indigo-50 dark:bg-indigo-950/40"
            />
            <SummaryMetric
              label="Bottleneck"
              value={efficiency.bottleneck_stage}
              sub="longest avg duration"
              icon={<Clock className="h-4 w-4 text-amber-600" />}
              accent="bg-amber-50 dark:bg-amber-950/40"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* ── Stage Efficiency Bar chart ────────────────────────────────────────────────────── */}
            <div className="rounded-2xl border border-border/60 bg-card p-6 shadow-sm">
              <div className="mb-5">
                <h2 className="text-base font-semibold text-foreground">Stage Efficiency</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Average duration per workflow stage (hours)</p>
              </div>
              <div className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 40 }} barSize={48}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="stage_name" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} angle={-35} textAnchor="end" interval={0} tickLine={false} axisLine={false} height={60} />
                    <YAxis tickFormatter={(v) => `${v}h`} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} width={40} />
                    <Tooltip content={<CustomTooltip />} cursor={{ fill: "hsl(var(--muted))", radius: 6 }} />
                    <Bar dataKey="avg_hours" radius={[6, 6, 0, 0]} isAnimationActive>
                      {chartData.map((_, index) => (
                        <Cell key={index} fill={getBarColor(index)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* ── Delay Origin Bar chart ────────────────────────────────────────────────────── */}
            <div className="rounded-2xl border border-border/60 bg-card p-6 shadow-sm">
              <div className="mb-5">
                <h2 className="text-base font-semibold text-foreground">Delay by Stage</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Which stage completion crossed the final deadline</p>
              </div>
              <div className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={Object.entries(deadline.delay_by_stage).map(([stage, count]) => ({ stage, count }))} margin={{ top: 8, right: 16, left: 0, bottom: 40 }} barSize={48} >
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
