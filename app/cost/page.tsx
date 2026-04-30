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
  opsCostByCategory,
  weeklyIssuesAndOrders,
  withRollingAvg,
} from "@/lib/transforms";
import type { OpsTicket, ShipmentWeek, ShippingCategory, WeeklyCostPoint } from "@/lib/types";
import CostTrendLine from "@/components/charts/CostTrendLine";
import HorizontalBar from "@/components/charts/HorizontalBar";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
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
      <div className="mb-4 flex items-start justify-between">
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

function fmtUsd(n: number, digits = 0) {
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: digits })}`;
}

function IssuesVsOrders({
  data,
}: {
  data: { weekLabel: string; issues: number; orders: number; ratePer1k: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
        <XAxis
          dataKey="weekLabel"
          tick={{ fontSize: 10, fill: "#94a3b8" }}
          axisLine={false}
          tickLine={false}
          interval={Math.max(1, Math.floor(data.length / 10))}
        />
        <YAxis
          yAxisId="left"
          tick={{ fontSize: 10, fill: "#94a3b8" }}
          axisLine={false}
          tickLine={false}
          width={40}
        />
        <YAxis
          yAxisId="right"
          orientation="right"
          tick={{ fontSize: 10, fill: "#94a3b8" }}
          axisLine={false}
          tickLine={false}
          width={36}
          tickFormatter={(v) => `${v}`}
        />
        <Tooltip
          contentStyle={{
            background: "white",
            border: "1px solid #e2e8f0",
            borderRadius: 6,
            fontSize: 11,
          }}
        />
        <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} iconType="circle" iconSize={7} />
        <Bar
          yAxisId="left"
          dataKey="orders"
          fill="#bfdbfe"
          radius={[3, 3, 0, 0]}
          maxBarSize={20}
          name="Orders"
        />
        <Bar
          yAxisId="left"
          dataKey="issues"
          fill="#f59e0b"
          radius={[3, 3, 0, 0]}
          maxBarSize={20}
          name="Issues"
        />
        <Line
          yAxisId="right"
          type="monotone"
          dataKey="ratePer1k"
          stroke="#dc2626"
          strokeWidth={2}
          dot={false}
          name="Issues / 1k orders"
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export default function CostPage() {
  const [ops, setOps] = useState<OpsTicket[]>([]);
  const [shipments, setShipments] = useState<ShipmentWeek[]>([]);
  const [weeklyCost, setWeeklyCost] = useState<WeeklyCostPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeShipping, setActiveShipping] = useState<ShippingCategory[]>([]);

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

  const trend = useMemo(() => withRollingAvg(weeklyCost, 4), [weeklyCost]);
  const kpis = useMemo(() => costKpis(weeklyCost, ops), [weeklyCost, ops]);
  const byType = useMemo(() => opsCostByCategory(ops, activeShipping), [ops, activeShipping]);
  const issuesOrders = useMemo(
    () => weeklyIssuesAndOrders(ops, shipments, activeShipping),
    [ops, shipments, activeShipping]
  );
  const impact = useMemo(
    () => boxCostImpact(ops, shipments, activeShipping),
    [ops, shipments, activeShipping]
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

  const trendDelta = kpis.latest - kpis.avg4w;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="px-6 py-6 max-w-screen-xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">Cost of Issues</h1>
            <p className="text-xs text-slate-400 mt-0.5">
              Issue cost per order and cost per issue type — the trend Kurt watches for PnL impact.
            </p>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse inline-block" />
            Live
          </div>
        </div>

        {/* Shipping classification filter */}
        <div className="flex flex-wrap items-center gap-2 bg-white border border-slate-200 rounded-lg p-3">
          <span className="text-xs font-medium text-slate-400 uppercase tracking-wide mr-2">
            Filter by shipping issue
          </span>
          {SHIPPING_CATEGORIES.map((c) => (
            <FilterChip
              key={c}
              label={c}
              active={activeShipping.includes(c)}
              onClick={() => toggleShipping(c)}
            />
          ))}
          {activeShipping.length > 0 && (
            <button
              onClick={() => setActiveShipping([])}
              className="ml-auto text-xs text-slate-500 hover:text-slate-800"
            >
              Clear
            </button>
          )}
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <StatCard
            label="Latest issue cost / order"
            value={fmtUsd(kpis.latest, 2)}
            sub={`Week of ${kpis.latestLabel}`}
            accent="blue"
          />
          <StatCard
            label="4-wk avg"
            value={fmtUsd(kpis.avg4w, 2)}
            sub={
              trendDelta < 0
                ? `↓ ${fmtUsd(Math.abs(trendDelta), 2)} vs latest`
                : `↑ ${fmtUsd(trendDelta, 2)} vs latest`
            }
            accent={trendDelta < 0 ? "green" : "amber"}
          />
          <StatCard
            label="Box cost impact"
            value={fmtUsd(impact.currentImpact, 2)}
            sub={
              impact.priorImpact > 0
                ? `${impactDelta >= 0 ? "↑" : "↓"} ${Math.abs(impactDeltaPct).toFixed(0)}% vs prior half`
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

        {/* Tile 1 — headline cost-per-order trend (unfiltered) */}
        <Card
          title="Cost of issues per order, weekly"
          sub="Resolution $ ÷ orders shipped. Down = good. Filter chips above don't apply here — this is the raw PnL signal."
        >
          <CostTrendLine data={trend} periodAvg={kpis.periodAvg} />
        </Card>

        {/* Tile 2 — cost per issue type */}
        <Card
          title="Cost per issue type"
          sub="Total resolution $ by issue category. Sorted by total cost."
        >
          {byType.length === 0 ? (
            <div className="text-center text-slate-400 text-xs py-12">
              No issues match the current filter.
            </div>
          ) : (
            <>
              <HorizontalBar
                data={byType.map((b) => ({
                  label: b.category,
                  value: Math.round(b.totalCost),
                }))}
                color="#8b5cf6"
                formatter={(v) => fmtUsd(v)}
              />
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

        {/* Tile 3 — issues vs orders */}
        <Card
          title="Issues & orders, weekly"
          sub="Orders (blue) vs. issues (amber) per week. Red line = issues per 1,000 orders."
        >
          <IssuesVsOrders data={issuesOrders} />
        </Card>

        {/* Tile 4 — issue type detail table */}
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
                {byType.map((b) => {
                  const total = byType.reduce((s, x) => s + x.totalCost, 0);
                  const pct = total > 0 ? (b.totalCost / total) * 100 : 0;
                  return (
                    <tr key={b.category} className="hover:bg-slate-50/60">
                      <td className="px-3 py-2 text-xs font-medium text-slate-800">
                        {b.category}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-600 text-right">
                        {b.count.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-xs font-semibold text-slate-800 text-right">
                        {fmtUsd(b.totalCost)}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-600 text-right">
                        {fmtUsd(b.avgCost, 2)}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-500 text-right">
                        {pct.toFixed(1)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
