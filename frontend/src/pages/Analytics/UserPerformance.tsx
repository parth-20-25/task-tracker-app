import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import {
  Trophy,
  AlertTriangle,
  Zap,
  UserCheck,
  RefreshCw,
  TrendingUp,
} from "lucide-react";

import { fetchUserPerformance } from "@/api/analytics/userPerformanceApi";
import type { UserPerformancePayload, UserPerformanceRow } from "@/api/analytics/userPerformanceApi";
import { userPerformanceQueryKeys } from "@/lib/queryKeys";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// ─── Classification Colors ───────────────────────────────────────────────────

const CLASSIFICATION_COLORS: Record<string, string> = {
  "High Performer": "#10b981",    // emerald-500
  "Fast but Careless": "#f59e0b", // amber-500
  "Careful but Slow": "#6366f1",  // indigo-500
  "High Rework Risk": "#ef4444",  // red-500
  "Planning Issue": "#f97316",    // orange-500
  "Execution Issue": "#8b5cf6",   // violet-500
  "Average": "#94a3b8",           // slate-400
};

// ─── Custom Tooltips ─────────────────────────────────────────────────────────

function ScoreTooltip({ active, payload }: { active?: boolean; payload?: any[] }) {
  if (!active || !payload?.length) return null;
  const row: UserPerformanceRow = payload[0].payload;
  return (
    <div className="rounded-xl border border-border/60 bg-background/95 p-3 shadow-xl backdrop-blur-sm text-sm space-y-2 min-w-[220px]">
      <div className="border-b border-border/40 pb-2 flex justify-between items-start">
        <p className="font-semibold text-foreground">{row.name}</p>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
          {pct(row.performance_score)}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <span className="text-muted-foreground">Class</span>
        <span className="font-medium text-foreground truncate" style={{ color: CLASSIFICATION_COLORS[row.classification] }}>
          {row.classification}
        </span>
        <span className="text-muted-foreground">Throughput</span>
        <span className="font-medium text-foreground">{row.fixtures_completed} fix</span>
        <span className="text-muted-foreground">Speed (Avg)</span>
        <span className="font-medium text-foreground">{formatMinutes(row.avg_duration_minutes)}</span>
        <span className="text-muted-foreground">Quality Rate</span>
        <span className="font-medium text-foreground">{pct(1 - row.rework_rate)}</span>
        <span className="text-muted-foreground">Reliability</span>
        <span className="font-medium text-foreground">{pct(row.on_time_rate)}</span>
      </div>
    </div>
  );
}

