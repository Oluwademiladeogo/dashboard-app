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

const LOCAL_EXECUTOR_URL = "http://localhost:3000/subscription-change/execute";
const PRODUCTION_EXECUTOR_URL = "https://appyhourbox-app-cluxg.ondigitalocean.app/api/subscription-change/execute";

interface GorgiasMessage {
  message_id: string;
  ticket_id: string;
  from_agent: boolean | number;
  channel: string;
  body_text: string;
  created_at: string;
  sender_email?: string;
}

interface ApiResponse {
  success: boolean;
  stats: {
    total: number;
    totalDelaysAutomated: number;
    delays1w: number;
    delays2w: number;
    activeInquiries: number;
    shadowTests: number;
    uniqueCustomers: number;
  };
  items: SubChangeItem[];
}

export default function SubChangesPage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterMode, setFilterMode] = useState<"all" | "1w" | "2w" | "active" | "applied" | "shadow">("all");
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());
  const [selectedItem, setSelectedItem] = useState<SubChangeItem | null>(null);
  const [drawerMessages, setDrawerMessages] = useState<GorgiasMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyToClipboard = (text: string) => {
    try {
      navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore clipboard errors
    }
  };

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

  // Fetch thread messages when a row is selected
  useEffect(() => {
    if (!selectedItem) {
      setDrawerMessages([]);
      return;
    }
    const loadThread = async () => {
      setLoadingMessages(true);
      try {
        const res = await fetch(`/api/sub-changes?ticket_id=${selectedItem.ticket_id}`);
        if (res.ok) {
          const json = await res.json();
          if (json.messages && json.messages.length > 0) {
            setDrawerMessages(json.messages);
          } else {
            setDrawerMessages([]);
          }
        }
      } catch {
        setDrawerMessages([]);
      } finally {
        setLoadingMessages(false);
      }
    };
    loadThread();
  }, [selectedItem]);

  const getDelayDays = (item: SubChangeItem): number | null => {
    if (item.current_charge_date && item.target_date) {
      try {
        const d1 = new Date(item.current_charge_date.slice(0, 10));
        const d2 = new Date(item.target_date.slice(0, 10));
        const diff = Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
        if (!isNaN(diff) && diff > 0) return diff;
      } catch {
        // ignore
      }
    }
    const reason = (item.reason || "").toLowerCase();
    const text = (item.customer_text || "").toLowerCase();
    if (reason.includes("7 days") || reason.includes("1 week") || text === "1" || text.includes("1 week")) return 7;
    if (reason.includes("14 days") || reason.includes("2 weeks") || text === "2" || text.includes("2 weeks")) return 14;
    return null;
  };

  const computeDelta = (item: SubChangeItem) => {
    const days = getDelayDays(item);
    if (days !== null) {
      if (days >= 6 && days <= 8) return "+1 Week (+7d)";
      if (days >= 13 && days <= 15) return "+2 Weeks (+14d)";
      return `+${days} days`;
    }
    if (item.action === "skip") return "+1 cycle";
    return "Delay";
  };

  const buildExecutorPayload = (item: SubChangeItem) => ({
    source: "sms-delay-flow",
    request_id: `sms-delay-${item.ticket_id}-${item.target_date}`,
    ticket_id: item.ticket_id,
    customer_email: item.customer_email,
    customer_id: item.customer_id,
    subscription_id: item.subscription_id,
    charge_id: item.charge_id,
    charge_date: item.current_charge_date?.slice(0, 10) || null,
    action: "delay",
    delay_target: item.target_date,
  });

  const buildRunCommand = (item: SubChangeItem, url: string) =>
    `curl -X POST ${url} \\\n` +
    `  -H "Content-Type: application/json" \\\n` +
    `  -H "x-api-key: <API_KEY>" \\\n` +
    `  -d '${JSON.stringify(buildExecutorPayload(item), null, 2)}'`;

  // Short human phrase for how far the charge moves, e.g. "1 week".
  const deltaPhrase = (item: SubChangeItem): string => {
    const days = getDelayDays(item);
    if (days !== null) {
      if (days >= 6 && days <= 8) return "1 week";
      if (days >= 13 && days <= 15) return "2 weeks";
      return `${days} days`;
    }
    if (item.action === "skip") return "1 cycle";
    return "";
  };

  // One consolidated status per row: what will happen + which state it's in.
  const getStatus = (
    item: SubChangeItem
  ): { label: string; style: string; dot: string; pulse: boolean } => {
    const d = deltaPhrase(item);
    switch (item.decision) {
      case "APPLIED":
        return {
          label: d ? `Delayed ${d}` : "Applied",
          style: "bg-emerald-50 text-emerald-700 border-emerald-200",
          dot: "bg-emerald-500",
          pulse: true,
        };
      case "AWAITING_CHOICE":
        return {
          label: "Awaiting choice",
          style: "bg-purple-50 text-purple-700 border-purple-200",
          dot: "bg-purple-500",
          pulse: true,
        };
      case "SHADOW_AWAITING_CHOICE":
        return {
          label: "Shadow · menu sent",
          style: "bg-sky-50 text-sky-700 border-sky-200",
          dot: "bg-sky-500",
          pulse: false,
        };
      case "SHADOW_WOULD_APPLY":
        return {
          label: d ? `Shadow · would delay ${d}` : "Shadow · would apply",
          style: "bg-sky-50 text-sky-700 border-sky-200",
          dot: "bg-sky-500",
          pulse: false,
        };
      default:
        return {
          label: item.decision,
          style: "bg-slate-100 text-slate-600 border-slate-200",
          dot: "bg-slate-400",
          pulse: false,
        };
    }
  };

  const getTriggerType = (item: SubChangeItem): { label: string; style: string } => {
    const text = (item.customer_text || "").trim().toLowerCase();
    if (text === "modify" || text.startsWith("modify") || text.includes("reschedule")) {
      return { label: "MODIFY", style: "bg-purple-100 text-purple-800 border-purple-200" };
    }
    if (text === "1" || text.includes("1 week") || text === "delay 1 week") {
      return { label: "1 (Delay 1 Wk)", style: "bg-amber-100 text-amber-800 border-amber-200" };
    }
    if (text === "2" || text.includes("2 weeks") || text === "delay 2 weeks") {
      return { label: "2 (Delay 2 Wks)", style: "bg-indigo-100 text-indigo-800 border-indigo-200" };
    }
    return { label: "SMS", style: "bg-slate-100 text-slate-700 border-slate-200" };
  };

  const filteredItems = useMemo(() => {
    if (!data?.items) return [];
    return data.items.filter((item) => {
      const days = getDelayDays(item);

      if (filterMode === "1w") {
        if (!(days !== null && days >= 5 && days <= 9)) return false;
      } else if (filterMode === "2w") {
        if (!(days !== null && days >= 12 && days <= 16)) return false;
      } else if (filterMode === "active") {
        if (item.decision !== "AWAITING_CHOICE") return false;
      } else if (filterMode === "applied") {
        if (item.decision !== "APPLIED") return false;
      } else if (filterMode === "shadow") {
        if (!item.decision.startsWith("SHADOW_")) return false;
      }

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
  }, [data, filterMode, search]);

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "—";
    try {
      const d = new Date(dateStr.slice(0, 10));
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    } catch {
      return dateStr.slice(0, 10);
    }
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-800 antialiased selection:bg-indigo-500 selection:text-white">
      {/* Top Banner Header */}
      <header className="border-b border-slate-200/80 bg-white/90 backdrop-blur-md sticky top-0 z-30 px-6 py-4 lg:px-10">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between max-w-7xl mx-auto">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
                ENG-7 Live
              </span>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                Conversational SMS Delay Flow
              </h1>
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              Deterministic 2-step SMS delay automation (MODIFY ➔ 1 / 2) with real-time audit feed.
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
          <div className="relative overflow-hidden rounded-xl border border-emerald-200 bg-gradient-to-b from-emerald-50/50 to-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-emerald-700 uppercase tracking-wider">Total Delays Automated</span>
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
            </div>
            <div className="mt-2 text-2xl font-bold tracking-tight text-emerald-950">
              {data?.stats.totalDelaysAutomated ?? 0}
            </div>
          </div>

          <div className="relative overflow-hidden rounded-xl border border-amber-200 bg-gradient-to-b from-amber-50/50 to-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-amber-700 uppercase tracking-wider">1-Week Delays (+7d)</span>
              <span className="h-2 w-2 rounded-full bg-amber-500"></span>
            </div>
            <div className="mt-2 text-2xl font-bold tracking-tight text-amber-950">
              {data?.stats.delays1w ?? 0}
            </div>
          </div>

          <div className="relative overflow-hidden rounded-xl border border-indigo-200 bg-gradient-to-b from-indigo-50/50 to-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-indigo-700 uppercase tracking-wider">2-Week Delays (+14d)</span>
              <span className="h-2 w-2 rounded-full bg-indigo-500"></span>
            </div>
            <div className="mt-2 text-2xl font-bold tracking-tight text-indigo-950">
              {data?.stats.delays2w ?? 0}
            </div>
          </div>

          <div className="relative overflow-hidden rounded-xl border border-purple-200 bg-gradient-to-b from-purple-50/50 to-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-purple-700 uppercase tracking-wider">Active Inquiries</span>
              <span className="h-2 w-2 rounded-full bg-purple-500"></span>
            </div>
            <div className="mt-2 text-2xl font-bold tracking-tight text-purple-950">
              {data?.stats.activeInquiries ?? 0}
            </div>
          </div>

          <div className="relative overflow-hidden rounded-xl border border-slate-200/90 bg-white p-4 shadow-sm">
            <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Total Candidates</div>
            <div className="mt-2 text-2xl font-bold tracking-tight text-slate-900">
              {data?.stats.total ?? 0}
            </div>
          </div>
        </div>

        {/* Filter Toolbar */}
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
            <button
              onClick={() => setFilterMode("all")}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-all ${
                filterMode === "all" ? "bg-slate-900 text-white shadow-sm" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              All ({data?.stats.total ?? 0})
            </button>
            <button
              onClick={() => setFilterMode("1w")}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-all ${
                filterMode === "1w" ? "bg-amber-600 text-white shadow-sm" : "text-slate-600 hover:text-amber-600"
              }`}
            >
              Delay 1 Week ({data?.stats.delays1w ?? 0})
            </button>
            <button
              onClick={() => setFilterMode("2w")}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-all ${
                filterMode === "2w" ? "bg-indigo-600 text-white shadow-sm" : "text-slate-600 hover:text-indigo-600"
              }`}
            >
              Delay 2 Weeks ({data?.stats.delays2w ?? 0})
            </button>
            <button
              onClick={() => setFilterMode("active")}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-all ${
                filterMode === "active" ? "bg-purple-600 text-white shadow-sm" : "text-slate-600 hover:text-purple-600"
              }`}
            >
              Active Inquiries ({data?.stats.activeInquiries ?? 0})
            </button>
            <button
              onClick={() => setFilterMode("shadow")}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-all ${
                filterMode === "shadow" ? "bg-sky-600 text-white shadow-sm" : "text-slate-600 hover:text-sky-600"
              }`}
            >
              Shadow Tests ({data?.stats.shadowTests ?? 0})
            </button>
          </div>

          <div className="relative w-full sm:w-80">
            <input
              type="text"
              placeholder="Search customer, email, ticket, or reply..."
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

        {/* Table */}
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
              <thead className="bg-[#f8fafc] text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="py-3.5 pl-6 pr-4">Ticket & Customer</th>
                  <th className="px-4 py-3.5">Inbound Trigger Message</th>
                  <th className="px-4 py-3.5">Status</th>
                  <th className="py-3.5 pl-4 pr-6">Recharge Account</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100 bg-white">
                {loading && !data ? (
                  <tr>
                    <td colSpan={4} className="py-16 text-center text-slate-400">
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
                    <td colSpan={4} className="py-16 text-center text-slate-400">
                      <div className="mx-auto max-w-sm">
                        <div className="text-2xl mb-1">🔍</div>
                        <div className="font-medium text-slate-700 text-xs">No candidate tickets found</div>
                        <div className="text-[11px] text-slate-400 mt-0.5">Try adjusting your filters or search terms.</div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredItems.map((item) => {
                    const trigger = getTriggerType(item);
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

                        {/* Customer Inbound Message */}
                        <td className="px-4 py-4 align-top max-w-md">
                          <div className="flex items-center gap-2 mb-1.5">
                            <span className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider border ${trigger.style}`}>
                              {trigger.label}
                            </span>
                            {item.subject && (
                              <span className="text-[11px] text-slate-500 truncate max-w-[220px]">
                                {item.subject}
                              </span>
                            )}
                          </div>
                          <div className="relative rounded-lg bg-slate-50/90 p-2.5 border border-slate-200/60 group-hover:bg-white group-hover:border-slate-300 transition-all">
                            <p className="text-xs text-slate-700 leading-relaxed font-sans line-clamp-2">
                              "{item.customer_text || "—"}"
                            </p>
                          </div>
                        </td>

                        {/* Status (single consolidated label) */}
                        <td className="px-4 py-4 align-top whitespace-nowrap">
                          {(() => {
                            const st = getStatus(item);
                            return (
                              <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${st.style}`}>
                                <span className={`h-1.5 w-1.5 rounded-full ${st.dot} ${st.pulse ? "animate-pulse" : ""}`} />
                                {st.label}
                              </span>
                            );
                          })()}
                        </td>

                        {/* Recharge Account */}
                        <td className="py-4 pl-4 pr-6 align-top whitespace-nowrap font-mono text-xs">
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
            className="w-full max-w-lg bg-white p-6 shadow-2xl border-l border-slate-200 overflow-y-auto flex flex-col justify-between"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200">
                    Ticket #{selectedItem.ticket_id}
                  </span>
                  {(() => {
                    const st = getStatus(selectedItem);
                    return (
                      <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${st.style}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${st.dot} ${st.pulse ? "animate-pulse" : ""}`} />
                        {st.label}
                      </span>
                    );
                  })()}
                </div>
                <button
                  onClick={() => setSelectedItem(null)}
                  className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  ✕
                </button>
              </div>

              <div className="mt-5 space-y-4">
                {/* Customer Details */}
                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Customer</label>
                  <div className="text-sm font-semibold text-slate-900 mt-0.5">
                    {selectedItem.customer_name || selectedItem.customer_email.split("@")[0]}
                  </div>
                  <div className="text-xs font-mono text-slate-500">{selectedItem.customer_email}</div>
                </div>

                {/* Schedule Transition Card */}
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div className="rounded-lg border border-slate-200 p-3 bg-slate-50/60">
                    <div className="text-[10px] font-semibold uppercase text-slate-400">Original Bill Date</div>
                    <div className="mt-1 text-xs font-bold text-slate-700 font-mono">
                      {formatDate(selectedItem.current_charge_date)}
                    </div>
                  </div>
                  <div className="rounded-lg border border-emerald-200 p-3 bg-emerald-50/40">
                    <div className="text-[10px] font-semibold uppercase text-emerald-700">Delayed Bill Date</div>
                    <div className="mt-1 text-xs font-bold text-emerald-900 font-mono">
                      {selectedItem.target_date ? formatDate(selectedItem.target_date) : "Awaiting Selection"}
                    </div>
                    <div className="mt-1 text-[10px] font-semibold text-emerald-700">
                      {computeDelta(selectedItem)}
                    </div>
                  </div>
                </div>

                {/* SMS Conversation Transcript */}
                <div className="pt-2">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      SMS Conversation Transcript
                    </label>
                    {loadingMessages && (
                      <span className="text-[10px] text-slate-400 animate-pulse">Loading live thread...</span>
                    )}
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 space-y-3 max-h-80 overflow-y-auto font-sans text-xs">
                    {drawerMessages.filter((m) => (m.body_text || "").trim().length > 0).length > 0 ? (
                      drawerMessages.filter((m) => (m.body_text || "").trim().length > 0).map((m) => {
                        const isAgent = Boolean(m.from_agent);
                        return (
                          <div
                            key={m.message_id}
                            className={`flex flex-col ${isAgent ? "items-end" : "items-start"}`}
                          >
                            <span className="text-[10px] font-semibold text-slate-400 mb-0.5">
                              {isAgent ? "AppyHour Bot (SMS)" : "Customer (SMS)"}
                            </span>
                            <div
                              className={`rounded-2xl px-3.5 py-2.5 max-w-[85%] whitespace-pre-wrap leading-relaxed shadow-xs ${
                                isAgent
                                  ? "bg-indigo-600 text-white rounded-br-xs"
                                  : "bg-white text-slate-800 border border-slate-200 rounded-bl-xs"
                              }`}
                            >
                              {m.body_text}
                            </div>
                            <span className="text-[9px] text-slate-400 mt-0.5">
                              {new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            </span>
                          </div>
                        );
                      })
                    ) : (
                      // Fallback synthetic transcript from persisted preview record
                      <div className="space-y-3">
                        {/* Step 1 Customer Inbound */}
                        <div className="flex flex-col items-start">
                          <span className="text-[10px] font-semibold text-slate-400 mb-0.5">Customer (SMS)</span>
                          <div className="rounded-2xl rounded-bl-xs bg-white text-slate-800 border border-slate-200 px-3.5 py-2.5 max-w-[85%] leading-relaxed shadow-xs">
                            {selectedItem.customer_text || "MODIFY"}
                          </div>
                        </div>

                        {/* Bot Menu Prompt */}
                        <div className="flex flex-col items-end">
                          <span className="text-[10px] font-semibold text-slate-400 mb-0.5">AppyHour Bot (SMS)</span>
                          <div className="rounded-2xl rounded-br-xs bg-indigo-600 text-white px-3.5 py-2.5 max-w-[85%] leading-relaxed shadow-xs">
                            Your next AppyHour box bills on {formatDate(selectedItem.current_charge_date)}. Reply with 1 or 2 to:
                            <br /><br />
                            1. Delay 1 week<br />
                            2. Delay 2 weeks
                          </div>
                        </div>

                        {/* If Applied: Step 2 Choice & Confirmation */}
                        {(selectedItem.decision === "APPLIED" || selectedItem.decision === "SHADOW_WOULD_APPLY") && (
                          <>
                            <div className="flex flex-col items-start">
                              <span className="text-[10px] font-semibold text-slate-400 mb-0.5">Customer (SMS)</span>
                              <div className="rounded-2xl rounded-bl-xs bg-white text-slate-800 border border-slate-200 px-3.5 py-2.5 max-w-[85%] leading-relaxed shadow-xs">
                                {computeDelta(selectedItem).includes("14d") ? "2" : "1"}
                              </div>
                            </div>
                            <div className="flex flex-col items-end">
                              <span className="text-[10px] font-semibold text-slate-400 mb-0.5">AppyHour Bot (SMS)</span>
                              <div className="rounded-2xl rounded-br-xs bg-indigo-600 text-white px-3.5 py-2.5 max-w-[85%] leading-relaxed shadow-xs">
                                You're all set! Your next AppyHour box now bills on {formatDate(selectedItem.target_date)}.
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Account Identifiers */}
                <div className="space-y-1.5 pt-2 font-mono text-xs text-slate-500">
                  <div>Recharge Customer ID: <span className="font-semibold text-slate-800">{selectedItem.customer_id || "—"}</span></div>
                  <div>Subscription ID: <span className="font-semibold text-slate-800">{selectedItem.subscription_id || "—"}</span></div>
                  <div>Charge ID: <span className="font-semibold text-slate-800">{selectedItem.charge_id || "—"}</span></div>
                </div>

                {selectedItem.decision === "SHADOW_WOULD_APPLY" && selectedItem.target_date && (
                  <details className="rounded-lg border border-sky-200 bg-sky-50/50 p-3 text-xs" open>
                    <summary className="cursor-pointer font-semibold text-sky-900">Run this charge</summary>
                    <div className="mt-3 space-y-2">
                      <p className="text-[11px] text-slate-500">
                        Copy and paste into a terminal to actually apply this delay. Replace{" "}
                        <code className="text-slate-700">&lt;API_KEY&gt;</code> with the AdminApp key. This hits the local backend; swap in the production URL below once it&apos;s deployed.
                      </p>
                      <pre className="max-h-64 overflow-auto rounded-md border border-sky-100 bg-white p-3 text-[11px] leading-relaxed text-slate-700 whitespace-pre-wrap break-words">
                        {buildRunCommand(selectedItem, LOCAL_EXECUTOR_URL)}
                      </pre>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(buildRunCommand(selectedItem, LOCAL_EXECUTOR_URL))}
                        className={`w-full inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-semibold text-white shadow-sm transition-colors ${
                          copied ? "bg-emerald-600" : "bg-sky-600 hover:bg-sky-700"
                        }`}
                      >
                        {copied ? (
                          <>✓ Copied to clipboard</>
                        ) : (
                          <>
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                            Click to copy command to clipboard
                          </>
                        )}
                      </button>
                      <div className="text-[11px] text-slate-400 break-all">
                        Production URL: {PRODUCTION_EXECUTOR_URL}
                      </div>
                    </div>
                  </details>
                )}
              </div>
            </div>

            {/* Bottom Actions */}
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
