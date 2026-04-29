"use client";

import { useEffect, useState, useMemo } from "react";
import { fetchFoodSafety } from "@/lib/data";
import { applyFoodSafetyFilters } from "@/lib/filters";
import {
  foodSafetyKpis,
  skuPareto,
  concernBreakdown,
  weeklyComplaintTrend,
  monthlyComplaintTrend,
  dailyComplaintTrend,
} from "@/lib/transforms";
import { useFilterStore } from "@/lib/store";
import type { FoodSafetyTicket } from "@/lib/types";
import FilterBar from "@/components/filters/FilterBar";
import HorizontalBar from "@/components/charts/HorizontalBar";
import WeeklyTrend from "@/components/charts/WeeklyTrend";
import DonutChart from "@/components/charts/DonutChart";

type TimePeriod = "daily" | "weekly" | "monthly" | "quarterly";

// ── Stat card ─────────────────────────────────────────────────────────────────
interface StatProps {
  label: string;
  value: string;
  sub?: string;
  accent?: "blue" | "green" | "amber" | "red" | "neutral";
}

const ACCENT_STYLES = {
  blue: "border-t-blue-500 bg-blue-50/40",
  green: "border-t-emerald-500 bg-emerald-50/40",
  amber: "border-t-amber-500 bg-amber-50/40",
  red: "border-t-red-500 bg-red-50/40",
  neutral: "border-t-slate-300 bg-white",
};
const VALUE_STYLES = {
  blue: "text-blue-700",
  green: "text-emerald-700",
  amber: "text-amber-700",
  red: "text-red-700",
  neutral: "text-slate-900",
};

function StatCard({ label, value, sub, accent = "neutral" }: StatProps) {
  return (
    <div
      className={`rounded-lg border border-slate-200 border-t-2 p-4 ${ACCENT_STYLES[accent]}`}
    >
      <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
        {label}
      </p>
      <p className={`text-2xl font-bold leading-none ${VALUE_STYLES[accent]}`}>
        {value}
      </p>
      {sub && <p className="text-xs text-slate-400 mt-1.5">{sub}</p>}
    </div>
  );
}

// ── Card wrapper ──────────────────────────────────────────────────────────────
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

