"use client";

import { Fragment, useCallback, useEffect, useRef, useState, useMemo } from "react";
import { fetchFoodSafety, fetchFoodSafetyMeta, type FoodSafetyMeta } from "@/lib/data";
import {
  foodSafetyKpis,
  concernBreakdown,
  concernCostImpact,
  weeklyComplaintTrend,
  monthlyComplaintTrend,
  dailyComplaintTrend,
} from "@/lib/transforms";
import { useFilterStore } from "@/lib/store";
import type { FoodSafetyTicket } from "@/lib/types";
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
  blue: "bg-blue-50/40",
  green: "bg-emerald-50/40",
  amber: "bg-amber-50/40",
  red: "bg-red-50/40",
  neutral: "bg-white",
};
const ACCENT_DOTS = {
  blue: "bg-blue-500",
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
  neutral: "bg-slate-300",
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
      className={`rounded-xl border border-slate-200 p-4 ${ACCENT_STYLES[accent]}`}
    >
      <p className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        <span className={`h-1.5 w-1.5 rounded-full ${ACCENT_DOTS[accent]}`} aria-hidden="true" />
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
    <div className={`rounded-xl border border-slate-200 bg-white p-5 ${className}`}>
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
    <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
      {periods.map((p) => (
        <button
          key={p.key}
          onClick={() => onChange(p.key)}
          className={`min-h-8 cursor-pointer rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${
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

// ── Reporting period selector ────────────────────────────────────────────────
const RANGE_PRESETS = [
  { key: "7d", label: "Last 7 days", days: 7 },
  { key: "30d", label: "Last 30 days", days: 30 },
  { key: "90d", label: "Last 90 days", days: 90 },
] as const;

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
function toInputValue(d: Date | null) {
  if (!d) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function sameDay(a: Date | null, b: Date | null) {
  return !!a && !!b && toInputValue(a) === toInputValue(b);
}
function fmtRangeDate(d: Date | null) {
  if (!d) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function DateRangeBar({
  dateFrom,
  dateTo,
  onChange,
  dataStart,
  dataEnd,
  count,
  includeArrivedWarm,
  onToggleArrivedWarm,
}: {
  dateFrom: Date | null;
  dateTo: Date | null;
  onChange: (from: Date | null, to: Date | null) => void;
  dataStart: Date | null;
  dataEnd: Date | null;
  count: number;
  includeArrivedWarm: boolean;
  onToggleArrivedWarm: () => void;
}) {
  const [customOpen, setCustomOpen] = useState(false);
  const fromRef = useRef<HTMLInputElement>(null);
  const toRef = useRef<HTMLInputElement>(null);
  const today = new Date();
  const isAll = !dateFrom && !dateTo;
  const activeKey = isAll
    ? "all"
    : RANGE_PRESETS.find((p) => {
        const from = startOfDay(new Date(today.getTime() - (p.days - 1) * 86400000));
        return sameDay(dateFrom, from) && sameDay(dateTo, today);
      })?.key ?? "custom";

  const applyPreset = (days: number) => {
    onChange(startOfDay(new Date(today.getTime() - (days - 1) * 86400000)), endOfDay(today));
  };

  const openPicker = (ref: React.RefObject<HTMLInputElement | null>) => {
    const input = ref.current as (HTMLInputElement & { showPicker?: () => void }) | null;
    input?.focus();
    try { input?.showPicker?.(); } catch { /* some browsers require direct input activation */ }
  };
  const openFromPicker = () => openPicker(fromRef);
  const openToPicker = () => openPicker(toRef);

  const chip = (key: string, label: string, onClick: () => void) => (
    <button
      key={key}
      onClick={onClick}
          className={`cursor-pointer rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${
        activeKey === key
          ? "bg-white text-slate-900 shadow-sm"
          : "text-slate-500 hover:text-slate-700"
      }`}
    >
      {label}
    </button>
  );

  const shownFrom = dateFrom ?? dataStart;
  const shownTo = dateTo ?? dataEnd;

  return (
    <div className="sticky top-0 z-20 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:px-6">
      <div className="flex items-center gap-2 shrink-0">
        <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.8}
            d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
          />
        </svg>
        <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
          Reporting period
        </span>
      </div>

      <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
        {RANGE_PRESETS.map((p) => chip(p.key, p.label, () => applyPreset(p.days)))}
        {chip("all", "All time", () => onChange(null, null))}
        {chip("custom", "Custom", () => setCustomOpen(true))}
      </div>

      {customOpen && (
        <div className="flex items-center gap-1.5">
          <input
            ref={fromRef}
            type="date"
            value={toInputValue(dateFrom)}
            max={toInputValue(dateTo) || undefined}
            onChange={(e) =>
              onChange(e.target.value ? startOfDay(new Date(`${e.target.value}T00:00:00`)) : null, dateTo)
            }
            aria-label="Custom reporting period from date"
            onClick={openFromPicker}
            className="h-8 w-[132px] rounded-md border border-slate-300 px-2 text-xs text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
          />
          <span className="text-xs text-slate-400">to</span>
          <input
            ref={toRef}
            type="date"
            value={toInputValue(dateTo)}
            min={toInputValue(dateFrom) || undefined}
            onChange={(e) =>
              onChange(dateFrom, e.target.value ? endOfDay(new Date(`${e.target.value}T00:00:00`)) : null)
            }
            aria-label="Custom reporting period to date"
            onClick={openToPicker}
            className="h-8 w-[132px] rounded-md border border-slate-300 px-2 text-xs text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
          />
        </div>
      )}

      <div className="ml-auto flex items-center gap-3">
        <div className="text-right">
          <p className="text-sm font-semibold text-slate-900 leading-tight">
            {fmtRangeDate(shownFrom)} – {fmtRangeDate(shownTo)}
          </p>
          <p className="text-[11px] text-slate-400">
            {isAll ? "all data · " : ""}
            {count} complaint{count === 1 ? "" : "s"} summarized below
          </p>
        </div>
        <button
          onClick={onToggleArrivedWarm}
          className={`cursor-pointer shrink-0 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${
            includeArrivedWarm
              ? "bg-blue-600 text-white border-blue-600 shadow-sm"
              : "bg-white text-slate-600 border-slate-300 hover:border-slate-400"
          }`}
          title="Arrived Warm is a transit issue and excluded from the food-safety log by default"
        >
          Include Arrived Warm
        </button>
      </div>
    </div>
  );
}

// ── Ticket table ──────────────────────────────────────────────────────────────
function TicketTh({
  label,
  field,
  w,
  sortField,
  sortAsc,
  onSort,
}: {
  label: string;
  field: keyof FoodSafetyTicket;
  w?: string;
  sortField: keyof FoodSafetyTicket;
  sortAsc: boolean;
  onSort: (field: keyof FoodSafetyTicket) => void;
}) {
  return (
    <th
      onClick={() => onSort(field)}
      className={`px-3 py-2.5 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider cursor-pointer whitespace-nowrap select-none hover:text-slate-800 transition-colors ${w ?? ""}`}
    >
      {label}
      {sortField === field && <span className="ml-1 text-blue-500">{sortAsc ? "↑" : "↓"}</span>}
    </th>
  );
}

function TicketTable({ tickets }: { tickets: FoodSafetyTicket[] }) {
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<keyof FoodSafetyTicket>("dateOfComplaint");
  const [sortAsc, setSortAsc] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [selectedPhoto, setSelectedPhoto] = useState<{ url: string; name: string | null } | null>(null);

  const filtered = useMemo(() => {
    // Search supports: multiple terms (ANDed), "quoted phrases", -negation,
    // and field prefixes  concern: item: sku: order: customer: action: status: type:
    // Previously this was a single substring OR'd across fields, so `tray mold` matched
    // nothing (treated as one literal) and `tray` matched no trays at all — they are named
    // "Rosé All Day", "Aprés Ski", etc. `type:tray` now resolves that via the TR- SKU prefix.
    const FIELDS: Record<string, (t: FoodSafetyTicket) => string> = {
      order: (t) => `${t.shopifyOrderNumber ?? ""}`,
      customer: (t) => `${t.customerName ?? ""}`,
      sku: (t) => [t.skuInQuestion ?? "", ...(t.skuCodes ?? [])].join(" "),
      item: (t) => [t.reportedItemName ?? "", ...(t.skuItems ?? [])].join(" "),
      concern: (t) => [t.perceivedConcern ?? "", ...(t.concerns ?? [])].join(" "),
      action: (t) => `${t.correctiveAction ?? ""}`,
      status: (t) => (t.isResolved ? "resolved" : "open"),
      text: (t) => [t.messageExcerpt ?? "", t.rootCause ?? ""].join(" "),
    };
    const allText = (t: FoodSafetyTicket) =>
      Object.values(FIELDS).map((f) => f(t)).join(" ").toLowerCase();
    const isTray = (t: FoodSafetyTicket) =>
      (t.skuCodes ?? []).some((s) => /^TR-/i.test(s.trim()));

    // tokenize: keep "quoted phrases" intact, allow a leading - for negation
    const tokens = (search.match(/-?(?:[a-zA-Z]+:)?"[^"]*"|\S+/g) ?? [])
      .map((x) => x.trim())
      .filter(Boolean);
    if (!tokens.length) return tickets;

    return tickets.filter((t) =>
      tokens.every((tok) => {
        let neg = false;
        let term = tok;
        if (term.startsWith("-")) { neg = true; term = term.slice(1); }
        const m = term.match(/^([a-zA-Z]+):(.*)$/);
        let hit: boolean;
        if (m && (m[1].toLowerCase() === "type")) {
          const v = m[2].replace(/"/g, "").toLowerCase();
          hit = v === "tray" ? isTray(t) : allText(t).includes(v);
        } else if (m && FIELDS[m[1].toLowerCase()]) {
          const v = m[2].replace(/"/g, "").toLowerCase();
          hit = FIELDS[m[1].toLowerCase()](t).toLowerCase().includes(v);
        } else {
          const v = term.replace(/"/g, "").toLowerCase();
          hit = allText(t).includes(v);
        }
        return neg ? !hit : hit;
      })
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

  function fullDate(d: Date | null) {
    if (!d) return "—";
    return d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function reportedSku(t: FoodSafetyTicket) {
    if (!t.reportedItemName || !t.skuCodes.length) return t.skuInQuestion;
    const needle = t.reportedItemName.toLowerCase();
    const exactIdx = t.skuItems.findIndex((item) => item.toLowerCase() === needle);
    if (exactIdx >= 0 && t.skuCodes[exactIdx]) return t.skuCodes[exactIdx];
    const containsIdx = t.skuItems.findIndex((item) => {
      const value = item.toLowerCase();
      return value.includes(needle) || needle.includes(value);
    });
    if (containsIdx >= 0 && t.skuCodes[containsIdx]) return t.skuCodes[containsIdx];
    return t.skuInQuestion;
  }

  function displayResolutionReference(value: string | null) {
    return value?.replace(/^Mold Sheet:\s*/i, "") || "—";
  }

  function downloadCsv() {
    const headers = ["Shopify #", "Complaint Date", "Fulfilled_Date", "Customer", "Reported Item", "Reported SKU", "All Product SKU IDs", "All Products", "Concern", "Action", "Status", "Cost", "Gorgias Link"];
    const rows = sorted.map((t) => [
      t.shopifyOrderNumber ? `#${t.shopifyOrderNumber.replace(/[^0-9]/g, "")}` : "",
      t.dateOfComplaint ? t.dateOfComplaint.toISOString().slice(0, 10) : "",
      t.orderFulfilledAt ? t.orderFulfilledAt.toISOString().slice(0, 10) : "",
      t.customerName ?? "",
      t.reportedItemName ?? (t.skuItems.length ? t.skuItems.join(" | ") : ""),
      reportedSku(t) ?? "",
      t.skuCodes.length ? t.skuCodes.join(" | ") : (t.skuInQuestion ?? ""),
      t.skuItems.length ? t.skuItems.join(" | ") : "",
      t.perceivedConcern ?? "",
      t.correctiveAction ?? "",
      t.isResolved ? "Resolved" : "Open",
      t.resolutionCost > 0 ? t.resolutionCost.toFixed(0) : "",
      t.gorgiasLink ?? "",
    ]);
    const csv = [headers, ...rows]
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `food-safety-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

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
            placeholder="Search — e.g.  mold tray   ·   type:tray concern:mold   ·   item:lonza -warm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full border border-slate-300 rounded-md pl-8 pr-3 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
          />
        </div>
        <button
          onClick={downloadCsv}
          className="cursor-pointer shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-300 bg-white text-xs font-medium text-slate-600 hover:border-slate-400 hover:text-slate-800 transition-all"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          CSV
        </button>
      </div>

      <div className="rounded-lg border border-slate-200 max-h-[620px] overflow-y-auto">
        <table className="w-full table-fixed text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
            <tr>
              <TicketTh
                label="Shopify #"
                field="shopifyOrderNumber"
                w="w-[7%]"
                sortField={sortField}
                sortAsc={sortAsc}
                onSort={handleSort}
              />
              <TicketTh
                label="Complaint"
                field="dateOfComplaint"
                w="w-[7%]"
                sortField={sortField}
                sortAsc={sortAsc}
                onSort={handleSort}
              />
              <TicketTh
                label="Ship Date"
                field="orderFulfilledAt"
                w="w-[8%]"
                sortField={sortField}
                sortAsc={sortAsc}
                onSort={handleSort}
              />
              <TicketTh label="Customer" field="customerName" w="w-[11%]" sortField={sortField} sortAsc={sortAsc} onSort={handleSort} />
              <TicketTh label="Item" field="reportedItemName" w="w-[14%]" sortField={sortField} sortAsc={sortAsc} onSort={handleSort} />
              <TicketTh label="SKU" field="skuInQuestion" w="w-[10%]" sortField={sortField} sortAsc={sortAsc} onSort={handleSort} />
              <TicketTh label="Concern" field="perceivedConcern" w="w-[11%]" sortField={sortField} sortAsc={sortAsc} onSort={handleSort} />
              <TicketTh label="Action" field="correctiveAction" w="w-[13%]" sortField={sortField} sortAsc={sortAsc} onSort={handleSort} />
              <TicketTh
                label="Status"
                field="isResolved"
                w="w-[8%]"
                sortField={sortField}
                sortAsc={sortAsc}
                onSort={handleSort}
              />
              <TicketTh
                label="Cost"
                field="resolutionCost"
                w="w-[6%]"
                sortField={sortField}
                sortAsc={sortAsc}
                onSort={handleSort}
              />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {sorted.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-10 text-center text-slate-400 text-sm">
                  No tickets match the current filters
                </td>
              </tr>
            )}
            {sorted.map((t, i) => {
              const id = t.idNumber ?? i;
              const expanded = expandedId === id;
              const displaySku = reportedSku(t);
              return (
                <Fragment key={id}>
              <tr
                key={`${id}-row`}
                tabIndex={0}
                onClick={() => setExpandedId(expanded ? null : id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setExpandedId(expanded ? null : id);
                  }
                }}
                className="cursor-pointer hover:bg-slate-50/60 focus:bg-slate-50/80 focus:outline-none transition-colors group"
                aria-expanded={expanded}
              >
                    <td className="px-3 py-2 font-mono text-[11px] text-slate-500">
                      <div className="flex items-center gap-1.5 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedId(expanded ? null : id);
                          }}
                          className="inline-flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded text-sm text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                          aria-label={expanded ? "Hide details" : "Show details"}
                        >
                          {expanded ? "−" : "+"}
                        </button>
                        {t.gorgiasLink ? (
                          <a
                            href={t.gorgiasLink}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex rounded-md bg-blue-50 px-1.5 py-0.5 font-semibold text-blue-700 ring-1 ring-inset ring-blue-200 hover:bg-blue-100 hover:text-blue-900 hover:underline"
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
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500 whitespace-nowrap">
                      {fmtDate(t.dateOfComplaint)}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500 whitespace-nowrap">
                      {fmtDate(t.orderFulfilledAt)}
                      {t.orderFulfilledAt && t.orderFulfilledSource === "recharge_ship_property" && (
                        <span
                          title="Estimated — real fulfillment date unavailable (order older than Shopify's 60-day window). May be inaccurate."
                          className="ml-1 text-amber-500 cursor-help"
                        >~</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-800 max-w-[130px] truncate font-medium">
                      {t.customerName ?? "—"}
                    </td>
                    <td
                      className="px-3 py-2 text-[11px] text-slate-600 max-w-[150px] truncate"
                      title={t.reportedItemName ?? (t.skuItems.length ? t.skuItems.join(", ") : "")}
                    >
                      {t.reportedItemName ?? (t.skuItems.length ? t.skuItems.slice(0, 2).join(", ") : "—")}
                    </td>
                    <td
                      className="px-3 py-2 text-[11px] text-slate-600 max-w-[130px] truncate"
                      title={[
                        displaySku ? `Reported SKU: ${displaySku}` : null,
                        t.skuCodes.length ? `All SKUs: ${t.skuCodes.join(", ")}` : null,
                      ].filter(Boolean).join(" | ")}
                    >
                      {displaySku ?? "—"}
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
                    <td className="px-3 py-2 text-xs font-semibold text-slate-700 whitespace-nowrap">
                      {t.resolutionCost > 0 ? (
                        `$${t.resolutionCost.toFixed(0)}`
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                  </tr>
                  {expanded && (
                    <tr key={`${id}-details`} className="bg-slate-50/70">
                      <td colSpan={10} className="px-4 py-4">
                        <div className="grid gap-5 xl:grid-cols-[1.45fr_1fr]">
                          <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-3 rounded-md border border-slate-200 bg-white p-3">
                              <div>
                                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Item</p>
                                <p className="mt-1 text-sm font-medium text-slate-800 whitespace-normal break-words">
                                  {t.reportedItemName ?? "—"}
                                </p>
                              </div>
                              <div>
                                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">SKU</p>
                                <p className="mt-1 text-sm font-mono text-slate-800 whitespace-normal break-words">
                                  {displaySku ?? "—"}
                                </p>
                              </div>
                            </div>
                            <div>
                              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Customer Message</p>
                              <p className="mt-1 text-xs leading-5 text-slate-700 whitespace-pre-wrap">
                                {t.messageExcerpt ?? "—"}
                              </p>
                            </div>
                            <div>
                              <div className="flex flex-wrap items-baseline justify-between gap-2">
                                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">First Agent Response</p>
                                {t.firstAgentResponseAt && (
                                  <p className="text-[10px] text-slate-400">
                                    {[t.firstAgentName, fullDate(t.firstAgentResponseAt)].filter(Boolean).join(" · ")}
                                  </p>
                                )}
                              </div>
                              <p className="mt-1 text-xs leading-5 text-slate-700 whitespace-pre-wrap">
                                {t.firstAgentResponse ?? "Awaiting agent response"}
                              </p>
                            </div>
                            <div>
                              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Customer Photos</p>
                              {t.photoUrls.length ? (
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {t.photoUrls.map((photo, idx) => (
                                    <button
                                      key={`${photo.url}-${idx}`}
                                      type="button"
                                      onClick={() => setSelectedPhoto({ url: photo.url, name: photo.name })}
                                      className="block h-20 w-20 overflow-hidden rounded-md border border-slate-200 bg-white"
                                      title={photo.name ?? "Open photo"}
                                    >
                                      <img
                                        src={photo.url}
                                        alt={photo.name ?? `Customer photo ${idx + 1}`}
                                        className="h-full w-full object-cover"
                                        loading="lazy"
                                      />
                                    </button>
                                  ))}
                                </div>
                              ) : (
                                <p className="mt-1 text-xs text-slate-700">—</p>
                              )}
                            </div>
                            {(t.skuCodes.length || t.skuItems.length) && (
                              <details className="rounded-md border border-slate-200 bg-white p-3 text-xs text-slate-700">
                                <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                                  All items in order
                                </summary>
                                <div className="mt-3 grid gap-3 md:grid-cols-2">
                                  <div>
                                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Product SKU IDs</p>
                                    <p className="mt-1 font-mono whitespace-normal break-words">
                                      {t.skuCodes.length ? t.skuCodes.join(", ") : "—"}
                                    </p>
                                  </div>
                                  <div>
                                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Products</p>
                                    <p className="mt-1 whitespace-normal break-words">
                                      {t.skuItems.length ? t.skuItems.join(", ") : "—"}
                                    </p>
                                  </div>
                                </div>
                              </details>
                            )}
                          </div>
                          <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
                            {t.gorgiasLink && (
                              <div className="col-span-2 flex justify-end">
                                <a
                                  href={t.gorgiasLink}
                                  target="_blank"
                                  rel="noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="inline-flex items-center gap-1 font-semibold text-blue-700 hover:text-blue-900 hover:underline"
                                >
                                  View in Gorgias
                                  <span aria-hidden="true">↗</span>
                                </a>
                              </div>
                            )}
                            <div>
                              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Complaint</p>
                              <p className="mt-1 text-slate-700">{fullDate(t.dateOfComplaint)}</p>
                            </div>
                            <div>
                              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Fulfilled_Date</p>
                              <p className="mt-1 text-slate-700">{fullDate(t.orderFulfilledAt)}</p>
                            </div>
                            <div>
                              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Concerns</p>
                              <p className="mt-1 text-slate-700">{t.concerns.length ? t.concerns.join(", ") : "—"}</p>
                            </div>
                            <div>
                              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">SKU Categories</p>
                              <p className="mt-1 text-slate-700">{t.skuCategories.length ? t.skuCategories.join(", ") : "—"}</p>
                            </div>
                            <div>
                              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Root Cause</p>
                              <p className="mt-1 text-slate-700">{t.rootCause ?? "—"}</p>
                            </div>
                            <div>
                              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Resolution</p>
                              <p className="mt-1 text-slate-700">{t.resolutionApplied ?? "—"}</p>
                            </div>
                            <div>
                              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Cost</p>
                              <p className="mt-1 text-slate-700">{t.resolutionCost > 0 ? `$${t.resolutionCost.toFixed(0)}` : "—"}</p>
                            </div>
                            <div className="col-span-2">
                              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Mold Sheet Reference</p>
                              <p className="mt-1 text-slate-700 whitespace-pre-wrap">{displayResolutionReference(t.resolutionReference)}</p>
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {selectedPhoto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-6"
          role="dialog"
          aria-modal="true"
          onClick={() => setSelectedPhoto(null)}
        >
          <div className="relative max-h-full max-w-5xl" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setSelectedPhoto(null)}
              className="absolute right-2 top-2 z-10 rounded bg-white/90 px-2 py-1 text-xs font-medium text-slate-700 shadow hover:bg-white"
            >
              Close
            </button>
            <img
              src={selectedPhoto.url}
              alt={selectedPhoto.name ?? "Customer photo"}
              className="max-h-[85vh] max-w-full rounded-lg bg-white object-contain shadow-2xl"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function FoodSafetyPage() {
  const [allTickets, setAllTickets] = useState<FoodSafetyTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [syncMeta, setSyncMeta] = useState<FoodSafetyMeta | null>(null);
  const [timePeriod, setTimePeriod] = useState<TimePeriod>("weekly");
  const [clock, setClock] = useState(() => Date.now());
  const filters = useFilterStore();

  const loadData = useCallback(async (initial = false) => {
    if (initial) setLoading(true);
    else setRefreshing(true);
    try {
      const [data, meta] = await Promise.all([
        fetchFoodSafety(filters.includeArrivedWarm),
        fetchFoodSafetyMeta(),
      ]);
        setAllTickets(data);
        const latest = data
          .map((t) => t.dateOfComplaint)
          .filter((d): d is Date => d instanceof Date)
          .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
        setLastUpdated(latest);
        setSyncMeta(meta);
        setError(null);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Failed to load data");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
  }, [filters.includeArrivedWarm]);

  useEffect(() => {
    const initial = window.setTimeout(() => { void loadData(true); }, 0);
    const timer = window.setInterval(() => { void loadData(false); }, 5 * 60 * 1000);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); };
  }, [loadData]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  const { dateFrom, dateTo, setDateFrom, setDateTo } = filters;

  // Every summary below (KPIs, charts, table) reflects this selection.
  const tickets = useMemo(() => {
    return allTickets.filter((t) => {
      if (dateFrom && t.dateOfComplaint && t.dateOfComplaint < dateFrom) return false;
      if (dateTo && t.dateOfComplaint && t.dateOfComplaint > dateTo) return false;
      return true;
    });
  }, [allTickets, dateFrom, dateTo]);

  const dataExtent = useMemo(() => {
    const dates = allTickets
      .map((t) => t.dateOfComplaint)
      .filter((d): d is Date => d instanceof Date)
      .sort((a, b) => a.getTime() - b.getTime());
    return { start: dates[0] ?? null, end: dates[dates.length - 1] ?? null };
  }, [allTickets]);
  const kpis = useMemo(() => foodSafetyKpis(tickets), [tickets]);
  const concerns = useMemo(() => concernBreakdown(tickets), [tickets]);
  const concernCosts = useMemo(() => concernCostImpact(tickets), [tickets]);

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
      <div className="min-h-screen bg-[#f5f7fb] px-4 py-6 sm:px-6">
        <div className="mx-auto max-w-screen-xl space-y-4">
          <div className="h-20 animate-pulse rounded-2xl border border-slate-200 bg-white" />
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {Array.from({ length: 6 }, (_, i) => <div key={i} className="h-24 animate-pulse rounded-xl border border-slate-200 bg-white" />)}
          </div>
          <div className="h-96 animate-pulse rounded-xl border border-slate-200 bg-white" />
        </div>
      </div>
    );

  if (error) return (
    <div className="mx-auto flex min-h-[50vh] max-w-lg flex-col items-center justify-center px-6 text-center">
      <p className="text-sm font-semibold text-red-800">Food Safety data unavailable</p>
      <p className="mt-1 text-xs text-slate-500">{error}</p>
      <button onClick={() => void loadData(true)} className="mt-4 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40">Retry</button>
    </div>
  );

  const resolvedPct =
    kpis.totalComplaints > 0 ? ((kpis.resolved / kpis.totalComplaints) * 100).toFixed(0) : "0";
  const syncAgeMinutes = syncMeta?.last_synced_at
    ? Math.max(0, Math.round((clock - new Date(syncMeta.last_synced_at).getTime()) / 60000))
    : null;
  const syncHealthy = syncAgeMinutes != null && syncAgeMinutes <= 15;

  return (
    <div className="min-h-screen bg-[#f5f7fb]">
      {/* Reporting period — sticky, drives every KPI, chart, and table row below */}
      <DateRangeBar
        dateFrom={dateFrom}
        dateTo={dateTo}
        onChange={(from, to) => {
          setDateFrom(from);
          setDateTo(to);
        }}
        dataStart={dataExtent.start}
        dataEnd={dataExtent.end}
        count={tickets.length}
        includeArrivedWarm={Boolean(filters.includeArrivedWarm)}
        onToggleArrivedWarm={() => filters.setIncludeArrivedWarm(!filters.includeArrivedWarm)}
      />

      <div className="mx-auto max-w-screen-xl space-y-5 px-4 py-5 sm:px-6 sm:py-7">
        {/* Page header */}
        <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Food Safety Complaints</h1>
            <p className="mt-1 text-sm text-slate-500">
              {tickets.length} of {allTickets.length} records in selected period
              {lastUpdated &&
                ` · most recent complaint ${lastUpdated.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 sm:justify-end">
            <div className="text-right text-[11px] text-slate-500">
              <p className={`font-semibold ${syncHealthy ? "text-emerald-700" : "text-amber-700"}`}>
                {syncMeta?.last_synced_at ? `${syncHealthy ? "Synced" : "Sync delayed"} ${new Date(syncMeta.last_synced_at).toLocaleString()}` : "Sync status unavailable"}
              </p>
              <p className="mt-0.5 text-slate-400">{syncAgeMinutes != null ? `${syncAgeMinutes} min ago` : "Awaiting sync status"}</p>
            </div>
            <button
              onClick={() => void loadData(false)}
              disabled={refreshing}
              className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:border-slate-400 disabled:cursor-wait disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
            >
              <svg className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h5M20 20v-5h-5M5.5 15a7 7 0 0011.9 1.1L20 14M4 10l2.6-2.1A7 7 0 0118.5 9" />
              </svg>
              {refreshing ? "Refreshing" : "Refresh"}
            </button>
          </div>
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard
            label="Complaints"
            value={kpis.totalComplaints.toString()}
            sub="in selected period"
            accent="blue"
          />
          <StatCard
            label="Total Cost"
            value={`$${kpis.totalCost.toLocaleString("en-US", { maximumFractionDigits: 0 })}`}
            sub="resolution cost in period"
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

        {/* Full-width trend chart with period selector */}
        <Card
          title="Complaints & Cost Over Time"
          sub="Bars = count, dashed line = cost"
          headerRight={<PeriodSelector value={timePeriod} onChange={setTimePeriod} />}
        >
          <WeeklyTrend data={trendData} />
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card title="Concern Breakdown" sub="By complaint count">
            <DonutChart data={concerns.map((c) => ({ name: c.concern, value: c.count }))} />
          </Card>
          <Card title="Concern Cost Impact" sub="Estimated total resolution cost by concern type">
            {concernCosts.length ? (
              <HorizontalBar
                data={concernCosts.map((c) => ({
                  label: c.concern,
                  value: Math.round(c.totalCost),
                }))}
                color="#8b5cf6"
                formatter={(v) => `$${v.toLocaleString()}`}
              />
            ) : (
              <div className="flex h-40 items-center justify-center text-sm text-slate-400">
                No resolved-cost data for the current filter
              </div>
            )}
          </Card>
        </div>

        {/* Ticket table */}
        <Card title="Complaint Log" sub="Detailed ticket records for the selected period">
          <TicketTable tickets={tickets} />
        </Card>
      </div>
    </div>
  );
}
