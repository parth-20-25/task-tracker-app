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
  ReferenceLine,
} from "recharts";
import {
  AlertTriangle,
  BarChart3,
  Brain,
  CheckCircle2,
  Clock,
  Eye,
  RefreshCw,
  Shield,
  TrendingUp,
  Zap,
} from "lucide-react";

import {
  fetchPredictiveInsights,
  type FixturePrediction,
  type PredictiveInsightsPayload,
  type RiskLevel,
} from "@/api/analytics/predictiveInsightsApi";
import { predictiveInsightsQueryKeys } from "@/lib/queryKeys";

// ─── Risk config ─────────────────────────────────────────────────────────────

const RISK_CONFIG: Record<
  RiskLevel,
  { label: string; color: string; bg: string; border: string; badge: string; glow: string }
> = {
  HIGH: {
    label: "High Risk",
    color: "#ef4444",
    bg: "rgba(239,68,68,0.08)",
    border: "rgba(239,68,68,0.25)",
    badge: "bg-red-500/15 text-red-400 border-red-500/30",
    glow: "rgba(239,68,68,0.15)",
  },
  MEDIUM: {
    label: "Medium Risk",
    color: "#f59e0b",
    bg: "rgba(245,158,11,0.08)",
    border: "rgba(245,158,11,0.25)",
    badge: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    glow: "rgba(245,158,11,0.15)",
  },
  LOW: {
    label: "Low Risk",
    color: "#10b981",
    bg: "rgba(16,185,129,0.08)",
    border: "rgba(16,185,129,0.25)",
    badge: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    glow: "rgba(16,185,129,0.15)",
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function getRiskColor(risk: number): string {
  if (risk > 0.7) return "#ef4444";
  if (risk >= 0.3) return "#f59e0b";
  return "#10b981";
}

// ─── Risk Heatmap ────────────────────────────────────────────────────────────

function RiskHeatmap({ predictions }: { predictions: FixturePrediction[] }) {
  const groups: Record<RiskLevel, FixturePrediction[]> = {
    HIGH: predictions.filter((p) => p.risk_level === "HIGH"),
    MEDIUM: predictions.filter((p) => p.risk_level === "MEDIUM"),
    LOW: predictions.filter((p) => p.risk_level === "LOW"),
  };

  const levels: RiskLevel[] = ["HIGH", "MEDIUM", "LOW"];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-1">
        <Eye className="h-4 w-4 text-slate-400" />
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">
          Risk Heatmap
        </h3>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {levels.map((level) => {
          const cfg = RISK_CONFIG[level];
          const items = groups[level];
          return (
            <div
              key={level}
              className="rounded-xl border p-4 transition-all"
              style={{
                borderColor: cfg.border,
                backgroundColor: cfg.bg,
              }}
            >
              <div className="flex items-center justify-between mb-3">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${cfg.badge}`}
                >
                  {level === "HIGH" && <AlertTriangle className="h-3 w-3" />}
                  {level === "MEDIUM" && <Clock className="h-3 w-3" />}
                  {level === "LOW" && <CheckCircle2 className="h-3 w-3" />}
                  {cfg.label}
                </span>
                <span
                  className="text-2xl font-bold"
                  style={{ color: cfg.color }}
                >
                  {items.length}
                </span>
              </div>

              {items.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {items.slice(0, 12).map((p) => (
                    <div
                      key={p.fixture_id}
                      className="rounded-md px-2 py-1 text-[10px] font-mono font-medium border transition-all hover:scale-105"
                      style={{
                        borderColor: cfg.border,
                        color: cfg.color,
                        backgroundColor: `${cfg.color}10`,
                      }}
                      title={`${p.fixture_no} — Risk: ${formatPercent(p.delay_risk)}`}
                    >
                      {p.fixture_no}
                    </div>
                  ))}
                  {items.length > 12 && (
                    <div
                      className="rounded-md px-2 py-1 text-[10px] font-mono border"
                      style={{ borderColor: cfg.border, color: cfg.color }}
                    >
                      +{items.length - 12} more
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-xs text-slate-500 italic">No fixtures</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Predicted vs Actual Trend ───────────────────────────────────────────────

interface TrendTooltipPayload {
  payload?: {
    predicted: number;
    actual: number;
    error: number;
  };
}

function TrendTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: TrendTooltipPayload[];
}) {
  if (!active || !payload?.length || !payload[0].payload) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-xl border border-white/10 bg-slate-900/95 p-3 shadow-xl backdrop-blur text-xs space-y-1.5 min-w-[160px]">
      <div className="flex items-center justify-between">
        <span className="text-slate-400">Predicted</span>
        <span className="font-bold text-indigo-400">{formatDuration(row.predicted)}</span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-slate-400">Actual</span>
        <span className="font-bold text-emerald-400">{formatDuration(row.actual)}</span>
      </div>
      <div className="flex items-center justify-between border-t border-white/5 pt-1.5">
        <span className="text-slate-400">Error</span>
        <span className="font-bold text-amber-400">{formatDuration(row.error)}</span>
      </div>
    </div>
  );
}

function PredictedVsActualTrend({
  history,
}: {
  history: PredictiveInsightsPayload["prediction_history"];
}) {
  if (!history || history.length === 0) {
    return (
      <div className="rounded-xl border border-white/5 bg-white/3 p-6 flex flex-col items-center justify-center gap-2 text-center min-h-[240px]">
        <TrendingUp className="h-6 w-6 text-slate-600" />
        <p className="text-xs text-slate-500">
          Prediction accuracy trend will appear after fixtures complete with
          tracked predictions.
        </p>
      </div>
    );
  }

  const chartData = history.map((h, i) => ({
    index: i + 1,
    predicted: h.predicted,
    actual: h.actual,
    error: h.error,
  }));

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <TrendingUp className="h-4 w-4 text-slate-400" />
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">
          Predicted vs Actual
        </h3>
      </div>
      <div className="h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="rgba(255,255,255,0.05)"
            />
            <XAxis
              type="number"
              dataKey="actual"
              name="Actual"
              tick={{ fontSize: 10, fill: "rgba(255,255,255,0.3)" }}
              tickLine={false}
              axisLine={false}
              label={{
                value: "Actual (min)",
                position: "insideBottom",
                offset: -2,
                style: { fontSize: 9, fill: "rgba(255,255,255,0.3)" },
              }}
            />
            <YAxis
              type="number"
              dataKey="predicted"
              name="Predicted"
              tick={{ fontSize: 10, fill: "rgba(255,255,255,0.3)" }}
              tickLine={false}
              axisLine={false}
              label={{
                value: "Predicted (min)",
                angle: -90,
                position: "insideLeft",
                style: { fontSize: 9, fill: "rgba(255,255,255,0.3)" },
              }}
            />
            <Tooltip content={<TrendTooltip />} />
            {/* Perfect prediction line */}
            <ReferenceLine
              segment={[
                { x: 0, y: 0 },
                {
                  x: Math.max(...chartData.map((d) => Math.max(d.actual, d.predicted))),
                  y: Math.max(...chartData.map((d) => Math.max(d.actual, d.predicted))),
                },
              ]}
              stroke="rgba(255,255,255,0.12)"
              strokeDasharray="4 4"
            />
            <Scatter data={chartData} fill="#818cf8" opacity={0.85}>
              {chartData.map((entry, idx) => (
                <Cell
                  key={idx}
                  fill={entry.error < entry.actual * 0.15 ? "#10b981" : entry.error < entry.actual * 0.3 ? "#f59e0b" : "#ef4444"}
                />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <p className="text-[10px] text-slate-600 text-center">
        Points on the dashed line = perfect predictions. Color: 🟢 &lt;15% error · 🟡 &lt;30% · 🔴 &gt;30%
      </p>
    </div>
  );
}

// ─── Upcoming Risk Table ─────────────────────────────────────────────────────

function UpcomingRiskTable({
  predictions,
}: {
  predictions: FixturePrediction[];
}) {
  const top10 = predictions.filter((p) => p.risk_level !== "LOW").slice(0, 10);

  if (top10.length === 0) {
    return (
      <div className="rounded-xl border border-white/5 bg-white/3 p-6 flex flex-col items-center justify-center gap-2 text-center min-h-[200px]">
        <Shield className="h-6 w-6 text-emerald-500/50" />
        <p className="text-xs text-slate-500">
          All active fixtures are low risk. No immediate attention needed.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-slate-400" />
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">
          Top Risk Fixtures
        </h3>
      </div>
      <div className="overflow-x-auto rounded-xl border border-white/5">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-white/5 bg-white/3">
              <th className="text-left px-3 py-2.5 font-semibold text-slate-400 uppercase tracking-widest text-[10px]">
                Fixture
              </th>
              <th className="text-left px-3 py-2.5 font-semibold text-slate-400 uppercase tracking-widest text-[10px]">
                User
              </th>
              <th className="text-center px-3 py-2.5 font-semibold text-slate-400 uppercase tracking-widest text-[10px]">
                Risk
              </th>
              <th className="text-center px-3 py-2.5 font-semibold text-slate-400 uppercase tracking-widest text-[10px]">
                Rework Prob.
              </th>
              <th className="text-center px-3 py-2.5 font-semibold text-slate-400 uppercase tracking-widest text-[10px]">
                Est. Time
              </th>
              <th className="text-left px-3 py-2.5 font-semibold text-slate-400 uppercase tracking-widest text-[10px]">
                Reason
              </th>
            </tr>
          </thead>
          <tbody>
            {top10.map((p) => {
              const cfg = RISK_CONFIG[p.risk_level];
              return (
                <tr
                  key={p.fixture_id}
                  className="border-b border-white/3 hover:bg-white/3 transition-colors"
                >
                  <td className="px-3 py-2.5 font-mono font-semibold text-slate-200">
                    {p.fixture_no}
                  </td>
                  <td className="px-3 py-2.5 text-slate-400">{p.user_name}</td>
                  <td className="px-3 py-2.5 text-center">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${cfg.badge}`}
                    >
                      {p.risk_level}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-center font-mono" style={{ color: getRiskColor(p.rework_probability) }}>
                    {formatPercent(p.rework_probability)}
                  </td>
                  <td className="px-3 py-2.5 text-center font-mono text-slate-300">
                    {formatDuration(p.predicted_completion_minutes)}
                  </td>
                  <td className="px-3 py-2.5 text-slate-500 max-w-[200px] truncate">
                    {p.risk_reasons[0] || "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Model Status Bar ────────────────────────────────────────────────────────

function ModelStatusBar({
  metadata,
}: {
  metadata: PredictiveInsightsPayload["model_metadata"];
}) {
  const signals = metadata.cross_module_signals;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <div className="rounded-xl border border-white/5 bg-white/3 px-3 py-2.5">
        <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">
          Training Data
        </p>
        <p className="text-lg font-bold text-white mt-0.5">
          {metadata.data_points_used}
        </p>
        <p className="text-[10px] text-slate-500">completed fixtures</p>
      </div>
      <div className="rounded-xl border border-white/5 bg-white/3 px-3 py-2.5">
        <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">
          Active Targets
        </p>
        <p className="text-lg font-bold text-indigo-400 mt-0.5">
          {metadata.active_fixtures_count}
        </p>
        <p className="text-[10px] text-slate-500">fixtures predicted</p>
      </div>
      <div className="rounded-xl border border-white/5 bg-white/3 px-3 py-2.5">
        <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">
          Avg Error
        </p>
        <p className="text-lg font-bold text-amber-400 mt-0.5">
          {metadata.avg_prediction_error_minutes > 0
            ? formatDuration(metadata.avg_prediction_error_minutes)
            : "—"}
        </p>
        <p className="text-[10px] text-slate-500">
          {metadata.evaluated_predictions
            ? `from ${metadata.evaluated_predictions} evaluated`
            : "no evaluations yet"}
        </p>
      </div>
      {signals && (
        <div className="rounded-xl border border-white/5 bg-white/3 px-3 py-2.5">
          <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">
            Stability Factor
          </p>
          <p
            className="text-lg font-bold mt-0.5"
            style={{
              color: signals.workflow_health.stability_factor >= 0.7
                ? "#10b981"
                : signals.workflow_health.stability_factor >= 0.4
                  ? "#f59e0b"
                  : "#ef4444",
            }}
          >
            {formatPercent(signals.workflow_health.stability_factor)}
          </p>
          <p className="text-[10px] text-slate-500">system consistency</p>
        </div>
      )}
    </div>
  );
}

// ─── Cross-Module Signals Panel ──────────────────────────────────────────────

function CrossModulePanel({
  signals,
}: {
  signals: PredictiveInsightsPayload["model_metadata"]["cross_module_signals"];
}) {
  if (!signals) return null;

  const items = [
    {
      label: "Rework Cost",
      value: formatDuration(signals.rework_intelligence.avg_rework_cost),
      sub: "avg per rework event",
      icon: <RefreshCw className="h-3.5 w-3.5" />,
      color: "#f97316",
    },
    {
      label: "Rework Rate",
      value: formatPercent(signals.rework_intelligence.rework_rate),
      sub: "fixtures with rework",
      icon: <RefreshCw className="h-3.5 w-3.5" />,
      color: "#f97316",
    },
    {
      label: "Delay Frequency",
      value: formatPercent(signals.deadline_reliability.delay_frequency),
      sub: "of measurable fixtures",
      icon: <Clock className="h-3.5 w-3.5" />,
      color: "#ef4444",
    },
    {
      label: "Planning Error",
      value: `${signals.deadline_reliability.planning_error_avg > 0 ? "+" : ""}${formatDuration(Math.abs(signals.deadline_reliability.planning_error_avg))}`,
      sub: "avg deviation",
      icon: <AlertTriangle className="h-3.5 w-3.5" />,
      color: "#f59e0b",
    },
    {
      label: "Bottleneck",
      value: signals.stage_efficiency.bottleneck_stage,
      sub: "slowest stage",
      icon: <Zap className="h-3.5 w-3.5" />,
      color: "#818cf8",
    },
    {
      label: "Stability",
      value: formatPercent(signals.workflow_health.stability_factor),
      sub: "system consistency",
      icon: <Shield className="h-3.5 w-3.5" />,
      color: "#10b981",
    },
  ];

  return (
    <div className="space-y-3">
      <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest">
        Cross‑Module Signals Used
      </p>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
        {items.map((item) => (
          <div
            key={item.label}
            className="rounded-xl border border-white/5 bg-white/3 p-3 text-center"
          >
            <div
              className="mx-auto mb-1.5 rounded-lg p-1.5 w-fit"
              style={{ backgroundColor: `${item.color}15` }}
            >
              <span style={{ color: item.color }}>{item.icon}</span>
            </div>
            <p
              className="text-sm font-bold"
              style={{ color: item.color }}
            >
              {item.value}
            </p>
            <p className="text-[10px] text-slate-400 font-medium mt-0.5">
              {item.label}
            </p>
            <p className="text-[9px] text-slate-600 mt-0.5">{item.sub}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Risk Distribution Bar Chart ─────────────────────────────────────────────

function RiskDistributionChart({
  predictions,
}: {
  predictions: FixturePrediction[];
}) {
  if (predictions.length === 0) return null;

  // Bucket predictions into risk bands (0.1 increments)
  const buckets: { range: string; count: number; midpoint: number }[] = [];
  for (let i = 0; i < 10; i++) {
    const low = i * 0.1;
    const high = (i + 1) * 0.1;
    const count = predictions.filter(
      (p) => p.delay_risk >= low && p.delay_risk < (i === 9 ? 1.01 : high)
    ).length;
    buckets.push({
      range: `${(low * 100).toFixed(0)}–${(high * 100).toFixed(0)}%`,
      count,
      midpoint: (low + high) / 2,
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <BarChart3 className="h-4 w-4 text-slate-400" />
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">
          Risk Distribution
        </h3>
      </div>
      <div className="h-[180px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={buckets}
            margin={{ top: 8, right: 8, left: 0, bottom: 4 }}
            barSize={20}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="rgba(255,255,255,0.05)"
              vertical={false}
            />
            <XAxis
              dataKey="range"
              tick={{ fontSize: 9, fill: "rgba(255,255,255,0.3)" }}
              tickLine={false}
              axisLine={false}
              interval={0}
              angle={-45}
              textAnchor="end"
              height={40}
            />
            <YAxis
              tick={{ fontSize: 9, fill: "rgba(255,255,255,0.3)" }}
              tickLine={false}
              axisLine={false}
              width={25}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "rgba(15,23,42,0.95)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: "12px",
                fontSize: "11px",
                color: "#e2e8f0",
              }}
            />
            <Bar dataKey="count" radius={[4, 4, 0, 0]}>
              {buckets.map((b, idx) => (
                <Cell key={idx} fill={getRiskColor(b.midpoint)} opacity={0.85} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ─── Loading skeleton ────────────────────────────────────────────────────────

function PredictiveLoadingSkeleton() {
  return (
    <div className="rounded-2xl border border-white/8 bg-slate-900/80 p-6 animate-pulse space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-8 w-8 rounded-xl bg-white/5" />
        <div className="h-5 w-56 rounded bg-white/5" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-20 rounded-xl bg-white/5" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-32 rounded-xl bg-white/5" />
        ))}
      </div>
      <div className="h-48 rounded-xl bg-white/5" />
    </div>
  );
}

// ─── Empty / Not Viable state ────────────────────────────────────────────────

function NotViableState({ message }: { message?: string }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-slate-900/80 p-8 flex flex-col items-center justify-center gap-4 text-center">
      <div className="rounded-full bg-indigo-500/10 p-4">
        <Brain className="h-7 w-7 text-indigo-400" />
      </div>
      <div>
        <p className="text-sm font-medium text-slate-300">
          Predictive model not yet viable
        </p>
        <p className="text-xs text-slate-500 mt-1.5 max-w-md">
          {message ||
            "At least 30 completed fixture workflows are needed to generate statistically significant predictions."}
        </p>
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

interface PredictiveInsightsProps {
  filters: any;
}

export default function PredictiveInsights({
  filters,
}: PredictiveInsightsProps) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: predictiveInsightsQueryKeys.filtered(filters),
    queryFn: () => fetchPredictiveInsights(filters),
  });

  if (isLoading) return <PredictiveLoadingSkeleton />;

  if (isError) {
    return (
      <div className="rounded-2xl border border-white/8 bg-slate-900/80 p-6 flex items-center justify-between">
        <p className="text-sm text-red-400">
          Failed to load predictive insights
        </p>
        <button
          id="predictive-insights-retry-btn"
          onClick={() => refetch()}
          className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-white/5 transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Retry
        </button>
      </div>
    );
  }

  if (!data || !data.model_metadata.is_viable) {
    return <NotViableState message={data?.model_metadata.message} />;
  }

  const { predictions, risk_summary, prediction_history, model_metadata } =
    data;

  return (
    <div
      id="predictive-insights-card"
      className="rounded-2xl border border-white/8 bg-[linear-gradient(145deg,rgba(15,23,42,0.98),rgba(17,24,39,0.95))] shadow-xl overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-violet-500/10 border border-violet-500/20 p-2.5">
            <Brain className="h-5 w-5 text-violet-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white tracking-tight">
              Predictive Insights Engine
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              Statistical predictions from {model_metadata.data_points_used}{" "}
              completed fixtures
            </p>
          </div>
        </div>
        {risk_summary && (
          <div className="flex items-center gap-2">
            {risk_summary.high > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full border bg-red-500/15 text-red-400 border-red-500/30 px-2.5 py-1 text-[10px] font-bold uppercase">
                <AlertTriangle className="h-3 w-3" />
                {risk_summary.high} High
              </span>
            )}
            {risk_summary.medium > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full border bg-amber-500/15 text-amber-400 border-amber-500/30 px-2.5 py-1 text-[10px] font-bold uppercase">
                {risk_summary.medium} Med
              </span>
            )}
            {risk_summary.low > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full border bg-emerald-500/15 text-emerald-400 border-emerald-500/30 px-2.5 py-1 text-[10px] font-bold uppercase">
                {risk_summary.low} Low
              </span>
            )}
          </div>
        )}
      </div>

      <div className="p-6 space-y-6">
        {/* Model Status Metrics */}
        <ModelStatusBar metadata={model_metadata} />

        {/* Risk Heatmap */}
        {predictions.length > 0 && <RiskHeatmap predictions={predictions} />}

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Risk Distribution */}
          <RiskDistributionChart predictions={predictions} />

          {/* Predicted vs Actual Trend */}
          <PredictedVsActualTrend history={prediction_history} />
        </div>

        {/* Top-Risk Fixtures Table */}
        <UpcomingRiskTable predictions={predictions} />

        {/* Cross-Module Signals */}
        <CrossModulePanel signals={model_metadata.cross_module_signals} />
      </div>
    </div>
  );
}
