"use client";

import { useEffect, useMemo, useState } from "react";
import {
  fetchOpsTickets,
  fetchShipments,
  fetchWeeklyCostPerOrder,
} from "@/lib/data";
import {
  SHIPPING_CATEGORIES,
  boxCostImpact,
  costKpis,
  detectPartialWeeksFromShipments,
  opsCostByCategory,
  weeklyIssuesAndOrders,
  withRollingAvg,
} from "@/lib/transforms";
import type { OpsTicket, ShipmentWeek, ShippingCategory, WeeklyCostPoint } from "@/lib/types";
import { useFilterStore } from "@/lib/store";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const ACCENT_STYLES = {
  blue: "border-t-blue-500 bg-blue-50/40",
  green: "border-t-emerald-500 bg-emerald-50/40",
  amber: "border-t-amber-500 bg-amber-50/40",
  red: "border-t-red-500 bg-red-50/40",
  neutral: "border-t-slate-300 bg-white",
} as const;
const VALUE_STYLES = {
  blue: "text-blue-700",
  green: "text-emerald-700",
  amber: "text-amber-700",
  red: "text-red-700",
  neutral: "text-slate-900",
} as const;
type Accent = keyof typeof ACCENT_STYLES;

// ── Generic UI bits ─────────────────────────────────────────────────────────
function StatCard({
  label,
  value,
  sub,
  accent = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: Accent;
}) {
  return (
    <div className={`rounded-lg border border-slate-200 border-t-2 p-4 ${ACCENT_STYLES[accent]}`}>
      <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
        {label}
      </p>
      <p className={`text-2xl font-bold leading-none ${VALUE_STYLES[accent]}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-1.5">{sub}</p>}
    </div>
  );
}

function Card({
  title,
  sub,
  children,
  className = "",
  headerRight,
}: {
  title: string;
  sub?: string;
  children: React.ReactNode;
  className?: string;
  headerRight?: React.ReactNode;
}) {
  return (
    <div className={`rounded-lg border border-slate-200 bg-white p-5 ${className}`}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
          {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
        </div>
        {headerRight && <div className="flex-shrink-0">{headerRight}</div>}
      </div>
      {children}
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
        active
          ? "bg-blue-600 text-white border-blue-600"
          : "bg-white text-slate-600 border-slate-300 hover:border-slate-400"
      }`}
    >
      {label}
    </button>
  );
}

