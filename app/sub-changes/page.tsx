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
  const [testEmail, setTestEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const [showQuickTest, setShowQuickTest] = useState(false);
  const [quickTestEmail, setQuickTestEmail] = useState("demi@elevatefoods.co");
  const [quickTestSending, setQuickTestSending] = useState(false);
  const [quickTestResult, setQuickTestResult] = useState<{ ok: boolean; msg: string; properties?: any } | null>(null);

  const runQuickTest = async () => {
    if (!quickTestEmail.trim()) return;
    setQuickTestSending(true);
    setQuickTestResult(null);
    try {
      const res = await fetch("/api/trigger-upcoming-charge/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: quickTestEmail.trim(),
          use_live_recharge: true,
        }),
      });
      const resData = await res.json();
      setQuickTestResult({
        ok: Boolean(resData.success),
        msg: resData.message || (resData.success ? "Test SMS reminder fired successfully" : "Failed"),
        properties: resData.properties,
      });
    } catch (err) {
      setQuickTestResult({
        ok: false,
        msg: err instanceof Error ? err.message : "Request failed",
      });
    } finally {
      setQuickTestSending(false);
    }
  };

  const copyToClipboard = (text: string) => {
    try {
      navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore clipboard errors
    }
  };

  const sendUpcomingChargeTest = async (item: SubChangeItem, email: string) => {
    setSending(true);
    setSendResult(null);
    try {
      const res = await fetch("/api/trigger-upcoming-charge/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          customer_id: item.customer_id,
          subscription_id: item.subscription_id,
          charge_id: item.charge_id,
          scheduled_at: item.current_charge_date,
          customer_portal_link: item.recharge_customer_url,
          ticket_id: item.ticket_id,
        }),
      });
      const data = await res.json();
      setSendResult({ ok: Boolean(data.success), msg: data.message || (data.success ? "Sent" : "Failed") });
    } catch (err) {
      setSendResult({ ok: false, msg: err instanceof Error ? err.message : "Request failed" });
    } finally {
      setSending(false);
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

  // Reset the test-SMS panel whenever a different row is opened
  useEffect(() => {
    setTestEmail(selectedItem?.customer_email || "");
    setSendResult(null);
  }, [selectedItem?.id]);

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
      case "MANUAL_RUN_NEEDED":
        return {
          label: d ? `Run manually · delay ${d}` : "Run manually",
          style: "bg-amber-50 text-amber-800 border-amber-200",
          dot: "bg-amber-500",
          pulse: true,
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
    <div className="min-h-screen bg-slate-50 font-sans text-slate-800 antialiased selection:bg-indigo-500 selection:text-white [background-image:radial-gradient(circle_at_top,rgba(99,102,241,0.05),transparent_55%)]">
      {/* Top Banner Header */}
      <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-white/80 px-6 py-4 backdrop-blur-xl lg:px-10">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                </span>
                ENG-7 Live
              </span>
              <h1 className="text-[1.7rem] font-bold leading-none tracking-tight text-slate-900">
                Conversational SMS Delay Flow
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <div className="flex items-center gap-1.5 rounded-lg border border-slate-200/70 bg-slate-100/70 px-2.5 py-1.5 text-[11px] font-medium text-slate-500">
              <svg className="h-3.5 w-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="tabular-nums" suppressHydrationWarning>{lastRefreshed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
            </div>
            <button
              onClick={() => setShowQuickTest(!showQuickTest)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-xs font-semibold shadow-sm transition-all duration-150 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/40 ${
                showQuickTest
                  ? "border-purple-600 bg-purple-600 text-white hover:bg-purple-700"
                  : "border-purple-200 bg-white text-purple-700 hover:border-purple-300 hover:bg-purple-50"
              }`}
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              <span>{showQuickTest ? "Close Test Panel" : "Test SMS Flow"}</span>
            </button>
            <button
              onClick={fetchData}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-sm transition-all duration-150 hover:border-slate-300 hover:bg-slate-50 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/40 disabled:opacity-50 disabled:active:scale-100"
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
        {/* Quick Test Panel */}
        {showQuickTest && (
          <div className="animate-panel-in mb-8 overflow-hidden rounded-2xl border border-purple-200/80 bg-white shadow-sm ring-1 ring-purple-500/5">
            <div className="h-1 w-full bg-gradient-to-r from-purple-500 via-fuchsia-500 to-purple-500" />
            <div className="bg-gradient-to-br from-purple-50/60 via-white to-white p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="max-w-xl">
                  <div className="flex items-center gap-2.5">
                    <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-purple-600 to-fuchsia-600 text-sm text-white shadow-sm">
                      ⚡
                    </span>
                    <h3 className="text-sm font-semibold tracking-tight text-purple-950">Live Klaviyo &amp; Recharge Test Flow</h3>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-slate-600">
                    Queries the customer&apos;s live active subscription &amp; next queued charge in Recharge, then fires the{" "}
                    <code className="rounded bg-purple-100/80 px-1.5 py-0.5 font-mono text-[11px] text-purple-900">ENG-7 Test Upcoming Charge</code>{" "}
                    event with their actual renewal date.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="email"
                    value={quickTestEmail}
                    onChange={(e) => setQuickTestEmail(e.target.value)}
                    placeholder="demi@elevatefoods.co"
                    className="w-64 rounded-lg border border-purple-200 bg-white px-3 py-2 text-xs text-slate-800 shadow-sm transition placeholder:text-slate-400 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/30"
                  />
                  <button
                    onClick={runQuickTest}
                    disabled={quickTestSending || !quickTestEmail.trim()}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-b from-purple-600 to-purple-700 px-4 py-2 text-xs font-semibold text-white shadow-sm transition-all duration-150 hover:from-purple-500 hover:to-purple-600 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/40 disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100"
                  >
                    {quickTestSending ? (
                      <>
                        <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        <span>Looking up Recharge &amp; firing…</span>
                      </>
                    ) : (
                      <>
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                        <span>Fire Live Test SMS</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {quickTestResult && (
                <div
                  className={`animate-panel-in mt-4 rounded-xl border p-3.5 text-xs ${
                    quickTestResult.ok
                      ? "border-emerald-200 bg-emerald-50/70 text-emerald-900"
                      : "border-rose-200 bg-rose-50/70 text-rose-900"
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <span
                      className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white ${
                        quickTestResult.ok ? "bg-emerald-500" : "bg-rose-500"
                      }`}
                    >
                      {quickTestResult.ok ? "✓" : "✕"}
                    </span>
                    <div className="flex-1">
                      <p className="font-medium leading-relaxed">{quickTestResult.msg}</p>
                      {quickTestResult.properties && (
                        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                          {[
                            { label: "Scheduled", value: quickTestResult.properties.scheduled_at },
                            { label: "Delivery", value: quickTestResult.properties.delivery_window },
                            { label: "Sub ID", value: quickTestResult.properties.subscription_id },
                            { label: "Charge ID", value: quickTestResult.properties.charge_id },
                          ].map((pill) => (
                            <div
                              key={pill.label}
                              className="rounded-lg border border-emerald-200/70 bg-white/80 px-2.5 py-1.5"
                            >
                              <div className="text-[9px] font-semibold uppercase tracking-wider text-emerald-600">{pill.label}</div>
                              <div className="mt-0.5 truncate font-mono text-[11px] font-medium text-slate-700">{pill.value || "—"}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
        {/* KPI Stats Grid */}
        <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-5">
          {[
            {
              label: "Delays Automated",
              value: data?.stats.totalDelaysAutomated ?? 0,
              accent: "bg-emerald-500", label_c: "text-emerald-700", value_c: "text-emerald-950",
              tint: "from-emerald-50/70", pulse: true,
            },
            {
              label: "1-Week Delays", note: "+7d",
              value: data?.stats.delays1w ?? 0,
              accent: "bg-amber-500", label_c: "text-amber-700", value_c: "text-amber-950",
              tint: "from-amber-50/70", pulse: false,
            },
            {
              label: "2-Week Delays", note: "+14d",
              value: data?.stats.delays2w ?? 0,
              accent: "bg-indigo-500", label_c: "text-indigo-700", value_c: "text-indigo-950",
              tint: "from-indigo-50/70", pulse: false,
            },
            {
              label: "Active Inquiries",
              value: data?.stats.activeInquiries ?? 0,
              accent: "bg-purple-500", label_c: "text-purple-700", value_c: "text-purple-950",
              tint: "from-purple-50/70", pulse: false,
            },
            {
              label: "Total Candidates",
              value: data?.stats.total ?? 0,
              accent: "bg-slate-400", label_c: "text-slate-500", value_c: "text-slate-900",
              tint: "from-slate-100/70", pulse: false,
            },
          ].map((card) => (
            <div
              key={card.label}
              className={`group relative overflow-hidden rounded-2xl border border-slate-200/70 bg-gradient-to-b ${card.tint} to-white p-4 shadow-sm transition-shadow hover:shadow-md`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex flex-col">
                  <span className={`text-[10.5px] font-semibold uppercase tracking-wider ${card.label_c}`}>{card.label}</span>
                  {card.note && <span className="mt-0.5 text-[10px] font-medium text-slate-400">{card.note}</span>}
                </div>
                <span className="relative flex h-2 w-2 shrink-0">
                  {card.pulse && <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${card.accent}`} />}
                  <span className={`relative inline-flex h-2 w-2 rounded-full ${card.accent}`} />
                </span>
              </div>
              <div className={`mt-3 text-[1.75rem] font-bold leading-none tracking-tight tabular-nums ${card.value_c}`}>
                {card.value}
              </div>
            </div>
          ))}
        </div>

        {/* Filter Toolbar */}
        <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="inline-flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
            {([
              { key: "all", label: "All", count: data?.stats.total ?? 0, active: "bg-slate-900 text-white", badge: "bg-white/20 text-white", hover: "hover:text-slate-900" },
              { key: "1w", label: "Delay 1 Week", count: data?.stats.delays1w ?? 0, active: "bg-amber-500 text-white", badge: "bg-white/25 text-white", hover: "hover:text-amber-600" },
              { key: "2w", label: "Delay 2 Weeks", count: data?.stats.delays2w ?? 0, active: "bg-indigo-600 text-white", badge: "bg-white/25 text-white", hover: "hover:text-indigo-600" },
              { key: "active", label: "Active Inquiries", count: data?.stats.activeInquiries ?? 0, active: "bg-purple-600 text-white", badge: "bg-white/25 text-white", hover: "hover:text-purple-600" },
              { key: "shadow", label: "Shadow Tests", count: data?.stats.shadowTests ?? 0, active: "bg-sky-600 text-white", badge: "bg-white/25 text-white", hover: "hover:text-sky-600" },
            ] as const).map((tab) => {
              const isActive = filterMode === tab.key;
              return (
                <button
                  key={tab.key}
                  onClick={() => setFilterMode(tab.key as typeof filterMode)}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/40 ${
                    isActive ? `${tab.active} shadow-sm` : `text-slate-600 ${tab.hover}`
                  }`}
                >
                  {tab.label}
                  <span
                    className={`inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${
                      isActive ? tab.badge : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="relative w-full lg:w-80">
            <input
              type="text"
              placeholder="Search customer, email, ticket, or reply…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-8 text-xs text-slate-900 shadow-sm transition-all placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/25"
            />
            <svg className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                aria-label="Clear search"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Error Notification */}
        {error && (
          <div className="animate-panel-in mb-5 flex items-center gap-2.5 rounded-xl border border-red-200 bg-red-50 p-4 text-xs font-medium text-red-700">
            <svg className="h-4 w-4 shrink-0 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        {/* Table */}
        <div className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50/80 text-[10.5px] font-semibold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="py-3.5 pl-6 pr-4 font-semibold">Ticket &amp; Customer</th>
                  <th className="px-4 py-3.5 font-semibold">Inbound Trigger Message</th>
                  <th className="px-4 py-3.5 font-semibold">Status</th>
                  <th className="py-3.5 pl-4 pr-6 font-semibold">Recharge Account</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100 bg-white">
                {loading && !data ? (
                  <tr>
                    <td colSpan={4} className="py-20 text-center text-slate-400">
                      <div className="inline-flex items-center gap-2 text-xs font-medium">
                        <svg className="h-4 w-4 animate-spin text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        <span>Loading verified candidates…</span>
                      </div>
                    </td>
                  </tr>
                ) : filteredItems.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-20 text-center text-slate-400">
                      <div className="mx-auto max-w-sm">
                        <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-lg">🔍</div>
                        <div className="text-xs font-semibold text-slate-700">No candidate tickets found</div>
                        <div className="mt-1 text-[11px] text-slate-400">Try adjusting your filters or search terms.</div>
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
                        <td className="max-w-md px-4 py-4 align-top">
                          <div className="mb-1.5 flex items-center gap-2">
                            <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${trigger.style}`}>
                              {trigger.label}
                            </span>
                            {item.subject && (
                              <span className="max-w-[220px] truncate text-[11px] text-slate-500">
                                {item.subject}
                              </span>
                            )}
                          </div>
                          <div className="relative rounded-lg border border-slate-200/60 bg-slate-50/80 p-2.5 transition-all group-hover:border-slate-300 group-hover:bg-white">
                            <p className="line-clamp-2 font-sans text-xs leading-relaxed text-slate-700">
                              &ldquo;{item.customer_text || "—"}&rdquo;
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
        <div className="animate-overlay-in fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-sm" onClick={() => setSelectedItem(null)}>
          <div
            className="animate-drawer-in flex w-full max-w-lg flex-col justify-between overflow-y-auto border-l border-slate-200 bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div className="flex items-center gap-2">
                  <span className="rounded-md border border-indigo-200 bg-indigo-50 px-2 py-0.5 font-mono text-xs font-bold text-indigo-600">
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
                  className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/40"
                  aria-label="Close panel"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="mt-5 space-y-4">
                {/* Customer Details */}
                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Customer</label>
                  <div className="mt-0.5 text-sm font-semibold text-slate-900">
                    {selectedItem.customer_name || selectedItem.customer_email.split("@")[0]}
                  </div>
                  <div className="font-mono text-xs text-slate-500">{selectedItem.customer_email}</div>
                </div>

                {/* Schedule Transition Card */}
                <div className="relative grid grid-cols-2 gap-3 pt-1">
                  <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Original Bill Date</div>
                    <div className="mt-1 font-mono text-xs font-bold text-slate-700">
                      {formatDate(selectedItem.current_charge_date)}
                    </div>
                  </div>
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700">Delayed Bill Date</div>
                    <div className="mt-1 font-mono text-xs font-bold text-emerald-900">
                      {selectedItem.target_date ? formatDate(selectedItem.target_date) : "Awaiting Selection"}
                    </div>
                    <div className="mt-1 text-[10px] font-semibold text-emerald-700">
                      {computeDelta(selectedItem)}
                    </div>
                  </div>
                  <span className="pointer-events-none absolute left-1/2 top-1/2 flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 shadow-sm">
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                    </svg>
                  </span>
                </div>

                {/* Run this exact charge — prominent, right under the dates */}
                {(selectedItem.decision === "SHADOW_WOULD_APPLY" || selectedItem.decision === "MANUAL_RUN_NEEDED") && selectedItem.target_date && (
                  <div className="rounded-lg border-2 border-sky-300 bg-sky-50 p-3.5 shadow-sm">
                    {selectedItem.decision === "MANUAL_RUN_NEEDED" && (
                      <p className="mb-2 rounded-md bg-amber-100 px-2 py-1 text-[11px] font-medium text-amber-800">
                        Auto-run couldn&apos;t reach the backend. Run it here to move the charge.
                      </p>
                    )}
                    <div className="flex items-center gap-1.5 text-sm font-bold text-sky-900">
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      Run this exact charge
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500">
                      Paste in a terminal to move this charge for real — swap <code className="text-slate-700">&lt;API_KEY&gt;</code> for the AdminApp key.
                    </p>
                    <pre className="mt-2 max-h-44 overflow-auto rounded-md border border-sky-100 bg-white p-3 text-[11px] leading-relaxed text-slate-700 whitespace-pre-wrap break-words">
                      {buildRunCommand(selectedItem, LOCAL_EXECUTOR_URL)}
                    </pre>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(buildRunCommand(selectedItem, LOCAL_EXECUTOR_URL))}
                      className={`mt-2 w-full inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-semibold text-white shadow-sm transition-colors ${
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
                  </div>
                )}

                {/* ENG-7 Upcoming-Charge Test SMS */}
                <div className="rounded-lg border-2 border-violet-300 bg-violet-50 p-3.5 shadow-sm">
                  <div className="flex items-center gap-1.5 text-sm font-bold text-violet-900">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 3v-3z" />
                    </svg>
                    Send upcoming-charge test SMS
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Fires the <code className="text-slate-700">ENG-7 Test Upcoming Charge</code> metric with this row&apos;s
                    charge date &amp; portal link. Only test profiles can receive it.
                  </p>
                  <label className="mt-2.5 block text-[10px] font-semibold uppercase tracking-wider text-violet-700">
                    Send to
                  </label>
                  <input
                    type="email"
                    value={testEmail}
                    onChange={(e) => setTestEmail(e.target.value)}
                    placeholder="demi@elevatefoods.co"
                    className="mt-1 w-full rounded-md border border-violet-200 bg-white px-3 py-2 text-xs font-mono text-slate-800 focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-300"
                  />
                  <button
                    type="button"
                    disabled={sending || !testEmail.trim()}
                    onClick={() => sendUpcomingChargeTest(selectedItem, testEmail.trim())}
                    className={`mt-2 w-full inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-semibold text-white shadow-sm transition-colors ${
                      sending || !testEmail.trim() ? "bg-violet-300 cursor-not-allowed" : "bg-violet-600 hover:bg-violet-700"
                    }`}
                  >
                    {sending ? "Sending…" : "Fire test SMS"}
                  </button>
                  {sendResult && (
                    <div
                      className={`mt-2 rounded-md px-2.5 py-2 text-[11px] font-medium ${
                        sendResult.ok
                          ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                          : "bg-rose-50 text-rose-800 border border-rose-200"
                      }`}
                    >
                      {sendResult.ok ? "✓ " : "✕ "}
                      {sendResult.msg}
                    </div>
                  )}
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
