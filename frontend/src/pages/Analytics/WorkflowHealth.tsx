import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Cpu,
  RefreshCw,
  Shield,
  Target,
  TrendingUp,
  Zap,
} from "lucide-react";

import {
  fetchWorkflowHealth,
  type WorkflowHealthPayload,
  type WorkflowHealthStatus,
} from "@/api/analytics/workflowHealthApi";
import { workflowHealthQueryKeys } from "@/lib/queryKeys";

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  WorkflowHealthStatus,
  { label: string; color: string; arc: string; ring: string; badge: string }
> = {
  HEALTHY: {
    label: "Healthy",
    color: "#10b981",
    arc: "#10b981",
    ring: "rgba(16,185,129,0.15)",
    badge: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  },
  MODERATE: {
    label: "Moderate",
    color: "#f59e0b",
    arc: "#f59e0b",
    ring: "rgba(245,158,11,0.15)",
    badge: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  },
  UNSTABLE: {
    label: "Unstable",
    color: "#f97316",
    arc: "#f97316",
    ring: "rgba(249,115,22,0.15)",
    badge: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  },
  CRITICAL: {
    label: "Critical",
    color: "#ef4444",
    arc: "#ef4444",
    ring: "rgba(239,68,68,0.15)",
    badge: "bg-red-500/15 text-red-400 border-red-500/30",
  },
};

// ─── Pillar config ────────────────────────────────────────────────────────────

const PILLAR_CONFIG = {
  efficiency: {
    label: "Efficiency",
    icon: Zap,
    description: "How fast work flows through stages",
  },
  quality: {
    label: "Quality",
    icon: Shield,
    description: "How much rework happens",
  },
  reliability: {
    label: "Reliability",
    icon: Target,
    description: "How well deadlines are met",
  },
  stability: {
    label: "Stability",
    icon: Activity,
    description: "How consistent the system is",
  },
} as const;

function getPillarColor(score: number): string {
  if (score >= 80) return "#10b981";
  if (score >= 60) return "#f59e0b";
  if (score >= 40) return "#f97316";
  return "#ef4444";
}

// ─── SVG Gauge ────────────────────────────────────────────────────────────────

interface GaugeProps {
  score: number;
  status: WorkflowHealthStatus;
}

function ScoreGauge({ score, status }: GaugeProps) {
  const cfg = STATUS_CONFIG[status];

  // Arc geometry: center=(120,110), radius=88, sweep from 210° to 330° (240° total)
  const cx = 120;
  const cy = 110;
  const r = 88;
  const startAngle = 210; // degrees
  const totalSweep = 240; // degrees

  function polarToXY(angleDeg: number, radius: number) {
    const rad = ((angleDeg - 90) * Math.PI) / 180;
    return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
  }

  function describeArc(from: number, to: number, radius: number) {
    const s = polarToXY(from, radius);
    const e = polarToXY(to, radius);
    const la = to - from > 180 ? 1 : 0;
    return `M ${s.x} ${s.y} A ${radius} ${radius} 0 ${la} 1 ${e.x} ${e.y}`;
  }

  const endAngle = startAngle + (score / 100) * totalSweep;

  // Track segments coloring bands
  const bands = [
    { from: 0, to: 40, color: "#ef4444" },
    { from: 40, to: 60, color: "#f97316" },
    { from: 60, to: 80, color: "#f59e0b" },
    { from: 80, to: 100, color: "#10b981" },
  ];

  return (
    <svg viewBox="0 0 240 160" className="w-full max-w-[260px]" aria-label={`Workflow health score: ${score}`}>
      {/* Glow filter */}
      <defs>
        <filter id="wh-glow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Background arc track */}
      <path
        d={describeArc(startAngle, startAngle + totalSweep, r)}
        fill="none"
        stroke="rgba(255,255,255,0.07)"
        strokeWidth={14}
        strokeLinecap="round"
      />

      {/* Colored band segments (subtle) */}
      {bands.map((band) => {
        const bFrom = startAngle + (band.from / 100) * totalSweep;
        const bTo = startAngle + (band.to / 100) * totalSweep;
        return (
          <path
            key={band.from}
            d={describeArc(bFrom, bTo, r)}
            fill="none"
            stroke={band.color}
            strokeWidth={14}
            strokeLinecap="butt"
            opacity={0.18}
          />
        );
      })}

      {/* Score arc */}
      {score > 0 && (
        <path
          d={describeArc(startAngle, endAngle, r)}
          fill="none"
          stroke={cfg.arc}
          strokeWidth={14}
          strokeLinecap="round"
          filter="url(#wh-glow)"
          opacity={0.95}
        />
      )}

      {/* Score number */}
      <text
        x={cx}
        y={cy + 6}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={42}
        fontWeight={700}
        fill={cfg.color}
        fontFamily="inherit"
      >
        {score}
      </text>

      {/* /100 label */}
      <text
        x={cx}
        y={cy + 34}
        textAnchor="middle"
        fontSize={11}
        fill="rgba(255,255,255,0.4)"
        fontFamily="inherit"
      >
        out of 100
      </text>

      {/* Start / end labels */}
      <text x={22} y={cy + 42} textAnchor="middle" fontSize={9} fill="rgba(255,255,255,0.3)" fontFamily="inherit">0</text>
      <text x={218} y={cy + 42} textAnchor="middle" fontSize={9} fill="rgba(255,255,255,0.3)" fontFamily="inherit">100</text>
    </svg>
  );
}

