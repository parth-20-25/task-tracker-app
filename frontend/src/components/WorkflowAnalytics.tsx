import { Fragment, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { format, parseISO } from "date-fns";
import {
  Activity,
  BarChart3,
  Clock3,
  Gauge,
  Layers3,
  TimerReset,
  TrendingUp,
  Users2,
} from "lucide-react";

import { apiRequest } from "@/api/http";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type ThroughputPoint = {
  date: string;
  completed: number;
};

type WipPoint = {
  date: string;
  count: number;
};

type ThroughputAndWIP = {
  throughput: ThroughputPoint[];
  wip: WipPoint[];
  avgCompletionTime: number;
};

type StageMeta = {
  key: string;
  label: string;
  order: number;
};

type ReworkPoint = {
  stage: string;
  count: number;
};

type ReworkAnalysis = {
  totalReworks: number;
  reworkPerStage: ReworkPoint[];
};

type StageEfficiencyRow = {
  stage: string;
  avgTime: number;
  delayRate: number;
  activeTime: number;
  delayTime: number;
  attempts: number;
};

type DesignerPerformanceRow = {
  name: string;
  completed: number;
  avgTime: number;
  reworks: number;
  overdueRate: number;
};

type WorkflowHealthScore = {
  score: number;
  breakdown: {
    throughputScore: number;
    reworkPenalty: number;
    delayPenalty: number;
    consistencyScore: number;
  };
};

type HeatmapRow = {
  name: string;
  total: number;
  values: Array<{
    hour: number;
    value: number;
  }>;
};

type HeatmapData = {
  hours: number[];
  maxValue: number;
  designers: HeatmapRow[];
};

type TimelineSegment = {
  stage: string;
  stageKey: string;
  status: string;
  start: string;
  end: string;
  durationHours: number;
};

type TimelineFixture = {
  fixtureId: string;
  fixtureNo: string;
  start: string;
  end: string;
  totalHours: number;
  segments: TimelineSegment[];
};

type WorkflowTimeline = {
  rangeStart: string | null;
  rangeEnd: string | null;
  fixtures: TimelineFixture[];
};

type WorkflowAnalyticsOverview = {
  throughputAndWIP: ThroughputAndWIP;
  cumulativeFlow: Array<Record<string, string | number>>;
  reworkAnalysis: ReworkAnalysis;
  stageEfficiency: StageEfficiencyRow[];
  designerPerformance: DesignerPerformanceRow[];
  workflowHealthScore: WorkflowHealthScore;
  onTimePercent: number;
  overdueCount: number;
  stageMeta: StageMeta[];
  heatmap: HeatmapData;
  workflowTimeline: WorkflowTimeline;
  summary: {
    throughput: number;
    wip: number;
    avgCompletionTime: number;
    onTimePercent: number;
    reworkCount: number;
  };
  generatedAt: string;
};

const CHART_HEIGHT = 320;
const GRID_STROKE = "hsl(var(--border))";
const TOOLTIP_STYLE = {
  backgroundColor: "hsl(var(--background))",
  borderColor: "hsl(var(--border))",
  borderRadius: "14px",
  boxShadow: "0 18px 40px rgba(15, 23, 42, 0.16)",
};
const FLOW_COLORS = ["#0f4c81", "#2563eb", "#0ea5e9", "#06b6d4", "#38bdf8", "#1d4ed8", "#155e75", "#60a5fa"];
const DONE_COLOR = "#16a34a";
const REWORK_COLOR = "#dc2626";
const ACTIVE_COLOR = "#10b981";
const DELAY_COLOR = "#f59e0b";

function formatDateLabel(value: string) {
  return format(parseISO(value), "MMM d");
}

function formatShortDateTime(value: string) {
  return format(parseISO(value), "MMM d, HH:mm");
}

function formatHours(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "0h";
  }

  if (value >= 24) {
    const days = Math.floor(value / 24);
    const hours = Math.round(value % 24);
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }

  return `${value.toFixed(1)}h`;
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "0%";
  }

  return `${value.toFixed(1)}%`;
}

