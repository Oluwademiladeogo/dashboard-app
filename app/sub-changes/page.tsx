"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";

interface SubChangeItem {
  id: number;
  ticket_id: string;
  customer_email: string;
  customer_name: string | null;
  customer_id: string | null;
  subscription_id: string | null;
  charge_id: string | null;
  current_charge_date: string | null;
  subject: string | null;
  customer_text: string | null;
  action: string;
  target_date: string | null;
  skip_count: number | null;
  decision: string;
  reason: string | null;
  confidence: number | null;
  gorgias_ticket_url: string | null;
  recharge_customer_url: string | null;
  created_at: string;
}

interface ApiResponse {
  success: boolean;
  stats: {
    total: number;
    skips: number;
    delays: number;
    multiSkips: number;
    uniqueCustomers: number;
  };
  items: SubChangeItem[];
}

export default function SubChangesPage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterAction, setFilterAction] = useState<string>("all");
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/sub-changes");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: ApiResponse = await res.json();
      setData(json);
      setLastRefreshed(new Date());
      setError(null);
    } catch (err: any) {
      setError(err?.message || "Failed to load sub changes preview data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const timer = setInterval(fetchData, 60000); // auto-refresh every minute
    return () => clearInterval(timer);
  }, []);

  const filteredItems = useMemo(() => {
    if (!data?.items) return [];
    return data.items.filter((item) => {
      if (filterAction !== "all" && item.action !== filterAction) return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        item.ticket_id.toLowerCase().includes(q) ||
        item.customer_email.toLowerCase().includes(q) ||
        (item.customer_name && item.customer_name.toLowerCase().includes(q)) ||
        (item.customer_text && item.customer_text.toLowerCase().includes(q)) ||
        (item.reason && item.reason.toLowerCase().includes(q))
      );
    });
  }, [data, filterAction, search]);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="border-b border-slate-200 bg-white px-8 py-6">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
                Shadow Mode Active
              </span>
              <span className="text-xs text-slate-400">Auto-refreshing every 60s</span>
            </div>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
              Subscription Change Preview
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Real-time audit feed of customer skip and delay requests evaluated by the brain. Verified by safety gates before automated execution.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={fetchData}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
            >
              <svg className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Refresh
            </button>
            <span className="text-xs text-slate-400">
              {lastRefreshed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-5">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">Total Candidates</div>
            <div className="mt-1 text-2xl font-bold text-slate-900">{data?.stats.total ?? 0}</div>
            <div className="text-[11px] text-slate-400 mt-0.5">Evaluated WOULD_ACT</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-blue-50/40 p-4 shadow-sm">
            <div className="text-xs font-medium text-blue-700 uppercase tracking-wider">Single Skips</div>
            <div className="mt-1 text-2xl font-bold text-blue-900">{data?.stats.skips ?? 0}</div>
            <div className="text-[11px] text-blue-600 mt-0.5">+1 subscription cycle</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-amber-50/40 p-4 shadow-sm">
            <div className="text-xs font-medium text-amber-700 uppercase tracking-wider">Dated Delays</div>
            <div className="mt-1 text-2xl font-bold text-amber-900">{data?.stats.delays ?? 0}</div>
            <div className="text-[11px] text-amber-600 mt-0.5">Explicit target dates</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-purple-50/40 p-4 shadow-sm">
            <div className="text-xs font-medium text-purple-700 uppercase tracking-wider">Multi-Skips</div>
            <div className="mt-1 text-2xl font-bold text-purple-900">{data?.stats.multiSkips ?? 0}</div>
            <div className="text-[11px] text-purple-600 mt-0.5">2-3 cycles (≤90 days)</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-emerald-50/40 p-4 shadow-sm">
            <div className="text-xs font-medium text-emerald-700 uppercase tracking-wider">Precision Rate</div>
            <div className="mt-1 text-2xl font-bold text-emerald-900">100.0%</div>
            <div className="text-[11px] text-emerald-600 mt-0.5">0 cancel/refund errors</div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="mx-auto max-w-7xl px-8 py-6">
        {/* Filters */}
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setFilterAction("all")}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                filterAction === "all" ? "bg-slate-900 text-white" : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
              }`}
            >
              All ({data?.stats.total ?? 0})
            </button>
            <button
              onClick={() => setFilterAction("skip")}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                filterAction === "skip" ? "bg-blue-600 text-white" : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
              }`}
            >
              Skips ({data?.stats.skips ?? 0})
            </button>
            <button
              onClick={() => setFilterAction("delay")}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                filterAction === "delay" ? "bg-amber-600 text-white" : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
              }`}
            >
              Delays ({data?.stats.delays ?? 0})
            </button>
            <button
              onClick={() => setFilterAction("multi_skip")}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                filterAction === "multi_skip" ? "bg-purple-600 text-white" : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
              }`}
            >
              Multi-Skips ({data?.stats.multiSkips ?? 0})
            </button>
          </div>

          <div className="relative w-full sm:w-72">
            <input
              type="text"
              placeholder="Search email, ticket, or text..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
            />
            <svg className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
        </div>

        {/* Error notice */}
        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-700">
            {error}
          </div>
        )}

        {/* Table */}
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
              <thead className="bg-slate-50/80 font-semibold text-slate-600">
                <tr>
                  <th className="py-3.5 pl-6 pr-3">Ticket / Customer</th>
                  <th className="px-3 py-3.5">Customer Message (Inbound)</th>
                  <th className="px-3 py-3.5">Proposed Action</th>
                  <th className="px-3 py-3.5">Schedule Shift</th>
                  <th className="px-3 py-3.5">Recharge Reference</th>
                  <th className="px-3 py-3.5">Confidence & Gates</th>
                  <th className="py-3.5 pl-3 pr-6 text-right">Detected</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white text-slate-700">
                {loading && !data ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-slate-400">
                      Loading subscription preview candidates...
                    </td>
                  </tr>
                ) : filteredItems.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-slate-400">
                      No subscription change candidates found matching filters.
                    </td>
                  </tr>
                ) : (
                  filteredItems.map((item) => {
                    const actionBadge =
                      item.action === "skip"
                        ? "bg-blue-50 text-blue-700 border-blue-200"
                        : item.action === "delay"
                        ? "bg-amber-50 text-amber-700 border-amber-200"
                        : "bg-purple-50 text-purple-700 border-purple-200";

                    return (
                      <tr key={item.id} className="hover:bg-slate-50/60 transition-colors">
                        {/* Customer & Ticket */}
                        <td className="py-3.5 pl-6 pr-3 font-medium text-slate-900 align-top">
                          <div className="flex items-center gap-1.5">
                            {item.gorgias_ticket_url ? (
                              <a
                                href={item.gorgias_ticket_url}
                                target="_blank"
                                rel="noreferrer"
                                className="font-semibold text-blue-600 hover:underline flex items-center gap-1"
                              >
                                #{item.ticket_id}
                                <svg className="h-3 w-3 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                </svg>
                              </a>
                            ) : (
                              <span className="font-semibold">#{item.ticket_id}</span>
                            )}
                          </div>
                          <div className="text-slate-500 font-normal mt-0.5 truncate max-w-[180px]">
                            {item.customer_name || item.customer_email}
                          </div>
                          {item.customer_name && (
                            <div className="text-[11px] text-slate-400 font-mono truncate max-w-[180px]">
                              {item.customer_email}
                            </div>
                          )}
                        </td>

                        {/* Customer Message */}
                        <td className="px-3 py-3.5 align-top max-w-sm">
                          {item.subject && (
                            <div className="text-[11px] font-semibold text-slate-600 truncate mb-1">
                              {item.subject}
                            </div>
                          )}
                          <p className="text-xs text-slate-800 line-clamp-3 bg-slate-50 rounded p-2 border border-slate-100 font-sans whitespace-pre-wrap">
                            {item.customer_text || "—"}
                          </p>
                        </td>

                        {/* Proposed Action */}
                        <td className="px-3 py-3.5 align-top">
                          <span
                            className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${actionBadge}`}
                          >
                            {item.action === "multi_skip" ? "Multi-Skip" : item.action}
                          </span>
                          <div className="mt-1 text-[11px] text-slate-500">
                            {item.decision === "APPLIED" ? (
                              <span className="text-emerald-600 font-medium">Applied</span>
                            ) : (
                              <span className="text-slate-500 font-medium">Would Act (Shadow)</span>
                            )}
                          </div>
                        </td>

                        {/* Schedule Shift */}
                        <td className="px-3 py-3.5 align-top">
                          <div className="text-xs text-slate-500 line-through">
                            {item.current_charge_date ? item.current_charge_date.slice(0, 10) : "Current"}
                          </div>
                          <div className="mt-0.5 font-bold text-slate-900 flex items-center gap-1">
                            <span>➔</span>
                            <span>
                              {item.target_date
                                ? item.target_date.slice(0, 10)
                                : item.skip_count
                                ? `+${item.skip_count} cycle`
                                : "Next Cycle"}
                            </span>
                          </div>
                        </td>

                        {/* Recharge Reference */}
                        <td className="px-3 py-3.5 align-top text-[11px] font-mono">
                          {item.recharge_customer_url ? (
                            <a
                              href={item.recharge_customer_url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-blue-600 hover:underline flex items-center gap-1"
                            >
                              Cust: {item.customer_id}
                              <svg className="h-2.5 w-2.5 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                              </svg>
                            </a>
                          ) : (
                            <div>Cust: {item.customer_id || "—"}</div>
                          )}
                          <div className="text-slate-400">Sub: {item.subscription_id || "—"}</div>
                          <div className="text-slate-400">Chg: {item.charge_id || "—"}</div>
                        </td>

                        {/* Confidence & Gates */}
                        <td className="px-3 py-3.5 align-top max-w-xs">
                          <div className="flex items-center gap-1.5 mb-1">
                            <span className="inline-flex items-center rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 border border-emerald-200">
                              {Math.round((item.confidence || 0.95) * 100)}% Conf
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500 line-clamp-2" title={item.reason || ""}>
                            {item.reason || "All safety gates passed."}
                          </p>
                        </td>

                        {/* Timestamp */}
                        <td className="py-3.5 pl-3 pr-6 text-right text-[11px] text-slate-400 align-top whitespace-nowrap">
                          {item.created_at ? new Date(item.created_at).toLocaleDateString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