// ─── Custom bar tooltip ───────────────────────────────────────────────────────

function PillarTooltip({ active, payload }: { active?: boolean; payload?: { payload: { label: string; score: number; description: string } }[] }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-xl border border-white/10 bg-slate-900/95 p-3 shadow-xl backdrop-blur text-xs space-y-1">
      <p className="font-semibold text-white">{row.label}</p>
      <p className="text-slate-400">{row.description}</p>
      <p className="text-white font-bold text-sm">{row.score}<span className="text-slate-400 font-normal"> / 100</span></p>
    </div>
  );
}

// ─── Raw metric row ───────────────────────────────────────────────────────────

function RawMetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-white/5 last:border-0">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="text-xs font-mono text-slate-300">{value}</span>
    </div>
  );
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function HealthLoadingSkeleton() {
  return (
    <div className="rounded-2xl border border-white/8 bg-slate-900/80 p-6 animate-pulse">
      <div className="flex items-center gap-3 mb-6">
        <div className="h-8 w-8 rounded-xl bg-white/5" />
        <div className="h-5 w-48 rounded bg-white/5" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="h-56 rounded-xl bg-white/5" />
        <div className="lg:col-span-2 h-56 rounded-xl bg-white/5" />
      </div>
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function HealthEmptyState() {
  return (
    <div className="rounded-2xl border border-white/8 bg-slate-900/80 p-8 flex flex-col items-center justify-center gap-4 text-center">
      <div className="rounded-full bg-white/5 p-4">
        <Cpu className="h-7 w-7 text-slate-500" />
      </div>
      <div>
        <p className="text-sm font-medium text-slate-300">No health data available</p>
        <p className="text-xs text-slate-500 mt-1 max-w-xs">
          Complete fixture workflows with deadlines assigned to generate the health score.
        </p>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface WorkflowHealthProps {
  filters: any;
}

export default function WorkflowHealth({ filters }: WorkflowHealthProps) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: workflowHealthQueryKeys.filtered(filters),
    queryFn: () => fetchWorkflowHealth(filters),
  });

  if (isLoading) return <HealthLoadingSkeleton />;

  if (isError) {
    return (
      <div className="rounded-2xl border border-white/8 bg-slate-900/80 p-6 flex items-center justify-between">
        <p className="text-sm text-red-400">Failed to load workflow health score</p>
        <button
          id="workflow-health-retry-btn"
          onClick={() => refetch()}
          className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-white/5 transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Retry
        </button>
      </div>
    );
  }

  if (!data || data.raw.fixture_count === 0) return <HealthEmptyState />;

  const cfg = STATUS_CONFIG[data.status];

  // Pillar chart data
  const pillarData = (
    Object.entries(data.breakdown) as [keyof typeof PILLAR_CONFIG, number][]
  ).map(([key, score]) => ({
    key,
    label: PILLAR_CONFIG[key].label,
    description: PILLAR_CONFIG[key].description,
    score,
    fill: getPillarColor(score),
  }));

  const weakestCfg = PILLAR_CONFIG[data.weakest_dimension];
  const WeakestIcon = weakestCfg.icon;
  const weakestScore = data.breakdown[data.weakest_dimension];

  function formatDuration(min: number): string {
    if (min < 60) return `${min}m`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }

  return (
    <div
      id="workflow-health-card"
      className="rounded-2xl border border-white/8 bg-[linear-gradient(145deg,rgba(15,23,42,0.98),rgba(17,24,39,0.95))] shadow-xl overflow-hidden"
    >
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-indigo-500/10 border border-indigo-500/20 p-2.5">
            <Cpu className="h-5 w-5 text-indigo-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white tracking-tight">Workflow Health Score</p>
            <p className="text-xs text-slate-500 mt-0.5">System integrity signal — not a KPI summary</p>
          </div>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold tracking-wide uppercase ${cfg.badge}`}
        >
          {data.status === "HEALTHY" && <CheckCircle2 className="h-3 w-3" />}
          {data.status !== "HEALTHY" && <AlertTriangle className="h-3 w-3" />}
          {cfg.label}
        </span>
      </div>

      <div className="p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Gauge column ──────────────────────────────────────────────── */}
        <div className="flex flex-col items-center justify-center gap-4">
          <ScoreGauge score={data.overall_score} status={data.status} />

          {/* Fixture count */}
          <div className="text-center">
            <p className="text-xs text-slate-500">
              Based on{" "}
              <span className="text-slate-300 font-medium">{data.raw.fixture_count}</span>{" "}
              completed fixture{data.raw.fixture_count !== 1 ? "s" : ""}
              {data.raw.measurable_count > 0 && (
                <>
                  {" "}·{" "}
                  <span className="text-slate-300 font-medium">{data.raw.measurable_count}</span>{" "}
                  measurable
                </>
              )}
            </p>
          </div>

          {/* Raw signal panel */}
          <div className="w-full rounded-xl border border-white/5 bg-white/3 px-4 py-3 space-y-0.5">
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-2">Raw Signals</p>
            <RawMetricRow label="Avg. cycle time" value={formatDuration(data.raw.avg_duration_minutes)} />
            <RawMetricRow label="Rework rate" value={`${(data.raw.rework_rate * 100).toFixed(1)}%`} />
            <RawMetricRow label="On-time rate" value={`${(data.raw.on_time_rate * 100).toFixed(1)}%`} />
            <RawMetricRow label="Planning std dev" value={formatDuration(data.raw.planning_error_std_dev)} />
          </div>
        </div>

        {/* ── Right column: Pillar chart + Weakest link ─────────────────── */}
        <div className="lg:col-span-2 flex flex-col gap-5">
          {/* Pillar breakdown */}
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4">Pillar Breakdown</p>
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={pillarData}
                  layout="vertical"
                  margin={{ top: 0, right: 16, left: 0, bottom: 0 }}
                  barSize={18}
                >
                  <XAxis
                    type="number"
                    domain={[0, 100]}
                    tick={{ fontSize: 10, fill: "rgba(255,255,255,0.25)" }}
                    tickLine={false}
                    axisLine={false}
                    tickCount={6}
                    tickFormatter={(v) => `${v}`}
                  />
                  <YAxis
                    type="category"
                    dataKey="label"
                    tick={{ fontSize: 11, fill: "rgba(255,255,255,0.55)", fontWeight: 500 }}
                    tickLine={false}
                    axisLine={false}
                    width={76}
                  />
                  <Tooltip
                    content={<PillarTooltip />}
                    cursor={{ fill: "rgba(255,255,255,0.03)", radius: 4 }}
                  />
                  <Bar
                    dataKey="score"
                    radius={[0, 6, 6, 0]}
                    background={{ fill: "rgba(255,255,255,0.04)", radius: 6 }}
                    isAnimationActive
                  >
                    {pillarData.map((entry) => (
                      <Cell key={entry.key} fill={entry.fill} opacity={0.9} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Score badges */}
            <div className="grid grid-cols-4 gap-2 mt-3">
              {pillarData.map((p) => {
                const Icon = PILLAR_CONFIG[p.key as keyof typeof PILLAR_CONFIG].icon;
                return (
                  <div
                    key={p.key}
                    className="rounded-xl border border-white/5 bg-white/3 p-2.5 text-center"
                  >
                    <Icon className="h-3.5 w-3.5 mx-auto mb-1" style={{ color: p.fill }} />
                    <p className="text-[11px] font-bold" style={{ color: p.fill }}>
                      {p.score}
                    </p>
                    <p className="text-[9px] text-slate-500 mt-0.5 uppercase tracking-wide">{p.label}</p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Weakest link highlight */}
          <div
            id="workflow-health-weakest-link"
            className="rounded-xl border p-4 flex items-start gap-3"
            style={{
              borderColor: `${getPillarColor(weakestScore)}30`,
              backgroundColor: `${getPillarColor(weakestScore)}08`,
            }}
          >
            <div
              className="rounded-xl p-2.5 shrink-0"
              style={{ backgroundColor: `${getPillarColor(weakestScore)}15` }}
            >
              <WeakestIcon className="h-5 w-5" style={{ color: getPillarColor(weakestScore) }} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-xs font-semibold text-slate-300 uppercase tracking-widest">
                  Biggest Issue
                </p>
                <span
                  className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                  style={{
                    color: getPillarColor(weakestScore),
                    backgroundColor: `${getPillarColor(weakestScore)}18`,
                  }}
                >
                  {weakestScore} / 100
                </span>
              </div>
              <p className="text-base font-bold text-white mt-0.5">
                {weakestCfg.label}
              </p>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                {weakestCfg.description}. This is the primary lever to improve the overall workflow health score.
              </p>
            </div>
            <TrendingUp className="h-4 w-4 text-slate-600 shrink-0 mt-0.5" />
          </div>
        </div>
      </div>
    </div>
  );
}