function ScatterTooltip({ active, payload }: { active?: boolean; payload?: any[] }) {
  if (!active || !payload?.length) return null;
  const row: UserPerformanceRow = payload[0].payload;
  
  return (
    <div className="rounded-xl border border-border/60 bg-background/95 p-3 shadow-xl backdrop-blur-sm text-sm min-w-[180px]">
      <p className="font-semibold text-foreground mb-1.5">{row.name}</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <span className="text-muted-foreground">Avg Speed</span>
        <span className="font-medium text-foreground">{formatMinutes(row.avg_duration_minutes)}</span>
        <span className="text-muted-foreground">Rework Rate</span>
        <span className="font-medium text-foreground">{pct(row.rework_rate)}</span>
      </div>
      <div className="mt-2 text-[10px] uppercase font-bold tracking-wider" style={{ color: CLASSIFICATION_COLORS[row.classification] }}>
        {row.classification}
      </div>
    </div>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KPICard({ label, value, sub, icon, accent }: any) {
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

// ─── Main Component ───────────────────────────────────────────────────────────

export default function UserPerformance({ filters }: { filters: any }) {
  const { data, isLoading, isError, refetch } = useQuery<UserPerformancePayload>({
    queryKey: userPerformanceQueryKeys.filtered(filters),
    queryFn: () => fetchUserPerformance(filters),
  });

  /* ── Loading state ── */
  if (isLoading) {
    return (
      <div className="space-y-6 animate-pulse mt-8 pt-8 border-t border-border/40">
        <div className="h-8 w-64 rounded-xl bg-muted/60" />
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-2xl bg-muted/60 h-24" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-2xl bg-muted/60 h-[340px]" />
          <div className="rounded-2xl bg-muted/60 h-[340px]" />
        </div>
      </div>
    );
  }

  /* ── Error state ── */
  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center space-y-3 mt-8 pt-8 border-t border-border/40">
        <p className="text-sm font-medium text-destructive">Failed to load user performance data</p>
        <button
          onClick={() => refetch()}
          className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
        >
          <RefreshCw className="h-4 w-4" /> Retry
        </button>
      </div>
    );
  }

  const { users, team_summary } = data ?? { users: [], team_summary: { total_users: 0, avg_score: 0, best_performer: null, highest_rework_risk: null } };

  if (users.length === 0) {
    return null;
  }

  // Pre-calculate averages for quadrant lines
  const scatterDurAvg = users.reduce((acc, d) => acc + d.avg_duration_minutes, 0) / users.length;
  const scatterReworkAvg = users.reduce((acc, d) => acc + d.rework_rate, 0) / users.length;

  return (
    <div className="space-y-6 mt-8 pt-8 border-t border-border/40">
      {/* ── Section header ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-blue-100 dark:bg-blue-900/30 p-2 shrink-0">
          <TrendingUp className="h-5 w-5 text-blue-600 dark:text-blue-400" />
        </div>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">User Performance</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Holistic accountability across Throughput, Efficiency, Quality, and Reliability.
          </p>
        </div>
      </div>

      {/* ── KPI Row ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          label="Team Avg Score"
          value={pct(team_summary.avg_score)}
          sub={`${team_summary.total_users} active users`}
          icon={<TrendingUp className="h-4 w-4 text-blue-600" />}
          accent="bg-blue-50 dark:bg-blue-950/40"
        />
        <KPICard
          label="Best Performer"
          value={team_summary.best_performer || "N/A"}
          sub="Highest composite index"
          icon={<Trophy className="h-4 w-4 text-emerald-600" />}
          accent="bg-emerald-50 dark:bg-emerald-950/40"
        />
        <KPICard
          label="Highest Rework Risk"
          value={team_summary.highest_rework_risk || "N/A"}
          sub="Most frequent rework loops"
          icon={<AlertTriangle className="h-4 w-4 text-rose-600" />}
          accent="bg-rose-50 dark:bg-rose-950/40"
        />
        <KPICard
          label="Most Accountable"
          value={
            [...users].sort((a, b) => b.on_time_rate - a.on_time_rate)[0]?.name || "N/A"
          }
          sub="Highest delivery reliability"
          icon={<UserCheck className="h-4 w-4 text-indigo-600" />}
          accent="bg-indigo-50 dark:bg-indigo-950/40"
        />
      </div>

      {/* ── Charts Grid ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Chart 1 — User Comparison (Core Score) */}
        <div className="rounded-2xl border border-border/60 bg-card p-6 shadow-sm">
          <div className="mb-5 flex items-start justify-between">
            <div>
              <h3 className="text-base font-semibold text-foreground">Composite Performance</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Sorted highest to lowest overall score
              </p>
            </div>
          </div>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={[...users].reverse()} // reversed so bar chart renders highest at top
                layout="vertical"
                margin={{ top: 0, right: 30, left: 10, bottom: 0 }}
                barSize={24}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                <XAxis 
                  type="number" 
                  domain={[0, 1]} 
                  tickFormatter={(v) => `${v * 100}%`}
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis 
                  type="category" 
                  dataKey="name" 
                  tick={{ fontSize: 11, fill: "hsl(var(--foreground))", fontWeight: 500 }}
                  tickLine={false}
                  axisLine={false}
                  width={90}
                />
                <Tooltip content={<ScoreTooltip />} cursor={{ fill: "hsl(var(--muted))", radius: 4 }} />
                <Bar dataKey="performance_score" radius={[0, 4, 4, 0]} isAnimationActive>
                  {[...users].reverse().map((row, i) => (
                    <Cell key={i} fill={CLASSIFICATION_COLORS[row.classification] || "#6366f1"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          {/* Legend */}
          <div className="flex flex-wrap gap-x-3 gap-y-1.5 mt-4 pt-4 border-t border-border/40">
            {Object.entries(CLASSIFICATION_COLORS).map(([label, color]) => (
              <span key={label} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
                {label}
              </span>
            ))}
          </div>
        </div>

        {/* Chart 2 — Efficiency vs Quality Scatter */}
        <div className="rounded-2xl border border-border/60 bg-card p-6 shadow-sm">
          <div className="mb-5 flex items-start justify-between">
            <div>
              <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
                <Zap className="h-4 w-4 text-amber-500" />
                Speed vs Quality Matrix
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Top Left = Ideal | Bottom Right = Critical Wait
              </p>
            </div>
          </div>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                {/* X Axis: Duration (lower is better, so it's towards left) */}
                <XAxis 
                  type="number" 
                  dataKey="avg_duration_minutes" 
                  name="Speed" 
                  tickFormatter={formatMinutes}
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  label={{ value: 'Avg Duration →', position: 'bottom', offset: 0, fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                />
                {/* Y Axis: Rework Rate (lower is better, so it's towards bottom) */}
                <YAxis 
                  type="number" 
                  dataKey="rework_rate" 
                  name="Rework" 
                  tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  width={40}
                  label={{ value: 'Rework Rate ↑', angle: -90, position: 'insideLeft', fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                />
                <ZAxis type="number" range={[80, 80]} /> {/* Fixed dot size */}
                <Tooltip content={<ScatterTooltip />} cursor={{ strokeDasharray: '3 3' }} />
                
                <Scatter name="Users" data={users} isAnimationActive>
                  {users.map((row, i) => (
                    <Cell key={i} fill={CLASSIFICATION_COLORS[row.classification] || "#6366f1"} />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>

      </div>
    </div>
  );
}