function shortStageLabel(value: string) {
  return value.length > 14 ? `${value.slice(0, 14)}…` : value;
}

function heatColor(value: number, maxValue: number) {
  if (!value || maxValue <= 0) {
    return "rgba(14, 165, 233, 0.08)";
  }

  const opacity = 0.16 + ((value / maxValue) * 0.72);
  return `rgba(14, 165, 233, ${Math.min(opacity, 0.92).toFixed(2)})`;
}

function scoreTone(score: number) {
  if (score >= 75) {
    return "text-emerald-600 dark:text-emerald-400";
  }

  if (score >= 50) {
    return "text-amber-500 dark:text-amber-300";
  }

  return "text-rose-600 dark:text-rose-400";
}

function healthShellTone(score: number) {
  if (score >= 75) {
    return "border-emerald-200 bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.18),_transparent_45%),linear-gradient(135deg,rgba(255,255,255,0.98),rgba(236,253,245,0.92))] dark:border-emerald-900/60 dark:bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.22),_transparent_40%),linear-gradient(135deg,rgba(2,6,23,0.98),rgba(6,78,59,0.4))]";
  }

  if (score >= 50) {
    return "border-amber-200 bg-[radial-gradient(circle_at_top,_rgba(245,158,11,0.18),_transparent_45%),linear-gradient(135deg,rgba(255,255,255,0.98),rgba(255,251,235,0.94))] dark:border-amber-900/60 dark:bg-[radial-gradient(circle_at_top,_rgba(245,158,11,0.2),_transparent_40%),linear-gradient(135deg,rgba(2,6,23,0.98),rgba(120,53,15,0.42))]";
  }

  return "border-rose-200 bg-[radial-gradient(circle_at_top,_rgba(220,38,38,0.16),_transparent_45%),linear-gradient(135deg,rgba(255,255,255,0.98),rgba(255,241,242,0.94))] dark:border-rose-900/60 dark:bg-[radial-gradient(circle_at_top,_rgba(220,38,38,0.18),_transparent_40%),linear-gradient(135deg,rgba(2,6,23,0.98),rgba(127,29,29,0.42))]";
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex h-[220px] items-center justify-center rounded-3xl border border-dashed border-border/50 bg-muted/20 px-6 text-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}

function SectionCard({
  title,
  question,
  icon: Icon,
  children,
}: {
  title: string;
  question: string;
  icon: typeof Activity;
  children: ReactNode;
}) {
  return (
    <Card className="border-border/50 shadow-sm">
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0 px-5 pt-5 pb-2">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="rounded-2xl bg-muted/50 p-2">
              <Icon className="h-4 w-4 text-muted-foreground" />
            </div>
            <h3 className="text-base font-semibold tracking-tight">{title}</h3>
          </div>
          <p className="text-sm text-muted-foreground">{question}</p>
        </div>
      </CardHeader>
      <CardContent className="px-5 pb-5 pt-3">{children}</CardContent>
    </Card>
  );
}

function KpiCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint: string;
  accent: string;
}) {
  return (
    <Card className="border-border/50 shadow-sm">
      <CardContent className="p-4">
        <div className="space-y-3">
          <div className={cn("h-1.5 w-14 rounded-full", accent)} />
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground/70">{label}</p>
            <p className="text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
          </div>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function HealthScoreCard({ health }: { health: WorkflowHealthScore }) {
  const tone = scoreTone(health.score);

  return (
    <Card className={cn("overflow-hidden border shadow-sm", healthShellTone(health.score))}>
      <CardContent className="p-6">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <div className="flex flex-col items-center justify-center rounded-[2rem] border border-white/60 bg-white/70 px-6 py-8 text-center backdrop-blur dark:border-white/10 dark:bg-slate-950/35">
            <div className="mb-4 rounded-3xl bg-background/80 p-4 shadow-sm">
              <Gauge className={cn("h-8 w-8", tone)} />
            </div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-muted-foreground/70">
              Workflow Health Score
            </p>
            <div className="mt-3 flex items-end gap-2">
              <p className={cn("text-7xl font-semibold tracking-tight tabular-nums", tone)}>{health.score}</p>
              <p className="pb-2 text-sm text-muted-foreground">/ 100</p>
            </div>
            <p className="mt-3 max-w-md text-sm text-muted-foreground">
              Decision signal for whether the workflow can absorb more load without increasing delay, instability, or rework.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-3xl border border-white/60 bg-white/70 p-4 backdrop-blur dark:border-white/10 dark:bg-slate-950/35">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground/70">Throughput Score</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-sky-700 dark:text-sky-300">
                {health.breakdown.throughputScore.toFixed(1)}
              </p>
            </div>
            <div className="rounded-3xl border border-white/60 bg-white/70 p-4 backdrop-blur dark:border-white/10 dark:bg-slate-950/35">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground/70">Consistency Score</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-sky-700 dark:text-sky-300">
                {health.breakdown.consistencyScore.toFixed(1)}
              </p>
            </div>
            <div className="rounded-3xl border border-white/60 bg-white/70 p-4 backdrop-blur dark:border-white/10 dark:bg-slate-950/35">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground/70">Rework Penalty</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-rose-600 dark:text-rose-300">
                {health.breakdown.reworkPenalty.toFixed(1)}
              </p>
            </div>
            <div className="rounded-3xl border border-white/60 bg-white/70 p-4 backdrop-blur dark:border-white/10 dark:bg-slate-950/35">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground/70">Delay Penalty</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-amber-600 dark:text-amber-300">
                {health.breakdown.delayPenalty.toFixed(1)}
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function WorkflowAnalyticsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,2.2fr)_repeat(5,minmax(0,1fr))]">
        <Skeleton className="h-[280px] rounded-[2rem] xl:col-span-1" />
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} className="h-[170px] rounded-[2rem]" />
        ))}
      </div>
      <Skeleton className="h-[420px] rounded-[2rem]" />
      <div className="grid gap-4 xl:grid-cols-2">
        <Skeleton className="h-[380px] rounded-[2rem]" />
        <Skeleton className="h-[380px] rounded-[2rem]" />
      </div>
      <Skeleton className="h-[380px] rounded-[2rem]" />
      <Skeleton className="h-[360px] rounded-[2rem]" />
      <Skeleton className="h-[420px] rounded-[2rem]" />
    </div>
  );
}

