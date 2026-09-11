"use client";

import { useEffect, useState, useMemo } from "react";

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
  const [selectedItem, setSelectedItem] = useState<SubChangeItem | null>(null);

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
      setError(err?.message || "Failed to load subscription preview data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const timer = setInterval(fetchData, 60000);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedItem(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      clearInterval(timer);
      window.removeEventListener("keydown", handleKeyDown);
    };
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
        (item.subject && item.subject.toLowerCase().includes(q))
      );
    });
  }, [data, filterAction, search]);

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "—";
    try {
      const d = new Date(dateStr.slice(0, 10));
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    } catch {
      return dateStr.slice(0, 10);
    }
  };

  const computeDelta = (item: SubChangeItem) => {
    if (item.action === "skip") return "+1 cycle";
    if (item.action === "multi_skip") return item.skip_count ? `+${item.skip_count} cycles` : "+2 cycles";
    if (item.action === "delay" && item.current_charge_date && item.target_date) {
      try {
        const d1 = new Date(item.current_charge_date.slice(0, 10));
        const d2 = new Date(item.target_date.slice(0, 10));
        const diffDays = Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
        if (diffDays > 0) return `+${diffDays} days`;
      } catch {
        // fallback
      }
    }
    return "Date shift";
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-800 antialiased selection:bg-indigo-500 selection:text-white">
      {/* Top Banner Header */}
      <header className="border-b border-slate-200/80 bg-white/90 backdrop-blur-md sticky top-0 z-30 px-6 py-4 lg:px-10">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between max-w-7xl mx-auto">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span className="text-[11px] font-semibold tracking-wider uppercase text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200/60">
                Live Shadow Mode
              </span>
              <span className="text-xs text-slate-400">· Staged for Review</span>
            </div>
            <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-slate-900">
              Subscription Schedule Changes
            </h1>
            <p className="mt-0.5 text-xs text-slate-500">
              Real-time audit feed of customer skip and delay intents detected from Gorgias conversations.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-[11px] text-slate-400 bg-slate-100/80 px-2.5 py-1 rounded-md border border-slate-200/60">
              <svg className="h-3 w-3 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{lastRefreshed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
            </div>
            <button
              onClick={fetchData}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition-all hover:bg-slate-50 hover:border-slate-300 disabled:opacity-50"
            >
              <svg className={`h-3.5 w-3.5 text-slate-500 ${loading ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span>Refresh</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 lg:px-10">
        {/* KPI Stats Grid */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5 mb-8">
          <div className="relative overflow-hidden rounded-xl border border-slate-200/90 bg-white p-4 shadow-sm">
            <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Total Candidates</div>
            <div className="mt-2 text-2xl font-bold tracking-tight text-slate-900">{data?.stats.total ?? 0}</div>
            <div className="mt-1 text-[11px] font-medium text-slate-400">Staged shadow candidates</div>
          </div>

          <div className="relative overflow-hidden rounded-xl border border-indigo-100 bg-gradient-to-b from-indigo-50/50 to-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-indigo-700 uppercase tracking-wider">Single Skips</span>
              <span className="h-2 w-2 rounded-full bg-indigo-500"></span>
            </div>
            <div className="mt-2 text-2xl font-bold tracking-tight text-indigo-950">{data?.stats.skips ?? 0}</div>
            <div className="mt-1 text-[11px] text-indigo-600/80 font-medium">+1 subscription cycle</div>
          </div>

          <div className="relative overflow-hidden rounded-xl border border-amber-100 bg-gradient-to-b from-amber-50/50 to-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-amber-700 uppercase tracking-wider">Dated Delays</span>
              <span className="h-2 w-2 rounded-full bg-amber-500"></span>
            </div>
            <div className="mt-2 text-2xl font-bold tracking-tight text-amber-950">{data?.stats.delays ?? 0}</div>
            <div className="mt-1 text-[11px] text-amber-600/80 font-medium">Relative & specific dates</div>
          </div>

          <div className="relative overflow-hidden rounded-xl border border-purple-100 bg-gradient-to-b from-purple-50/50 to-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-purple-700 uppercase tracking-wider">Multi-Skips</span>
              <span className="h-2 w-2 rounded-full bg-purple-500"></span>
            </div>
            <div className="mt-2 text-2xl font-bold tracking-tight text-purple-950">{data?.stats.multiSkips ?? 0}</div>
            <div className="mt-1 text-[11px] text-purple-600/80 font-medium">2–3 cycles (≤90 days)</div>
          </div>

          <div className="relative overflow-hidden rounded-xl border border-slate-200/90 bg-white p-4 shadow-sm">
            <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Unique Customers</div>
            <div className="mt-2 text-2xl font-bold tracking-tight text-slate-900">{data?.stats.uniqueCustomers ?? 0}</div>
            <div className="mt-1 text-[11px] text-emerald-600 font-medium">100% Precision Guarded</div>
          </div>
        </div>

        {/* Filter Toolbar */}
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
            <button
              onClick={() => setFilterAction("all")}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-all ${
                filterAction === "all" ? "bg-slate-900 text-white shadow-sm" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              All ({data?.stats.total ?? 0})
            </button>
            <button
              onClick={() => setFilterAction("skip")}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-all ${
                filterAction === "skip" ? "bg-indigo-600 text-white shadow-sm" : "text-slate-600 hover:text-indigo-600"
              }`}
            >
              Skips ({data?.stats.skips ?? 0})
            </button>
            <button
              onClick={() => setFilterAction("delay")}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-all ${
                filterAction === "delay" ? "bg-amber-600 text-white shadow-sm" : "text-slate-600 hover:text-amber-600"
              }`}
            >
              Delays ({data?.stats.delays ?? 0})
            </button>
            <button
              onClick={() => setFilterAction("multi_skip")}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-all ${
                filterAction === "multi_skip" ? "bg-purple-600 text-white shadow-sm" : "text-slate-600 hover:text-purple-600"
              }`}
            >
              Multi-Skips ({data?.stats.multiSkips ?? 0})
            </button>
          </div>

          <div className="relative w-full sm:w-80">
            <input
              type="text"
              placeholder="Search customer, email, ticket, or text..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-9 pr-3 text-xs text-slate-900 placeholder:text-slate-400 shadow-sm transition-all focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <svg className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600 text-xs">
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Error Notification */}
        {error && (
          <div className="mb-5 rounded-lg border border-red-200 bg-red-50 p-4 text-xs text-red-700 flex items-center gap-2">
            <svg className="h-4 w-4 shrink-0 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        {/* High-End Clean Table */}
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
              <thead className="bg-[#f8fafc] text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="py-3.5 pl-6 pr-4">Ticket & Customer</th>
                  <th className="px-4 py-3.5">Inbound Customer Request</th>
                  <th className="px-4 py-3.5">Proposed Action</th>
                  <th className="px-4 py-3.5">Schedule Transition</th>
                  <th className="px-4 py-3.5">Recharge Account</th>
                  <th className="py-3.5 pl-4 pr-6 text-right">Detected</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100 bg-white">
                {loading && !data ? (
                  <tr>
                    <td colSpan={6} className="py-16 text-center text-slate-400">
                      <div className="inline-flex items-center gap-2 text-xs font-medium">
                        <svg className="h-4 w-4 animate-spin text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        <span>Loading verified candidates...</span>
                      </div>
                    </td>
                  </tr>
                ) : filteredItems.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-16 text-center text-slate-400">
                      <div className="mx-auto max-w-sm">
                        <div className="text-2xl mb-1">🔍</div>
                        <div className="font-medium text-slate-700 text-xs">No candidate tickets found</div>
                        <div className="text-[11px] text-slate-400 mt-0.5">Try adjusting your filters or search terms.</div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredItems.map((item) => {
                    const actionBadge =
                      item.action === "skip"
                        ? "bg-indigo-50 text-indigo-700 border-indigo-200/80"
                        : item.action === "delay"
                        ? "bg-amber-50 text-amber-800 border-amber-200/80"
                        : "bg-purple-50 text-purple-700 border-purple-200/80";

                    const actionDot =
                      item.action === "skip"
                        ? "bg-indigo-500"
                        : item.action === "delay"
                        ? "bg-amber-500"
                        : "bg-purple-500";

                    const deltaLabel = computeDelta(item);
                    const isSelected = selectedItem?.id === item.id;

                    return (
                      <tr
                        key={item.id}
                        onClick={() => setSelectedItem(item)}
                        className={`transition-colors cursor-pointer group ${
                          isSelected
                            ? "bg-indigo-50/70 ring-1 ring-inset ring-indigo-200"
                            : "hover:bg-slate-50/80"
                        }`}
                      >
                        {/* Customer & Ticket */}
                        <td className="py-4 pl-6 pr-4 align-top">
                          <div className="flex items-center gap-1.5">
                            {item.gorgias_ticket_url ? (
                              <a
                                href={item.gorgias_ticket_url}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="font-mono text-xs font-semibold text-indigo-600 hover:text-indigo-800 hover:underline inline-flex items-center gap-1"
                              >
                                #{item.ticket_id}
                                <svg className="h-3 w-3 opacity-50 group-hover:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                </svg>
                              </a>
                            ) : (
                              <span className="font-mono text-xs font-semibold text-slate-700">#{item.ticket_id}</span>
                            )}
                          </div>
                          <div className="font-medium text-slate-900 mt-1 truncate max-w-[180px]">
                            {item.customer_name || item.customer_email.split("@")[0]}
                          </div>
                          <div className="font-mono text-[11px] text-slate-400 truncate max-w-[180px]">
                            {item.customer_email}
                          </div>
                        </td>

                        {/* Customer Message */}
                        <td className="px-4 py-4 align-top max-w-md">
                          {item.subject && (
                            <div className="text-[11px] font-semibold text-slate-600 mb-1 line-clamp-1">
                              {item.subject}
                            </div>
                          )}
                          <div className="relative rounded-lg bg-slate-50/90 p-2.5 border border-slate-200/60 group-hover:bg-white group-hover:border-slate-300 transition-all">
                            <p className="text-xs text-slate-700 leading-relaxed font-sans line-clamp-2">
                              "{item.customer_text || "—"}"
                            </p>
                          </div>
                        </td>

                        {/* Proposed Action */}
                        <td className="px-4 py-4 align-top whitespace-nowrap">
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-wider ${actionBadge}`}
                          >
                            <span className={`h-1.5 w-1.5 rounded-full ${actionDot}`} aria-hidden="true" />
                            {item.action === "multi_skip" ? "Multi-Skip" : item.action}
                          </span>
                        </td>

                        {/* Schedule Transition */}
                        <td className="px-4 py-4 align-top whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs text-slate-400 line-through">
                              {formatDate(item.current_charge_date)}
                            </span>
                            <span className="text-slate-400">➔</span>
                            <span className="font-mono text-xs font-bold text-slate-900">
                              {item.target_date ? formatDate(item.target_date) : "Next Cycle"}
                            </span>
                          </div>
                          <div className="mt-1">
                            <span className="inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 border border-slate-200/60">
                              {deltaLabel}
                            </span>
                          </div>
                        </td>

                        {/* Recharge Account */}
                        <td className="px-4 py-4 align-top whitespace-nowrap font-mono text-xs">
                          {item.recharge_customer_url ? (
                            <a
                              href={item.recharge_customer_url}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="text-slate-700 hover:text-indigo-600 hover:underline inline-flex items-center gap-1"
                            >
                              Cust: {item.customer_id || "—"}
                              <svg className="h-2.5 w-2.5 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                              </svg>
                            </a>
                          ) : (
                            <div className="text-slate-700">Cust: {item.customer_id || "—"}</div>
                          )}
                          <div className="text-[11px] text-slate-400 mt-0.5">Sub: {item.subscription_id || "—"}</div>
                        </td>

                        {/* Timestamp */}
                        <td className="py-4 pl-4 pr-6 text-right text-[11px] text-slate-400 align-top whitespace-nowrap font-mono">
                          {item.created_at
                            ? new Date(item.created_at).toLocaleDateString("en-US", {
                                month: "short",
                                day: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              })
                            : "—"}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {/* Slide-over Detail Drawer */}
      {selectedItem && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/30 backdrop-blur-xs transition-opacity" onClick={() => setSelectedItem(null)}>
          <div
            className="w-full max-w-md bg-white p-6 shadow-2xl border-l border-slate-200 overflow-y-auto flex flex-col justify-between"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200">
                    Ticket #{selectedItem.ticket_id}
                  </span>
                  <span className="text-xs font-semibold uppercase text-slate-500">
                    {selectedItem.action}
                  </span>
                </div>
                <button
                  onClick={() => setSelectedItem(null)}
                  className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  ✕
                </button>
              </div>

              <div className="mt-5 space-y-4">
                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Customer</label>
                  <div className="text-sm font-semibold text-slate-900 mt-0.5">
                    {selectedItem.customer_name || selectedItem.customer_email.split("@")[0]}
                  </div>
                  <div className="text-xs font-mono text-slate-500">{selectedItem.customer_email}</div>
                </div>

                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Customer Inbound Message</label>
                  {selectedItem.subject && (
                    <div className="text-xs font-semibold text-slate-700 mt-1">{selectedItem.subject}</div>
                  )}
                  <div className="mt-1 rounded-lg bg-slate-50 p-3 text-xs text-slate-800 border border-slate-200 font-sans leading-relaxed whitespace-pre-wrap">
                    "{selectedItem.customer_text || "—"}"
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 pt-2">
                  <div className="rounded-lg border border-slate-200 p-3 bg-slate-50/50">
                    <div className="text-[10px] font-semibold uppercase text-slate-400">Current Charge Date</div>
                    <div className="mt-1 text-xs font-bold text-slate-700 font-mono">
                      {formatDate(selectedItem.current_charge_date)}
                    </div>
                  </div>
                  <div className="rounded-lg border border-indigo-200 p-3 bg-indigo-50/40">
                    <div className="text-[10px] font-semibold uppercase text-indigo-700">Target Charge Date</div>
                    <div className="mt-1 text-xs font-bold text-indigo-900 font-mono">
                      {selectedItem.target_date ? formatDate(selectedItem.target_date) : "Next Cycle (+1)"}
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5 pt-2 font-mono text-xs text-slate-500">
                  <div>Recharge Customer ID: <span className="font-semibold text-slate-800">{selectedItem.customer_id || "—"}</span></div>
                  <div>Subscription ID: <span className="font-semibold text-slate-800">{selectedItem.subscription_id || "—"}</span></div>
                  <div>Charge ID: <span className="font-semibold text-slate-800">{selectedItem.charge_id || "—"}</span></div>
                </div>
              </div>
            </div>

            <div className="pt-6 border-t border-slate-100 mt-6 flex gap-3">
              {selectedItem.gorgias_ticket_url && (
                <a
                  href={selectedItem.gorgias_ticket_url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex-1 text-center rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white shadow-sm hover:bg-indigo-700 transition-colors"
                >
                  Open in Gorgias ↗
                </a>
              )}
              {selectedItem.recharge_customer_url && (
                <a
                  href={selectedItem.recharge_customer_url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex-1 text-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  Recharge Profile ↗
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