// ── Time period selector ─────────────────────────────────────────────────────
function PeriodSelector({
  value,
  onChange,
}: {
  value: TimePeriod;
  onChange: (p: TimePeriod) => void;
}) {
  const periods: { key: TimePeriod; label: string }[] = [
    { key: "daily", label: "Daily" },
    { key: "weekly", label: "Weekly" },
    { key: "monthly", label: "Monthly" },
    { key: "quarterly", label: "Quarterly" },
  ];
  return (
    <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
      {periods.map((p) => (
        <button
          key={p.key}
          onClick={() => onChange(p.key)}
          className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
            value === p.key
              ? "bg-white text-slate-900 shadow-sm"
              : "text-slate-500 hover:text-slate-700"
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

// ── Ticket table ──────────────────────────────────────────────────────────────
function TicketTable({ tickets }: { tickets: FoodSafetyTicket[] }) {
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<keyof FoodSafetyTicket>("dateOfComplaint");
  const [sortAsc, setSortAsc] = useState(false);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return tickets.filter(
      (t) =>
        !q ||
        (t.shopifyOrderNumber ?? "").toLowerCase().includes(q) ||
        (t.customerName ?? "").toLowerCase().includes(q) ||
        (t.skuInQuestion ?? "").toLowerCase().includes(q) ||
        (t.perceivedConcern ?? "").toLowerCase().includes(q) ||
        (t.correctiveAction ?? "").toLowerCase().includes(q)
    );
  }, [tickets, search]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const av = a[sortField],
        bv = b[sortField];
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av instanceof Date && bv instanceof Date)
        return sortAsc ? av.getTime() - bv.getTime() : bv.getTime() - av.getTime();
      if (typeof av === "number" && typeof bv === "number")
        return sortAsc ? av - bv : bv - av;
      return sortAsc
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });
  }, [filtered, sortField, sortAsc]);

  function handleSort(field: keyof FoodSafetyTicket) {
    if (sortField === field) setSortAsc((v) => !v);
    else {
      setSortField(field);
      setSortAsc(false);
    }
  }

  function fmtDate(d: Date | null) {
    if (!d) return "—";
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
  }

  const Th = ({
    label,
    field,
    w,
  }: {
    label: string;
    field: keyof FoodSafetyTicket;
    w?: string;
  }) => (
    <th
      onClick={() => handleSort(field)}
      className={`px-3 py-2.5 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider cursor-pointer whitespace-nowrap select-none hover:text-slate-800 transition-colors ${w ?? ""}`}
    >
      {label}
      {sortField === field && <span className="ml-1 text-blue-500">{sortAsc ? "↑" : "↓"}</span>}
    </th>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <svg
            className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            type="text"
            placeholder="Search by order #, customer, SKU, concern…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full border border-slate-300 rounded-md pl-8 pr-3 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
          />
        </div>
        <span className="text-xs text-slate-400 shrink-0">{sorted.length} records</span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 max-h-[600px] overflow-y-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
            <tr>
              <Th label="Shopify #" field="shopifyOrderNumber" w="w-24" />
              <Th label="Date" field="dateOfComplaint" w="w-24" />
              <Th label="Customer" field="customerName" />
              <Th label="SKU" field="skuInQuestion" />
              <Th label="Packaging" field="packagingType" />
              <Th label="Concern" field="perceivedConcern" />
              <Th label="Action" field="correctiveAction" />
              <Th label="Cost" field="resolutionCost" w="w-16" />
              <Th label="Status" field="isResolved" w="w-20" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {sorted.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-10 text-center text-slate-400 text-sm">
                  No tickets match the current filters
                </td>
              </tr>
            )}
            {sorted.map((t, i) => (
              <tr key={i} className="hover:bg-slate-50/60 transition-colors group">
                <td className="px-3 py-2 font-mono text-[11px] text-slate-500">
                  {t.gorgiasLink ? (
                    <a
                      href={t.gorgiasLink}
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-600 hover:text-blue-800 hover:underline"
                    >
                      {t.shopifyOrderNumber
                        ? `#${t.shopifyOrderNumber.replace(/[^0-9]/g, "")}`
                        : "—"}
                    </a>
                  ) : (
                    t.shopifyOrderNumber
                      ? `#${t.shopifyOrderNumber.replace(/[^0-9]/g, "")}`
                      : "—"
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-slate-500 whitespace-nowrap">
                  {fmtDate(t.dateOfComplaint)}
                </td>
                <td className="px-3 py-2 text-xs text-slate-800 max-w-[130px] truncate font-medium">
                  {t.customerName ?? "—"}
                </td>
                <td
                  className="px-3 py-2 text-[11px] text-slate-600 max-w-[130px] truncate"
                  title={t.skuInQuestion ?? ""}
                >
                  {t.skuInQuestion ?? "—"}
                </td>
                <td className="px-3 py-2 text-[11px] text-slate-500 whitespace-nowrap">
                  {t.packagingType ?? "—"}
                </td>
                <td
                  className="px-3 py-2 text-[11px] text-slate-600 max-w-[200px] truncate"
                  title={t.perceivedConcern ?? ""}
                >
                  {t.perceivedConcern ?? "—"}
                </td>
                <td
                  className="px-3 py-2 text-[11px] text-slate-600 max-w-[180px] truncate"
                  title={t.correctiveAction ?? ""}
                >
                  {t.correctiveAction ?? "—"}
                </td>
                <td className="px-3 py-2 text-xs font-semibold text-slate-700 whitespace-nowrap">
                  {t.resolutionCost > 0 ? (
                    `$${t.resolutionCost.toFixed(0)}`
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                      t.isResolved ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        t.isResolved ? "bg-emerald-500" : "bg-amber-400"
                      }`}
                    />
                    {t.isResolved ? "Resolved" : "Open"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function FoodSafetyPage() {
  const [allTickets, setAllTickets] = useState<FoodSafetyTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [timePeriod, setTimePeriod] = useState<TimePeriod>("weekly");
  const filters = useFilterStore();

  useEffect(() => {
    fetchFoodSafety()
      .then((data) => {
        setAllTickets(data);
        const latest = data
          .map((t) => t.dateOfComplaint)
          .filter((d): d is Date => d instanceof Date)
          .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
        setLastUpdated(latest);
        setLoading(false);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "Failed to load data");
        setLoading(false);
      });
  }, []);

  const tickets = useMemo(() => applyFoodSafetyFilters(allTickets, filters), [allTickets, filters]);
  const kpis = useMemo(() => foodSafetyKpis(tickets), [tickets]);
  const sku = useMemo(() => skuPareto(tickets, 10), [tickets]);
  const concerns = useMemo(() => concernBreakdown(tickets), [tickets]);

  // Time-based trends for the chart
  const trendData = useMemo(() => {
    switch (timePeriod) {
      case "daily":
        return dailyComplaintTrend(tickets);
      case "weekly":
        return weeklyComplaintTrend(tickets);
      case "monthly":
      case "quarterly":
        return monthlyComplaintTrend(tickets);
      default:
        return weeklyComplaintTrend(tickets);
    }
  }, [tickets, timePeriod]);

  if (loading)
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-2 text-slate-400 text-sm">
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          Loading food safety data…
        </div>
      </div>
    );

  if (error) return <div className="flex items-center justify-center h-64 text-red-500 text-sm">{error}</div>;

  const resolvedPct =
    kpis.totalComplaints > 0 ? ((kpis.resolved / kpis.totalComplaints) * 100).toFixed(0) : "0";

  return (
    <div className="min-h-screen bg-slate-50">
      <FilterBar />

      <div className="px-6 py-6 max-w-screen-xl mx-auto space-y-6">
        {/* Page header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">Food Safety Complaints</h1>
            <p className="text-xs text-slate-400 mt-0.5">
              {allTickets.length} total records
              {lastUpdated &&
                ` · most recent complaint ${lastUpdated.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`}
            </p>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse inline-block" />
            Live
          </div>
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard
            label="Complaints"
            value={kpis.totalComplaints.toString()}
            sub="in period"
            accent="blue"
          />
          <StatCard
            label="Total Cost"
            value={`$${kpis.totalCost.toLocaleString("en-US", { maximumFractionDigits: 0 })}`}
            sub="resolution cost"
            accent="neutral"
          />
          <StatCard
            label="Avg Cost"
            value={`$${kpis.avgCost.toFixed(0)}`}
            sub="per complaint"
            accent="neutral"
          />
          <StatCard
            label="Resolved"
            value={kpis.resolved.toString()}
            sub={`${resolvedPct}% of total`}
            accent="green"
          />
          <StatCard
            label="Open"
            value={kpis.unresolved.toString()}
            sub="awaiting action"
            accent={kpis.unresolved > 10 ? "amber" : "neutral"}
          />
          <StatCard label="Top Concern" value={kpis.mostCommonConcern} sub="most frequent" accent="neutral" />
        </div>

        {/* Trend + concern breakdown */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          <Card
            title="Complaints & Cost Over Time"
            sub="Bars = count, dashed line = cost"
            className="lg:col-span-3"
            headerRight={<PeriodSelector value={timePeriod} onChange={setTimePeriod} />}
          >
            <WeeklyTrend data={trendData} />
          </Card>
          <Card title="Concern Breakdown" sub="By complaint count" className="lg:col-span-2">
            <DonutChart data={concerns.map((c) => ({ name: c.concern, value: c.count }))} />
          </Card>
        </div>

        {/* SKU pareto - always shown */}
        <Card title="Top 10 SKUs by Complaint Count" sub="Weekly ranking by total complaint count">
          <HorizontalBar data={sku.map((s) => ({ label: s.sku, value: s.count }))} color="#3b82f6" />
        </Card>

        {/* Ticket table */}
        <Card title="Complaint Log" sub="Click a Shopify order number to open the Gorgias ticket">
          <TicketTable tickets={tickets} />
        </Card>
      </div>
    </div>
  );
}
