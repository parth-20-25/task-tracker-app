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
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  Clock3,
  TrendingDown,
  AlertTriangle,
  Users,
  RefreshCw,
} from "lucide-react";

import { fetchDeadlineHonesty } from "@/api/analytics/deadlineHonestyApi";
import type {
  DeadlineHonestyPayload,
  DeadlineHonestyUserRow,
} from "@/api/analytics/deadlineHonestyApi";
import { deadlineHonestyQueryKeys } from "@/lib/queryKeys";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatMinutes(minutes: number): string {
  const sign = minutes < 0 ? "−" : "+";
  const abs = Math.abs(minutes);
  if (abs < 60) return `${sign}${Math.round(abs)}m`;
  const h = Math.floor(abs / 60);
  const m = Math.round(abs % 60);
  return m > 0 ? `${sign}${h}h ${m}m` : `${sign}${h}h`;
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

// ─── Credibility Colour Config ────────────────────────────────────────────────

function credibilityConfig(score: number) {
  if (score >= 0.8)
    return {
      label: "Controlled Planning",
      icon: <ShieldCheck className="h-6 w-6 text-emerald-500" />,
      badgeCls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
      ringCls: "ring-emerald-400",
      textCls: "text-emerald-500",
    };
  if (score >= 0.5)
    return {
      label: "Inconsistent Planning",
      icon: <ShieldAlert className="h-6 w-6 text-amber-500" />,
      badgeCls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
      ringCls: "ring-amber-400",
      textCls: "text-amber-500",
    };
  return {
    label: "Unreliable Planning",
    icon: <ShieldX className="h-6 w-6 text-rose-500" />,
    badgeCls: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
    ringCls: "ring-rose-400",
    textCls: "text-rose-500",
  };
}

// ─── Error distribution colours ───────────────────────────────────────────────

const DIST_COLORS: Record<string, string> = {
  Early: "#34d399",      // emerald — padded deadline
  "On-Target": "#6366f1", // indigo — good planning
  Late: "#f59e0b",       // amber — missed
  Severe: "#f43f5e",     // rose — badly missed
};

// ─── Custom Tooltips ─────────────────────────────────────────────────────────

function DistTooltip({ active, payload }: { active?: boolean; payload?: any[] }) {
  if (!active || !payload?.length) return null;
  const { name, value } = payload[0].payload;
  return (
    <div className="rounded-xl border border-border/60 bg-background/95 p-3 shadow-xl backdrop-blur-sm text-sm space-y-1 min-w-[140px]">
      <p className="font-semibold text-foreground border-b border-border/40 pb-1.5 mb-1.5">{name}</p>
      <p className="text-muted-foreground">
        Fixtures: <span className="font-medium text-foreground">{value}</span>
      </p>
    </div>
  );
}

function OriginTooltip({ active, payload }: { active?: boolean; payload?: any[] }) {
  if (!active || !payload?.length) return null;
  const { stage, count } = payload[0].payload;
  return (
    <div className="rounded-xl border border-border/60 bg-background/95 p-3 shadow-xl backdrop-blur-sm text-sm space-y-1 min-w-[160px]">
      <p className="font-semibold text-foreground border-b border-border/40 pb-1.5 mb-1.5">{stage}</p>
      <p className="text-muted-foreground">
        Delay origins: <span className="font-medium text-foreground">{count}</span>
      </p>
    </div>
  );
}

function UserTooltip({ active, payload }: { active?: boolean; payload?: any[] }) {
  if (!active || !payload?.length) return null;
  const row: DeadlineHonestyUserRow = payload[0].payload;
  return (
    <div className="rounded-xl border border-border/60 bg-background/95 p-3 shadow-xl backdrop-blur-sm text-sm space-y-1.5 min-w-[200px]">
      <p className="font-semibold text-foreground border-b border-border/40 pb-1.5 mb-1.5">{row.user_name}</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <span className="text-muted-foreground">Avg Error</span>
        <span className="font-medium text-foreground">{formatMinutes(row.avg_error_minutes)}</span>
        <span className="text-muted-foreground">Credibility</span>
        <span className="font-medium text-foreground">{pct(row.credibility_score)}</span>
        <span className="text-muted-foreground">Late Rate</span>
        <span className="font-medium text-foreground">{pct(row.late_rate)}</span>
      </div>
    </div>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KPICard({
  label,
  value,
  sub,
  icon,
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  icon: React.ReactNode;
  accent: string;
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-4 flex gap-3 items-start shadow-sm hover:shadow-md transition-shadow">
      <div className={`rounded-xl p-2.5 shrink-0 ${accent}`}>{icon}</div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{label}</p>
        <p className="text-xl font-bold text-foreground mt-0.5 truncate">{value}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
      </div>
    </div>
  );
}

// ─── Credibility Score Card ───────────────────────────────────────────────────

function CredibilityScoreCard({ score }: { score: number }) {
  const cfg = credibilityConfig(score);
  const pctValue = Math.round(score * 100);

  return (
    <div className={`rounded-2xl border-2 ${cfg.ringCls} bg-card p-6 shadow-sm flex flex-col items-center justify-center text-center gap-3 min-h-[200px]`}>
      <div className={`rounded-full p-4 ${cfg.badgeCls}`}>
        {cfg.icon}
      </div>

      <div>
        <p className={`text-5xl font-black tabular-nums ${cfg.textCls}`}>{pctValue}%</p>
        <p className="text-sm font-semibold text-foreground mt-1">Planning Credibility</p>
      </div>

      <span className={`text-xs font-semibold px-3 py-1 rounded-full ${cfg.badgeCls}`}>
        {cfg.label}
      </span>

      <div className="w-full mt-1">
        <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
          <span>0%</span>
          <span>50%</span>
          <span>80%</span>
          <span>100%</span>
        </div>
        <div className="relative h-2 rounded-full bg-muted overflow-hidden">
          {/* threshold marks */}
          <div className="absolute inset-y-0 left-[50%] w-px bg-amber-400/60" />
          <div className="absolute inset-y-0 left-[80%] w-px bg-emerald-400/60" />
          {/* fill */}
          <div
            className={`absolute inset-y-0 left-0 rounded-full transition-all duration-700 ${
              score >= 0.8
                ? "bg-emerald-400"
                : score >= 0.5
                ? "bg-amber-400"
                : "bg-rose-400"
            }`}
            style={{ width: `${pctValue}%` }}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Empty State ─────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center space-y-3 rounded-2xl border border-dashed border-border/60">
      <div className="rounded-full bg-muted p-4">
        <Clock3 className="h-6 w-6 text-muted-foreground" />
      </div>
      <div>
        <p className="text-sm font-medium text-foreground">No measurable fixtures yet</p>
        <p className="text-xs text-muted-foreground mt-1 max-w-xs">
          Deadline Honesty data appears once fixtures have both a set deadline and a completed 2D
          Finish stage.
        </p>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function DeadlineHonesty({ filters }: { filters: any }) {
  const { data, isLoading, isError, refetch } = useQuery<DeadlineHonestyPayload>({
    queryKey: deadlineHonestyQueryKeys.filtered(filters),
    queryFn: () => fetchDeadlineHonesty(filters),
  });

  /* ── Loading skeleton ── */
  if (isLoading) {
    return (
      <div className="space-y-6 animate-pulse mt-8 pt-8 border-t border-border/40">
        <div className="h-8 w-64 rounded-xl bg-muted/60" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-2xl bg-muted/60 h-24" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-2xl bg-muted/60 h-72" />
          <div className="rounded-2xl bg-muted/60 h-72" />
        </div>
        <div className="rounded-2xl bg-muted/60 h-72" />
      </div>
    );
  }

  /* ── Error state ── */
  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center space-y-3 mt-8 pt-8 border-t border-border/40">
        <p className="text-sm font-medium text-destructive">Failed to load deadline honesty data</p>
        <button
          id="deadline-honesty-retry-btn"
          onClick={() => refetch()}
          className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
        >
          <RefreshCw className="h-4 w-4" /> Retry
        </button>
      </div>
    );
  }

  const { summary, error_distribution, error_stats, delay_origin, by_user } = data ?? {
    summary: { total: 0, on_time: 0, delayed: 0, credibility_score: 0 },
    error_distribution: { early: 0, on_target: 0, late: 0, severe: 0 },
    error_stats: { avg_error_minutes: 0, median_error_minutes: 0, max_delay_minutes: 0 },
    delay_origin: {},
    by_user: [],
  };

  const hasData = summary.total > 0;

  /* ── Distribution chart data ── */
  const distData = [
    { name: "Early", value: error_distribution.early },
    { name: "On-Target", value: error_distribution.on_target },
    { name: "Late", value: error_distribution.late },
    { name: "Severe", value: error_distribution.severe },
  ];

  /* ── Delay origin chart data ── */
  const originData = Object.entries(delay_origin)
    .map(([stage, count]) => ({ stage, count }))
    .sort((a, b) => b.count - a.count);

  /* ── User chart data (already sorted worst→best from API) ── */
  const userData = by_user.slice(0, 10);

  return (
    <div className="space-y-6 mt-8 pt-8 border-t border-border/40">
      {/* ── Section header ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-violet-100 dark:bg-violet-900/30 p-2 shrink-0">
          <ShieldAlert className="h-5 w-5 text-violet-600 dark:text-violet-400" />
        </div>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Deadline Honesty</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Planning accuracy measured by real execution — not by status flags.
          </p>
        </div>
      </div>

      {!hasData ? (
        <EmptyState />
      ) : (
        <>
          {/* ── Row 1: KPI summary cards ──────────────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KPICard
              label="On-Time Fixtures"
              value={String(summary.on_time)}
              sub={`of ${summary.total} measured`}
              icon={<ShieldCheck className="h-4 w-4 text-emerald-600" />}
              accent="bg-emerald-50 dark:bg-emerald-950/40"
            />
            <KPICard
              label="Delayed Fixtures"
              value={String(summary.delayed)}
              sub="crossed final deadline"
              icon={<AlertTriangle className="h-4 w-4 text-rose-600" />}
              accent="bg-rose-50 dark:bg-rose-950/40"
            />
            <KPICard
              label="Avg Planning Error"
              value={formatMinutes(error_stats.avg_error_minutes)}
              sub={`median ${formatMinutes(error_stats.median_error_minutes)}`}
              icon={<TrendingDown className="h-4 w-4 text-indigo-600" />}
              accent="bg-indigo-50 dark:bg-indigo-950/40"
            />
            <KPICard
              label="Worst Single Delay"
              value={formatMinutes(error_stats.max_delay_minutes)}
              sub="max overrun recorded"
              icon={<Clock3 className="h-4 w-4 text-amber-600" />}
              accent="bg-amber-50 dark:bg-amber-950/40"
            />
          </div>

          {/* ── Row 2: Credibility score + Distribution chart ─────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

            {/* Chart 1 — Credibility Score KPI */}
            <CredibilityScoreCard score={summary.credibility_score} />

            {/* Chart 2 — Planning Accuracy Distribution */}
            <div
              id="planning-distribution-chart-card"
              className="rounded-2xl border border-border/60 bg-card p-6 shadow-sm"
            >
              <div className="mb-5">
                <h3 className="text-base font-semibold text-foreground">
                  Planning Accuracy Distribution
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Fixture count per error bucket (tolerance = ±2 h)
                </p>
              </div>

              {/* Legend */}
              <div className="flex flex-wrap gap-3 mb-4">
                {Object.entries(DIST_COLORS).map(([label, color]) => (
                  <span key={label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
                    {label}
                  </span>
                ))}
              </div>

              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={distData}
                    margin={{ top: 8, right: 12, left: 0, bottom: 8 }}
                    barSize={52}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                      tickLine={false}
                      axisLine={false}
                      width={30}
                    />
                    <Tooltip content={<DistTooltip />} cursor={{ fill: "hsl(var(--muted))", radius: 6 }} />
                    <Bar dataKey="value" radius={[6, 6, 0, 0]} isAnimationActive>
                      {distData.map((entry) => (
                        <Cell
                          key={entry.name}
                          fill={DIST_COLORS[entry.name] ?? "#6366f1"}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Interpretation hint */}
              <p className="text-[11px] text-muted-foreground mt-3 italic text-center">
                {error_distribution.early > error_distribution.late + error_distribution.severe
                  ? "Most fixtures finish early — deadlines may be padded."
                  : error_distribution.severe > 0 || error_distribution.late > 0
                  ? "Multiple fixtures exceeded deadlines — planning needs tightening."
                  : "Distribution looks balanced."}
              </p>
            </div>
          </div>

          {/* ── Row 3: Delay origin + Designer behaviour ─────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

            {/* Chart 3 — Delay Origin Stage */}
            <div
              id="delay-origin-chart-card"
              className="rounded-2xl border border-border/60 bg-card p-6 shadow-sm"
            >
              <div className="mb-5">
                <h3 className="text-base font-semibold text-foreground">Delay Origin Stage</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  First stage whose completion crossed the deadline — root cause accountability
                </p>
              </div>

              {originData.length === 0 ? (
                <div className="flex items-center justify-center h-[220px] text-sm text-muted-foreground">
                  No delayed fixtures with identifiable origin stage.
                </div>
              ) : (
                <div className="h-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={originData}
                      layout="vertical"
                      margin={{ top: 0, right: 24, left: 8, bottom: 0 }}
                      barSize={28}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                      <XAxis
                        type="number"
                        allowDecimals={false}
                        tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        dataKey="stage"
                        type="category"
                        tick={{ fontSize: 11, fill: "hsl(var(--foreground))", fontWeight: 500 }}
                        tickLine={false}
                        axisLine={false}
                        width={80}
                      />
                      <Tooltip content={<OriginTooltip />} cursor={{ fill: "hsl(var(--muted))", radius: 4 }} />
                      <Bar dataKey="count" radius={[0, 6, 6, 0]} isAnimationActive>
                        {originData.map((_, index) => {
                          const originColors = ["#f43f5e", "#f59e0b", "#6366f1", "#34d399"];
                          return <Cell key={index} fill={originColors[index % originColors.length]} />;
                        })}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            {/* Chart 4 — User Planning Behaviour */}
            <div
              id="user-planning-chart-card"
              className="rounded-2xl border border-border/60 bg-card p-6 shadow-sm"
            >
              <div className="mb-5 flex items-start justify-between">
                <div>
                  <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    User Planning Behaviour
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Avg error per user — sorted worst → best
                  </p>
                </div>
              </div>

              {userData.length === 0 ? (
                <div className="flex items-center justify-center h-[220px] text-sm text-muted-foreground">
                  No per-user data available.
                </div>
              ) : (
                <div className="h-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={userData}
                      layout="vertical"
                      margin={{ top: 0, right: 24, left: 8, bottom: 0 }}
                      barSize={22}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                      {/* Reference line at 0 (the deadline) */}
                      <XAxis
                        type="number"
                        tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v) => {
                          const h = Math.round(Math.abs(v) / 60);
                          return v < 0 ? `−${h}h` : `+${h}h`;
                        }}
                      />
                      <YAxis
                        dataKey="user_name"
                        type="category"
                        tick={{ fontSize: 11, fill: "hsl(var(--foreground))", fontWeight: 500 }}
                        tickLine={false}
                        axisLine={false}
                        width={90}
                      />
                      <Tooltip content={<UserTooltip />} cursor={{ fill: "hsl(var(--muted))", radius: 4 }} />
                      <Bar dataKey="avg_error_minutes" radius={[0, 4, 4, 0]} isAnimationActive>
                        {userData.map((row) => (
                          <Cell
                            key={row.user_name}
                            fill={
                              row.avg_error_minutes > SEVERE_THRESHOLD
                                ? "#f43f5e"
                                : row.avg_error_minutes > LATE_THRESHOLD
                                ? "#f59e0b"
                                : row.avg_error_minutes <= -LATE_THRESHOLD
                                ? "#34d399"
                                : "#6366f1"
                            }
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Legend */}
              <div className="flex flex-wrap gap-3 mt-3">
                {[
                  { color: "#34d399", label: "Early (padded)" },
                  { color: "#6366f1", label: "On-target" },
                  { color: "#f59e0b", label: "Late" },
                  { color: "#f43f5e", label: "Severely late" },
                ].map(({ color, label }) => (
                  <span key={label} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
                    {label}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// Thresholds exposed to Cell coloring
const LATE_THRESHOLD = 120;
const SEVERE_THRESHOLD = 1440;
