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
import { AlertTriangle, UserX, RefreshCcw } from "lucide-react";

// ─── Bar colors ──────────────────────────────────────────────────────────────

const GRADIENT_COLORS = [
  "#f43f5e", // rose-500
  "#ea580c", // orange-600
  "#d97706", // amber-600
  "#ca8a04", // yellow-600
  "#65a30d", // lime-600
  "#16a34a", // green-600
  "#059669", // emerald-600
  "#0d9488", // teal-600
];

function getBarColor(index: number): string {
  return GRADIENT_COLORS[index % GRADIENT_COLORS.length];
}

function getSecondaryBarColor(index: number): string {
  const SECONDARY_COLORS = ["#8b5cf6", "#7c3aed", "#6d28d9", "#5b21b6"];
  return SECONDARY_COLORS[index % SECONDARY_COLORS.length];
}

interface ReworkData {
  by_stage: Record<string, number>;
  by_user: Array<{ name: string; reworks: number }>;
}

function KPICard({ label, value, sub, icon, accent }: any) {
  return (
    <div className={`rounded-2xl border border-border/60 bg-card p-4 flex gap-3 items-start shadow-sm hover:shadow-md transition-shadow`}>
      <div className={`rounded-xl p-2.5 ${accent}`}>{icon}</div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{label}</p>
        <p className="text-2xl font-bold text-foreground mt-0.5 truncate">{value}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
      </div>
    </div>
  );
}

export default function ReworkIntelligence({ data, filters }: { data?: ReworkData; filters?: any }) {
  if (!data) return null;

  const stage_rework = Object.entries(data.by_stage || {}).map(([stage, count]) => ({ stage, count }));
  const user_rework = data.by_user || [];
  const totalReworks = user_rework.reduce((sum, d) => sum + d.reworks, 0);

  return (
    <div className="space-y-6 mt-8 pt-8 border-t border-border/40">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-orange-100 dark:bg-orange-900/30 p-2">
          <AlertTriangle className="h-5 w-5 text-orange-600 dark:text-orange-400" />
        </div>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Rework Intelligence</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Identify chronic failure points and isolation metrics from rejected stage attempts.
          </p>
        </div>
      </div>

      {/* ── KPI Row ───────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <KPICard
          label="Total Reworks"
          value={totalReworks}
          sub="extra attempts total"
          icon={<RefreshCcw className="h-5 w-5 text-orange-600" />}
          accent="bg-orange-50 dark:bg-orange-950/40"
        />
        <KPICard
          label="Chronic Stage"
          value={stage_rework.length > 0 ? [...stage_rework].sort((a,b) => b.count - a.count)[0].stage : "N/A"}
          sub="most frequent rework point"
          icon={<AlertTriangle className="h-5 w-5 text-red-600" />}
          accent="bg-red-50 dark:bg-red-950/40"
        />
      </div>

      {/* ── Charts Grid ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Chart 1: Rework by Stage */}
        <div className="rounded-2xl border border-border/60 bg-card p-6 shadow-sm flex flex-col">
          <div className="mb-5">
            <h3 className="text-base font-semibold text-foreground">Rework by Stage</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Total rejected attempts per workflow stage</p>
          </div>
          <div className="flex-1 min-h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={stage_rework}
                margin={{ top: 8, right: 0, left: -20, bottom: 40 }}
                barSize={32}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis
                  dataKey="stage"
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  angle={-35}
                  textAnchor="end"
                  interval={0}
                  tickLine={false}
                  axisLine={false}
                  height={60}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip cursor={{ fill: "hsl(var(--muted))", radius: 4 }} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]} isAnimationActive>
                  {stage_rework.map((_, index) => (
                    <Cell key={index} fill={getBarColor(index)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 2: User Ranking */}
        <div className="rounded-2xl border border-border/60 bg-card p-6 shadow-sm flex flex-col">
          <div className="mb-5 flex justify-between items-start">
            <div>
              <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
                <UserX className="h-4 w-4 text-muted-foreground" />
                User Rework Ranking
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">Sorted by total reworks</p>
            </div>
          </div>
          <div className="flex-1 min-h-[300px] overflow-hidden">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={user_rework.slice(0, 7)} 
                layout="vertical"
                margin={{ top: 0, right: 30, left: 10, bottom: 0 }}
                barSize={24}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                <XAxis
                  type="number"
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  dataKey="name"
                  type="category"
                  tick={{ fontSize: 11, fill: "hsl(var(--foreground))", fontWeight: 500 }}
                  tickLine={false}
                  axisLine={false}
                  width={90}
                />
                <Tooltip cursor={{ fill: "hsl(var(--muted))", radius: 4 }} />
                <Bar dataKey="reworks" radius={[0, 4, 4, 0]} isAnimationActive>
                   {user_rework.slice(0, 7).map((_, index) => (
                    <Cell key={index} fill={getSecondaryBarColor(index)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

      </div>
    </div>
  );
}