function ChartTypeToggle<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { key: T; label: string }[];
}) {
  return (
    <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
      {options.map((o) => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
            value === o.key
              ? "bg-white text-slate-900 shadow-sm"
              : "text-slate-500 hover:text-slate-700"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── Formatting ──────────────────────────────────────────────────────────────
function fmtUsd(n: number, digits = 0) {
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits === 2 ? 2 : 0 })}`;
}
function fmt2(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Tile 1 — cost-per-order trend (line / bar / area) ────────────────────────
type TrendType = "line" | "bar" | "area";
function CostPerOrderChart({
  data,
  periodAvg,
  type,
}: {
  data: {
    weekLabel: string;
    weekLabelDisplay?: string;
    costPerOrder: number;
    rollingAvg: number | null;
    isPartial?: boolean;
  }[];
  periodAvg: number;
  type: TrendType;
}) {
  const firstNonZero = data.findIndex((d) => d.costPerOrder > 0);
  const visible = data.slice(firstNonZero >= 0 ? firstNonZero : 0).map((d) => ({
    ...d,
    weekLabel: d.weekLabelDisplay ?? d.weekLabel,
    // Split series so the partial point can be styled differently and the
    // rolling avg never reflects the in-progress week.
    costPerOrderComplete: d.isPartial ? null : d.costPerOrder,
    costPerOrderPartial: d.isPartial ? d.costPerOrder : null,
  }));
  const axisProps = {
    tick: { fontSize: 10, fill: "#94a3b8" },
    axisLine: false as const,
    tickLine: false as const,
  };
  const tooltip = (
    <Tooltip
      formatter={((v: unknown, name: unknown) => [fmtUsd(Number(v), 2), String(name)]) as never}
      contentStyle={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 11, color: "#0f172a" }}
      labelStyle={{ color: "#475569", fontWeight: 600, marginBottom: 4 }}
      itemStyle={{ color: "#0f172a", fontWeight: 600 }}
    />
  );
  const refLine = (
    <ReferenceLine
      y={periodAvg}
      stroke="#94a3b8"
      strokeDasharray="6 3"
      strokeWidth={1}
      label={{ value: `Avg ${fmtUsd(periodAvg, 2)}`, position: "insideTopRight", fontSize: 10, fill: "#94a3b8" }}
    />
  );

  return (
    <ResponsiveContainer width="100%" height={300}>
      {type === "line" ? (
        <ComposedChart data={visible} margin={{ top: 8, right: 20, bottom: 4, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
          <XAxis dataKey="weekLabel" {...axisProps} interval={Math.floor(visible.length / 8)} />
          <YAxis {...axisProps} tickFormatter={(v) => fmtUsd(v, 0)} width={48} domain={[0, "auto"]} />
          {tooltip}
          <Legend wrapperStyle={{ fontSize: 11, paddingTop: 12 }} iconType="circle" iconSize={7} />
          {refLine}
          <Line type="monotone" dataKey="costPerOrderComplete" stroke="#3b82f6" strokeWidth={2.5} dot={false} activeDot={{ r: 5 }} name="Cost / order" connectNulls={false} />
          <Line type="monotone" dataKey="costPerOrderPartial" stroke="#94a3b8" strokeWidth={2} strokeDasharray="4 3" dot={{ r: 3, fill: "#94a3b8", strokeWidth: 0 }} activeDot={{ r: 5 }} name="In progress" />
          <Line type="monotone" dataKey="rollingAvg" stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="5 3" dot={false} name="4-wk avg" connectNulls />
        </ComposedChart>
      ) : type === "area" ? (
        <ComposedChart data={visible} margin={{ top: 8, right: 20, bottom: 4, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
          <XAxis dataKey="weekLabel" {...axisProps} interval={Math.floor(visible.length / 8)} />
          <YAxis {...axisProps} tickFormatter={(v) => fmtUsd(v, 0)} width={48} domain={[0, "auto"]} />
          {tooltip}
          <Legend wrapperStyle={{ fontSize: 11, paddingTop: 12 }} iconType="circle" iconSize={7} />
          {refLine}
          <Area type="monotone" dataKey="costPerOrderComplete" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.18} strokeWidth={2} name="Cost / order" connectNulls={false} />
          <Line type="monotone" dataKey="costPerOrderPartial" stroke="#94a3b8" strokeWidth={2} strokeDasharray="4 3" dot={{ r: 3, fill: "#94a3b8", strokeWidth: 0 }} name="In progress" />
        </ComposedChart>
      ) : (
        <BarChart data={visible} margin={{ top: 8, right: 20, bottom: 4, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
          <XAxis dataKey="weekLabel" {...axisProps} interval={Math.floor(visible.length / 8)} />
          <YAxis {...axisProps} tickFormatter={(v) => fmtUsd(v, 0)} width={48} domain={[0, "auto"]} />
          {tooltip}
          <Legend wrapperStyle={{ fontSize: 11, paddingTop: 12 }} iconType="circle" iconSize={7} />
          {refLine}
          <Bar dataKey="costPerOrder" radius={[3, 3, 0, 0]} maxBarSize={20} name="Cost / order">
            {visible.map((d, i) => (
              <Cell key={i} fill={d.isPartial ? "#cbd5e1" : "#3b82f6"} />
            ))}
          </Bar>
        </BarChart>
      )}
    </ResponsiveContainer>
  );
}

// ── Tile 2 — cost per issue type (horizontal bar / vertical bar / donut) ─────
type IssueTypeChartType = "bar-h" | "bar-v" | "donut";
const TYPE_COLORS = ["#8b5cf6", "#3b82f6", "#f59e0b", "#10b981", "#ec4899", "#ef4444", "#14b8a6", "#a855f7"];
function CostByTypeChart({
  data,
  type,
}: {
  data: { category: string; totalCost: number; count: number; avgCost: number }[];
  type: IssueTypeChartType;
}) {
  if (type === "donut") {
    return (
      <ResponsiveContainer width="100%" height={320}>
        <PieChart>
          <Pie
            data={data}
            dataKey="totalCost"
            nameKey="category"
            innerRadius={70}
            outerRadius={110}
            paddingAngle={2}
            label={((p: { name?: string; percent?: number }) =>
              `${p.name ?? ""} ${fmt2((p.percent ?? 0) * 100)}%`) as never}
            labelLine={false}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={TYPE_COLORS[i % TYPE_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            formatter={((v: unknown, n: unknown) => [fmtUsd(Number(v)), String(n)]) as never}
            contentStyle={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 11, color: "#0f172a" }}
      labelStyle={{ color: "#475569", fontWeight: 600, marginBottom: 4 }}
      itemStyle={{ color: "#0f172a", fontWeight: 600 }}
          />
        </PieChart>
      </ResponsiveContainer>
    );
  }

  const max = Math.max(...data.map((d) => d.totalCost), 1);
  if (type === "bar-v") {
    return (
      <ResponsiveContainer width="100%" height={320}>
        <BarChart data={data} margin={{ top: 8, right: 16, bottom: 32, left: 16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
          <XAxis
            dataKey="category"
            tick={{ fontSize: 10, fill: "#475569" }}
            axisLine={false}
            tickLine={false}
            angle={-15}
            textAnchor="end"
            height={50}
          />
          <YAxis
            tick={{ fontSize: 10, fill: "#94a3b8" }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => fmtUsd(v)}
            width={60}
            domain={[0, max * 1.1]}
          />
          <Tooltip
            formatter={((v: unknown) => fmtUsd(Number(v))) as never}
            contentStyle={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 11, color: "#0f172a" }}
      labelStyle={{ color: "#475569", fontWeight: 600, marginBottom: 4 }}
      itemStyle={{ color: "#0f172a", fontWeight: 600 }}
          />
          <Bar dataKey="totalCost" radius={[4, 4, 0, 0]} maxBarSize={48}>
            {data.map((_, i) => (
              <Cell key={i} fill={TYPE_COLORS[i % TYPE_COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    );
  }

  // horizontal bar
  return (
    <ResponsiveContainer width="100%" height={Math.max(180, data.length * 38)}>
      <BarChart layout="vertical" data={data} margin={{ top: 0, right: 48, bottom: 0, left: 8 }}>
        <XAxis
          type="number"
          tick={{ fontSize: 10, fill: "#94a3b8" }}
          tickFormatter={(v) => fmtUsd(v)}
          axisLine={false}
          tickLine={false}
          domain={[0, max * 1.1]}
        />
        <YAxis
          type="category"
          dataKey="category"
          width={155}
          tick={{ fontSize: 11, fill: "#475569" }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          formatter={((v: unknown) => fmtUsd(Number(v))) as never}
          cursor={{ fill: "#f1f5f9" }}
          contentStyle={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 11, color: "#0f172a" }}
      labelStyle={{ color: "#475569", fontWeight: 600, marginBottom: 4 }}
      itemStyle={{ color: "#0f172a", fontWeight: 600 }}
        />
        <Bar dataKey="totalCost" radius={[0, 4, 4, 0]} maxBarSize={22}>
          {data.map((_, i) => (
            <Cell key={i} fill={TYPE_COLORS[i % TYPE_COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Tile 3 — issues & orders (bar+line / lines / bars) ───────────────────────
type IssuesOrdersType = "composed" | "lines" | "bars";
function IssuesVsOrders({
  data,
  type,
}: {
  data: {
    weekLabel: string;
    issues: number;
    orders: number;
    ratePer1k: number | null;
    isPartial: boolean;
  }[];
  type: IssuesOrdersType;
}) {
  const axis = {
    tick: { fontSize: 10, fill: "#94a3b8" },
    axisLine: false as const,
    tickLine: false as const,
  };
  const tooltip = (
    <Tooltip
      formatter={((v: unknown, name: unknown) => {
        const num = Number(v);
        return name === "Issues / 1k orders"
          ? [fmt2(num), String(name)]
          : [num.toLocaleString(), String(name)];
      }) as never}
      contentStyle={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 11, color: "#0f172a" }}
      labelStyle={{ color: "#475569", fontWeight: 600, marginBottom: 4 }}
      itemStyle={{ color: "#0f172a", fontWeight: 600 }}
    />
  );
  const xAxis = (
    <XAxis
      dataKey="weekLabel"
      {...axis}
      interval={Math.max(1, Math.floor(data.length / 10))}
    />
  );
  const leftY = <YAxis yAxisId="left" {...axis} width={40} />;
  const rightY = (
    <YAxis
      yAxisId="right"
      orientation="right"
      {...axis}
      width={48}
      tickFormatter={(v) => fmt2(v)}
    />
  );
  const legend = <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} iconType="circle" iconSize={7} />;

  if (type === "lines") {
    return (
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
          {xAxis}
          {leftY}
          {rightY}
          {tooltip}
          {legend}
          <Line yAxisId="left" type="monotone" dataKey="orders" stroke="#3b82f6" strokeWidth={2} dot={false} name="Orders" />
          <Line yAxisId="left" type="monotone" dataKey="issues" stroke="#f59e0b" strokeWidth={2} dot={false} name="Issues" />
          <Line yAxisId="right" type="monotone" dataKey="ratePer1k" stroke="#dc2626" strokeWidth={2} dot={false} name="Issues / 1k orders" />
        </LineChart>
      </ResponsiveContainer>
    );
  }

  if (type === "bars") {
    return (
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
          {xAxis}
          {leftY}
          {rightY}
          {tooltip}
          {legend}
          <Bar yAxisId="left" dataKey="orders" radius={[3, 3, 0, 0]} maxBarSize={16} name="Orders">
            {data.map((d, i) => (
              <Cell key={i} fill={d.isPartial ? "#e2e8f0" : "#bfdbfe"} />
            ))}
          </Bar>
          <Bar yAxisId="left" dataKey="issues" radius={[3, 3, 0, 0]} maxBarSize={16} name="Issues">
            {data.map((d, i) => (
              <Cell key={i} fill={d.isPartial ? "#fde68a" : "#f59e0b"} />
            ))}
          </Bar>
          <Bar yAxisId="right" dataKey="ratePer1k" fill="#dc2626" radius={[3, 3, 0, 0]} maxBarSize={16} name="Issues / 1k orders" />
        </BarChart>
      </ResponsiveContainer>
    );
  }

  // composed (default)
  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
        {xAxis}
        {leftY}
        {rightY}
        {tooltip}
        {legend}
        <Bar yAxisId="left" dataKey="orders" radius={[3, 3, 0, 0]} maxBarSize={20} name="Orders">
          {data.map((d, i) => (
            <Cell key={i} fill={d.isPartial ? "#e2e8f0" : "#bfdbfe"} />
          ))}
        </Bar>
        <Bar yAxisId="left" dataKey="issues" radius={[3, 3, 0, 0]} maxBarSize={20} name="Issues">
          {data.map((d, i) => (
            <Cell key={i} fill={d.isPartial ? "#fde68a" : "#f59e0b"} />
          ))}
        </Bar>
        <Line yAxisId="right" type="monotone" dataKey="ratePer1k" stroke="#dc2626" strokeWidth={2} dot={false} name="Issues / 1k orders" connectNulls={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────
export default function CostPage() {
  const [ops, setOps] = useState<OpsTicket[]>([]);
  const [shipments, setShipments] = useState<ShipmentWeek[]>([]);
  const [weeklyCost, setWeeklyCost] = useState<WeeklyCostPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeShipping, setActiveShipping] = useState<ShippingCategory[]>([]);
  const { dateFrom, dateTo, setDateFrom, setDateTo } = useFilterStore();

  // chart-type toggles
  const [trendType, setTrendType] = useState<TrendType>("line");
  const [byTypeChart, setByTypeChart] = useState<IssueTypeChartType>("bar-h");
  const [issuesOrdersType, setIssuesOrdersType] = useState<IssuesOrdersType>("composed");

  useEffect(() => {
    Promise.all([fetchOpsTickets(), fetchShipments(), fetchWeeklyCostPerOrder()])
      .then(([o, s, w]) => {
        setOps(o);
        setShipments(s);
        setWeeklyCost(w);
        setLoading(false);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "Failed to load data");
        setLoading(false);
      });
  }, []);

  const toggleShipping = (c: ShippingCategory) => {
    setActiveShipping((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]
    );
  };

  const filteredOps = useMemo(
    () =>
      ops.filter((t) => {
        if (!t.date) return false;
        if (dateFrom && t.date < dateFrom) return false;
        if (dateTo && t.date > dateTo) return false;
        return true;
      }),
    [ops, dateFrom, dateTo]
  );
  const filteredShipments = useMemo(
    () =>
      shipments.filter((s) => {
        if (dateFrom && s.weekEnd < dateFrom) return false;
        if (dateTo && s.weekStart > dateTo) return false;
        return true;
      }),
    [shipments, dateFrom, dateTo]
  );
  const filteredWeeklyCost = useMemo(
    () =>
      weeklyCost.filter((p) => {
        if (dateFrom && p.weekStart < dateFrom) return false;
        if (dateTo && p.weekStart > dateTo) return false;
        return true;
      }),
    [weeklyCost, dateFrom, dateTo]
  );

  // Detect partial weeks once from shipment data — used for all transforms.
  const partialWeeks = useMemo(
    () => detectPartialWeeksFromShipments(filteredShipments),
    [filteredShipments]
  );

  // Charts include partial weeks (visually distinguished) — pass partial set for marking.
  const trend = useMemo(
    () => withRollingAvg(filteredWeeklyCost, 4, partialWeeks),
    [filteredWeeklyCost, partialWeeks]
  );
  const issuesOrders = useMemo(
    () => weeklyIssuesAndOrders(filteredOps, filteredShipments, activeShipping, partialWeeks),
    [filteredOps, filteredShipments, activeShipping, partialWeeks]
  );

  // KPIs / aggregates use partial weeks to filter out incomplete data.
  const kpis = useMemo(
    () => costKpis(filteredWeeklyCost, filteredOps, partialWeeks),
    [filteredWeeklyCost, filteredOps, partialWeeks]
  );
  const byType = useMemo(() => opsCostByCategory(filteredOps, activeShipping), [filteredOps, activeShipping]);
  const impact = useMemo(
    () => boxCostImpact(filteredOps, filteredShipments, activeShipping, partialWeeks),
    [filteredOps, filteredShipments, activeShipping, partialWeeks]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400 text-sm">
        Loading cost data…
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex items-center justify-center h-64 text-red-500 text-sm">{error}</div>
    );
  }

  const impactDelta = impact.currentImpact - impact.priorImpact;
  const impactDeltaPct =
    impact.priorImpact > 0 ? (impactDelta / impact.priorImpact) * 100 : 0;
  // 4-wk avg delta: compare last 4 weeks to prior 4 weeks
  const avg4wDelta = kpis.avg4w - kpis.prior4wAvg;
  // Latest delta: compare latest week to prior 4-week avg
  const latestDelta = kpis.latest - kpis.prior4wAvg;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="px-6 py-6 max-w-screen-xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">Cost of Issues</h1>
            <p className="text-xs text-slate-400 mt-0.5">
              Issue cost per order and cost per issue type.
            </p>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse inline-block" />
            Live
          </div>
        </div>

        <p className="text-[11px] text-slate-500 -mt-2">
          Trailing weeks with abnormally low order counts (partial weeks) are shown on charts in grey/dashed (labelled <em>in progress</em>) but excluded from KPIs, deltas, and totals.
        </p>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 bg-white border border-slate-200 rounded-lg p-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wide">Date</span>
            <input
              type="date"
              value={dateFrom ? dateFrom.toISOString().slice(0, 10) : ""}
              onChange={(e) => setDateFrom(e.target.value ? new Date(e.target.value) : null)}
              className="border border-slate-300 rounded-md px-2 py-1 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
            />
            <span className="text-xs text-slate-400">to</span>
            <input
              type="date"
              value={dateTo ? dateTo.toISOString().slice(0, 10) : ""}
              onChange={(e) => setDateTo(e.target.value ? new Date(e.target.value) : null)}
              className="border border-slate-300 rounded-md px-2 py-1 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
            />
          </div>

          <div className="h-4 w-px bg-slate-200 hidden sm:block" />

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wide">Shipping issue</span>
            {SHIPPING_CATEGORIES.map((c) => (
              <FilterChip
                key={c}
                label={c}
                active={activeShipping.includes(c)}
                onClick={() => toggleShipping(c)}
              />
            ))}
          </div>

          {(activeShipping.length > 0 || dateFrom || dateTo) && (
            <button
              onClick={() => {
                setActiveShipping([]);
                setDateFrom(null);
                setDateTo(null);
              }}
              className="ml-auto text-xs text-slate-500 hover:text-slate-800"
            >
              Reset filters
            </button>
          )}
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <StatCard
            label="Latest issue cost / order"
            value={fmtUsd(kpis.latest, 2)}
            sub={
              kpis.prior4wAvg > 0
                ? `${latestDelta < 0 ? "↓" : "↑"} ${fmtUsd(Math.abs(latestDelta), 2)} vs prior 4-wk avg`
                : `Week of ${kpis.latestLabel}`
            }
            accent={latestDelta < 0 ? "green" : "amber"}
          />
          <StatCard
            label="4-wk avg"
            value={fmtUsd(kpis.avg4w, 2)}
            sub={
              kpis.prior4wAvg > 0
                ? `${avg4wDelta < 0 ? "↓" : "↑"} ${fmtUsd(Math.abs(avg4wDelta), 2)} vs prior 4-wk avg`
                : "4-week rolling average"
            }
            accent={avg4wDelta < 0 ? "green" : "amber"}
          />
          <StatCard
            label="Box cost impact"
            value={fmtUsd(impact.currentImpact, 2)}
            sub={
              impact.priorImpact > 0
                ? `${impactDelta >= 0 ? "↑" : "↓"} ${fmt2(Math.abs(impactDeltaPct))}% vs prior 4-wk`
                : "issue $ ÷ orders"
            }
            accent={impactDelta < 0 ? "green" : "amber"}
          />
          <StatCard
            label="Total issue cost"
            value={fmtUsd(impact.totalIssueCost)}
            sub={`Across ${impact.totalOrders.toLocaleString()} orders`}
            accent="neutral"
          />
          <StatCard
            label="Total issues"
            value={kpis.totalIssues.toLocaleString()}
            sub={
              activeShipping.length > 0
                ? `Filter: ${activeShipping.join(", ")}`
                : "All issue types"
            }
            accent="neutral"
          />
        </div>

        {/* Tile 1 */}
        <Card
          title="Cost of issues per order, weekly"
          sub="Resolution $ ÷ orders shipped. Down = good. Filter chips above don't apply here — this is the raw PnL signal."
          headerRight={
            <ChartTypeToggle
              value={trendType}
              onChange={setTrendType}
              options={[
                { key: "line", label: "Line" },
                { key: "area", label: "Area" },
                { key: "bar", label: "Bar" },
              ]}
            />
          }
        >
          <CostPerOrderChart data={trend} periodAvg={kpis.periodAvg} type={trendType} />
        </Card>

        {/* Tile 2 */}
        <Card
          title="Cost per issue type"
          sub="Total resolution $ by issue category. Cost values are estimated from resolution-string keyword matching."
          headerRight={
            <ChartTypeToggle
              value={byTypeChart}
              onChange={setByTypeChart}
              options={[
                { key: "bar-h", label: "Horiz" },
                { key: "bar-v", label: "Vert" },
                { key: "donut", label: "Donut" },
              ]}
            />
          }
        >
          {byType.length === 0 ? (
            <div className="text-center text-slate-400 text-xs py-12">
              No issues match the current filter.
            </div>
          ) : (
            <>
              <CostByTypeChart data={byType} type={byTypeChart} />
              <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                {byType.slice(0, 4).map((b) => (
                  <div
                    key={b.category}
                    className="rounded border border-slate-100 bg-slate-50/60 px-3 py-2"
                  >
                    <p className="text-[10px] uppercase tracking-wide text-slate-400">
                      {b.category}
                    </p>
                    <p className="font-semibold text-slate-700 mt-0.5">
                      {b.count} issues · avg {fmtUsd(b.avgCost, 2)}
                    </p>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>

        {/* Tile 3 */}
        <Card
          title="Issues & orders, weekly"
          sub="Orders (blue) vs. issues (amber) per week. Red line = issues per 1,000 orders (2dp)."
          headerRight={
            <ChartTypeToggle
              value={issuesOrdersType}
              onChange={setIssuesOrdersType}
              options={[
                { key: "composed", label: "Bars + line" },
                { key: "lines", label: "Lines" },
                { key: "bars", label: "Bars" },
              ]}
            />
          }
        >
          <IssuesVsOrders data={issuesOrders} type={issuesOrdersType} />
        </Card>

        {/* Tile 4 — table */}
        <Card title="Issue type detail" sub="Cost breakdown by issue category">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                    Issue type
                  </th>
                  <th className="px-3 py-2 text-right text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                    Count
                  </th>
                  <th className="px-3 py-2 text-right text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                    Total $
                  </th>
                  <th className="px-3 py-2 text-right text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                    Avg $
                  </th>
                  <th className="px-3 py-2 text-right text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                    % of cost
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {(() => {
                  const total = byType.reduce((s, x) => s + x.totalCost, 0);
                  return byType.map((b) => {
                    const pct = total > 0 ? (b.totalCost / total) * 100 : 0;
                    return (
                      <tr key={b.category} className="hover:bg-slate-50/60">
                        <td className="px-3 py-2 text-xs font-medium text-slate-800">{b.category}</td>
                        <td className="px-3 py-2 text-xs text-slate-600 text-right">{b.count.toLocaleString()}</td>
                        <td className="px-3 py-2 text-xs font-semibold text-slate-800 text-right">{fmtUsd(b.totalCost, 2)}</td>
                        <td className="px-3 py-2 text-xs text-slate-600 text-right">{fmtUsd(b.avgCost, 2)}</td>
                        <td className="px-3 py-2 text-xs text-slate-500 text-right">{fmt2(pct)}%</td>
                      </tr>
                    );
                  });
                })()}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