function TimelineChart({
  timeline,
  stageColors,
}: {
  timeline: WorkflowTimeline;
  stageColors: Record<string, string>;
}) {
  if (!timeline.rangeStart || !timeline.rangeEnd || timeline.fixtures.length === 0) {
    return <EmptyState message="No fixture stage history is available for the workflow timeline yet." />;
  }

  const rangeStart = parseISO(timeline.rangeStart);
  const rangeEnd = parseISO(timeline.rangeEnd);
  const totalRangeMs = Math.max(rangeEnd.getTime() - rangeStart.getTime(), 1);
  const ticks = Array.from({ length: 5 }, (_, index) => {
    const ratio = index / 4;
    return new Date(rangeStart.getTime() + (totalRangeMs * ratio));
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-[180px_minmax(0,1fr)] gap-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/70">
        <div>Fixture</div>
        <div className="grid grid-cols-5 gap-2">
          {ticks.map((tick) => (
            <div key={tick.toISOString()} className="text-center">
              {format(tick, "MMM d")}
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        {timeline.fixtures.map((fixture) => (
          <div key={fixture.fixtureId} className="grid grid-cols-[180px_minmax(0,1fr)] gap-3">
            <div className="rounded-2xl border border-border/50 bg-muted/25 px-3 py-3">
              <p className="text-sm font-semibold tracking-tight">{fixture.fixtureNo}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatHours(fixture.totalHours)} total cycle time
              </p>
            </div>

            <div className="relative rounded-2xl border border-border/50 bg-muted/15 px-3 py-3">
              <div className="absolute inset-y-0 left-3 right-3 grid grid-cols-5 gap-0">
                {ticks.map((tick) => (
                  <div key={tick.toISOString()} className="border-l border-dashed border-border/50 first:border-l-0" />
                ))}
              </div>

              <div className="relative h-[74px]">
                {fixture.segments.map((segment) => {
                  const start = parseISO(segment.start);
                  const end = parseISO(segment.end);
                  const left = ((start.getTime() - rangeStart.getTime()) / totalRangeMs) * 100;
                  const width = Math.max(((end.getTime() - start.getTime()) / totalRangeMs) * 100, 1.6);

                  return (
                    <div
                      key={`${fixture.fixtureId}-${segment.stageKey}-${segment.start}`}
                      className="absolute top-5 flex h-10 items-center rounded-xl px-3 text-[11px] font-semibold text-white shadow-sm"
                      style={{
                        left: `${Math.max(left, 0)}%`,
                        width: `${Math.min(width, 100 - left)}%`,
                        backgroundColor: stageColors[segment.stageKey] || FLOW_COLORS[0],
                      }}
                      title={`${segment.stage}: ${formatShortDateTime(segment.start)} → ${formatShortDateTime(segment.end)}`}
                    >
                      <span className="truncate">{segment.stage}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function WorkflowAnalytics() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["workflow-analytics-overview-v2"],
    queryFn: () => apiRequest<WorkflowAnalyticsOverview>("/analytics/workflow/overview"),
  });

  if (isLoading) {
    return <WorkflowAnalyticsSkeleton />;
  }

  if (error || !data) {
    const message = error instanceof Error ? error.message : "Failed to load workflow analytics.";

    return (
      <Card className="border-rose-200 bg-rose-50/80 shadow-sm dark:border-rose-900/50 dark:bg-rose-950/20">
        <CardContent className="p-5 text-sm text-rose-700 dark:text-rose-300">{message}</CardContent>
      </Card>
    );
  }

  const stageColors = Object.fromEntries(
    data.stageMeta.map((stage, index) => [stage.key, FLOW_COLORS[index % FLOW_COLORS.length]]),
  ) as Record<string, string>;
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">Workflow Analytics</h1>
        <p className="text-sm text-muted-foreground">
          Exact operational flow metrics from live workflow progress, approvals, deadlines, and stage attempts.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2.2fr)_repeat(5,minmax(0,1fr))]">
        <HealthScoreCard health={data.workflowHealthScore} />
        <KpiCard
          label="Throughput"
          value={`${data.summary.throughput.toFixed(1)}/day`}
          hint="Trailing 7-day average of fully approved fixtures."
          accent="bg-sky-500"
        />
        <KpiCard
          label="WIP"
          value={String(data.summary.wip)}
          hint="Fixtures still active in at least one stage today."
          accent="bg-sky-500"
        />
        <KpiCard
          label="Avg Completion Time"
          value={formatHours(data.summary.avgCompletionTime)}
          hint="From first stage assignment to final approval."
          accent="bg-sky-500"
        />
        <KpiCard
          label="On-Time %"
          value={formatPercent(data.summary.onTimePercent)}
          hint={`${data.overdueCount} workflows are currently overdue.`}
          accent="bg-orange-500"
        />
        <KpiCard
          label="Rework Count"
          value={String(data.summary.reworkCount)}
          hint="Rejected stage attempts across the workflow history."
          accent="bg-rose-500"
        />
      </div>

      <SectionCard
        title="Cumulative Flow Diagram"
        question="Where is work piling up, and is completed output accelerating or flattening over time?"
        icon={Layers3}
      >
        {data.cumulativeFlow.length > 0 && data.stageMeta.length > 0 ? (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {data.stageMeta.map((stage) => (
                <div key={stage.key} className="inline-flex items-center gap-2 rounded-full border border-border/50 px-3 py-1 text-xs text-muted-foreground">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: stageColors[stage.key] }} />
                  {stage.label}
                </div>
              ))}
              <div className="inline-flex items-center gap-2 rounded-full border border-border/50 px-3 py-1 text-xs text-muted-foreground">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: DONE_COLOR }} />
                Done
              </div>
            </div>

            <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
              <AreaChart data={data.cumulativeFlow} margin={{ top: 12, right: 12, left: 0, bottom: 4 }}>
                <defs>
                  {data.stageMeta.map((stage) => (
                    <linearGradient key={stage.key} id={`cfd-${stage.key}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={stageColors[stage.key]} stopOpacity={0.55} />
                      <stop offset="95%" stopColor={stageColors[stage.key]} stopOpacity={0.08} />
                    </linearGradient>
                  ))}
                  <linearGradient id="cfd-done" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={DONE_COLOR} stopOpacity={0.5} />
                    <stop offset="95%" stopColor={DONE_COLOR} stopOpacity={0.1} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 4" opacity={0.4} />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={formatDateLabel} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={36} />
                <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={formatDateLabel} />
                {data.stageMeta.map((stage) => (
                  <Area
                    key={stage.key}
                    type="monotone"
                    dataKey={stage.key}
                    stackId="workflow"
                    stroke={stageColors[stage.key]}
                    fill={`url(#cfd-${stage.key})`}
                    strokeWidth={2}
                  />
                ))}
                <Area
                  type="monotone"
                  dataKey="done"
                  stackId="workflow"
                  stroke={DONE_COLOR}
                  fill="url(#cfd-done)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <EmptyState message="No daily workflow stage history is available for the cumulative flow diagram yet." />
        )}
      </SectionCard>

      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard
          title="Rework by Stage"
          question="Which stage is creating the most rejected work that needs to be revisited?"
          icon={TimerReset}
        >
          {data.reworkAnalysis.reworkPerStage.length > 0 ? (
            <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
              <BarChart data={data.reworkAnalysis.reworkPerStage} margin={{ top: 10, right: 12, left: 0, bottom: 26 }}>
                <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 4" opacity={0.4} />
                <XAxis
                  dataKey="stage"
                  tick={{ fontSize: 11 }}
                  tickFormatter={shortStageLabel}
                  tickLine={false}
                  axisLine={false}
                  interval={0}
                  angle={-18}
                  textAnchor="end"
                  height={58}
                />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={36} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Bar dataKey="count" fill={REWORK_COLOR} radius={[10, 10, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState message="No rejected stage attempts have been recorded yet." />
          )}
        </SectionCard>

        <SectionCard
          title="Stage Efficiency"
          question="Which stages are spending the most time inside expected work versus delay beyond the stage target?"
          icon={Gauge}
        >
          {data.stageEfficiency.length > 0 ? (
            <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
              <BarChart data={data.stageEfficiency} margin={{ top: 10, right: 12, left: 0, bottom: 26 }}>
                <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 4" opacity={0.4} />
                <XAxis
                  dataKey="stage"
                  tick={{ fontSize: 11 }}
                  tickFormatter={shortStageLabel}
                  tickLine={false}
                  axisLine={false}
                  interval={0}
                  angle={-18}
                  textAnchor="end"
                  height={58}
                />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={36} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(value, name, props) => {
                    const row = props.payload as StageEfficiencyRow;
                    if (name === "activeTime") {
                      return [`${formatHours(Number(value))}`, "Active time"];
                    }
                    if (name === "delayTime") {
                      return [`${formatHours(Number(value))}`, "Delay time"];
                    }
                    return [value, name];
                  }}
                  labelFormatter={(label) => `${label}`}
                />
                <Bar dataKey="activeTime" stackId="efficiency" fill={ACTIVE_COLOR} radius={[10, 10, 0, 0]} />
                <Bar dataKey="delayTime" stackId="efficiency" fill={DELAY_COLOR} radius={[10, 10, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState message="No completed stage durations are available for efficiency analysis yet." />
          )}
        </SectionCard>
      </div>

      <SectionCard
        title="Throughput Trend"
        question="Is completed output rising, stable, or slipping as the workflow moves day by day?"
        icon={TrendingUp}
      >
        {data.throughputAndWIP.throughput.length > 0 ? (
          <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
            <LineChart data={data.throughputAndWIP.throughput} margin={{ top: 12, right: 12, left: 0, bottom: 4 }}>
              <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 4" opacity={0.4} />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={formatDateLabel} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={36} />
              <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={formatDateLabel} />
              <Line
                type="monotone"
                dataKey="completed"
                stroke="#2563eb"
                strokeWidth={3}
                dot={{ r: 2.5, fill: "#2563eb" }}
                activeDot={{ r: 5, fill: "#1d4ed8" }}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <EmptyState message="No fully approved fixtures are available yet for throughput analysis." />
        )}
      </SectionCard>

      <SectionCard
        title="Designer Performance"
        question="Who is closing the most workflow steps, and where are speed and overdue risk diverging by designer?"
        icon={Users2}
      >
        {data.designerPerformance.length > 0 ? (
          <ResponsiveContainer width="100%" height={CHART_HEIGHT + 40}>
            <BarChart
              data={data.designerPerformance}
              layout="vertical"
              margin={{ top: 10, right: 18, left: 30, bottom: 4 }}
            >
              <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 4" opacity={0.35} horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis
                type="category"
                dataKey="name"
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={128}
              />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                formatter={(value, name, props) => {
                  const row = props.payload as DesignerPerformanceRow;
                  if (name !== "completed") {
                    return [value, name];
                  }

                  return [
                    `${value} completed • ${formatHours(row.avgTime)} avg • ${row.reworks} reworks • ${formatPercent(row.overdueRate)} overdue`,
                    "Designer",
                  ];
                }}
              />
              <Bar dataKey="completed" fill="#16a34a" radius={[0, 10, 10, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <EmptyState message="No designer workflow activity is available yet." />
        )}
      </SectionCard>

      <SectionCard
        title="Designer Activity Heatmap"
        question="At what hours are designers actually completing the most workflow work, and who is driving that output?"
        icon={BarChart3}
      >
        {data.heatmap.designers.length > 0 ? (
          <div className="space-y-3 overflow-x-auto">
            <div className="grid min-w-[940px] grid-cols-[180px_repeat(24,minmax(0,1fr))] gap-2">
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/70">Designer</div>
              {data.heatmap.hours.map((hour) => (
                <div key={hour} className="text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
                  {hour.toString().padStart(2, "0")}
                </div>
              ))}

              {data.heatmap.designers.map((designer) => (
                <Fragment key={designer.name}>
                  <div key={`${designer.name}-label`} className="flex items-center rounded-2xl border border-border/50 bg-muted/20 px-3 py-2 text-sm font-medium">
                    <div>
                      <p>{designer.name}</p>
                      <p className="text-xs text-muted-foreground">{designer.total} completions</p>
                    </div>
                  </div>
                  {designer.values.map((entry) => (
                    <div
                      key={`${designer.name}-${entry.hour}`}
                      className="flex h-11 items-center justify-center rounded-xl border border-border/40 text-xs font-semibold tabular-nums text-slate-900 dark:text-slate-100"
                      style={{ backgroundColor: heatColor(entry.value, data.heatmap.maxValue) }}
                      title={`${designer.name} • ${entry.hour.toString().padStart(2, "0")}:00 • ${entry.value} completions`}
                    >
                      {entry.value > 0 ? entry.value : ""}
                    </div>
                  ))}
                </Fragment>
              ))}
            </div>
          </div>
        ) : (
          <EmptyState message="No approved or completed attempts are available yet for the activity heatmap." />
        )}
      </SectionCard>

      <SectionCard
        title="Workflow Timeline"
        question="Which fixtures are stretching across the most time, and exactly where is that time being spent stage by stage?"
        icon={Clock3}
      >
        <TimelineChart timeline={data.workflowTimeline} stageColors={stageColors} />
      </SectionCard>
    </div>
  );
}
