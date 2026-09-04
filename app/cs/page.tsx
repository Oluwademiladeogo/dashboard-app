"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";

// ── payload types (mirror cs-metrics-report/cs_metrics/metrics.py) ───────────
interface Cell {
  tickets_created: number;
  messages_sent: number;
  frt_display: string;
  frt_seconds: number | null;
  frt_count: number;
}
interface AgentRow {
  name: string;
  messages_sent: number;
  tickets_touched: number;
  csat: number | null;
  csat_count: number | null;
  days_worked: number;
  schedule_source: string;
  tph: number | null;
}
// Business-hours SLA cell (segment × customer type). See cs-metrics-report
// reporting.py _segment_cell / _segments.
interface SegmentCell {
  evaluated: number;
  achieved: number;
  breached: number;
  pending: number;
  achievement_rate: number | null;
  tickets_created: number;
  messages_sent: number;
}
interface Segment {
  sla_policy_uuid: string;
  channel_note: string;
  subset_of: string | null;
  by_customer_type: Record<string, SegmentCell>;
  totals: SegmentCell & {
    frt_reference_24_7_seconds: number | null;
    frt_reference_24_7_display: string;
  };
}
interface Metrics {
  window_start: string;
  window_end: string;
  timezone: string;
  generated_at: string;
  source?: {
    provider?: string;
    dataset?: string;
    auth_mode?: string;
    reporting_endpoint?: string;
    timezone?: string;
  };
  summary: {
    tickets_created: number;
    tickets_created_filtered?: number;
    tickets_created_unfiltered?: number;
    tickets_closed: number | null;
    messages_sent: number;
    messages_sent_filtered?: number;
    filtered_segments?: string[];
    frt_display: string;
    frt_seconds: number | null;
    frt_reference_24_7_display?: string;
    resolution_display: string;
    resolution_seconds: number | null;
    csat_avg: number | null;
    csat_count: number;
  };
  sla?: {
    source?: string;
    policy_identifier?: string[];
    evaluated: number;
    achieved: number;
    breached: number;
    pending: number;
    achievement_rate: number | null;
    daily: Record<string, {
      evaluated: number;
      achieved: number;
      breached: number;
      pending: number;
    }>;
  };
  segments?: Record<string, Segment>;
  channel_table?: Record<string, Record<string, Cell>>;
  // Business-hours SLA & FRT (Jess's report), computed from warehouse timestamps.
  sla_frt?: {
    business_hours?: string;
    unanswered_counts_as?: string;
    table: Record<string, Record<string, {
      breached: number;
      breached_answered: number;
      achieved: number;
      pending: number;
      tickets: number;
      frt_breached_seconds: number | null;
      frt_breached_display: string;
      frt_achieved_seconds: number | null;
      frt_achieved_display: string;
    }>>;
  };
  agents: Record<string, AgentRow>;
  top_drivers: Record<string, [string, number][]>;
  heatmap: Record<string, number>;
}
interface WindowInfo {
  window_kind: string;
  window_start: string;
  window_end: string;
  generated_at: string;
}
interface ScheduleRow {
  agent_email: string;
  agent_name: string | null;
  date: string;
  status: string;
  note: string | null;
}
interface ReportFile {
  name: string;
  size: number;
  modified: string;
}
interface ReportGroup {
  key: string;
  label: string;
  modified: string;
  files: ReportFile[];
}
interface ExplorerResult {
  metrics: {
    ticketsCreated: number;
    messagesSent: number;
    frtSeconds: number | null;
    frtDisplay: string;
    frtCount: number | null;
  };
  providerMetrics?: Metrics;
  options: { channels: string[]; customerTypes: string[] };
  coverage: { messageRows: number; from: string | null; to: string | null };
  definitions: { sms: string; frt: string };
}

const KINDS = [
  { key: "7d", label: "Last 7 Days" },
  { key: "14d", label: "Last 14 Days" },
  { key: "week", label: "Weekly (Thu–Wed)" },
  { key: "custom", label: "Custom" },
];
const CHANNEL_ORDER = ["Email", "Chat", "Help Center", "SMS"];
const CTYPE_ORDER = ["Lead", "New (1 Order)", "Recurring"];
const DRIVER_ORDER = ["All customer types", "New (1 Order)", "Recurring"];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const STATUS_CYCLE = ["present", "half_day", "leave", "sick", "absent", "off"];
const STATUS_STYLE: Record<string, string> = {
  present: "bg-emerald-100 text-emerald-800",
  half_day: "bg-amber-100 text-amber-800",
  leave: "bg-blue-100 text-blue-800",
  sick: "bg-purple-100 text-purple-800",
  absent: "bg-red-100 text-red-800",
  off: "bg-slate-100 text-slate-400",
};
const STATUS_SHORT: Record<string, string> = {
  present: "P", half_day: "½", leave: "L", sick: "S", absent: "A", off: "—",
};

// ── shared UI primitives (mirrors app/cost/page.tsx & app/food-safety) ───────
const ACCENT_STYLES = {
  blue: "bg-blue-50/40",
  green: "bg-emerald-50/40",
  amber: "bg-amber-50/40",
  red: "bg-red-50/40",
  neutral: "bg-white",
} as const;
const ACCENT_DOTS = {
  blue: "bg-blue-500",
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
  neutral: "bg-slate-300",
} as const;
const VALUE_STYLES = {
  blue: "text-blue-700",
  green: "text-emerald-700",
  amber: "text-amber-700",
  red: "text-red-700",
  neutral: "text-slate-900",
} as const;
type Accent = keyof typeof ACCENT_STYLES;

function StatCard({ label, value, sub, accent = "neutral" }: {
  label: string; value: string; sub?: string; accent?: Accent;
}) {
  return (
    <div className={`rounded-xl border border-slate-200 p-4 ${ACCENT_STYLES[accent]}`}>
      <p className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        <span className={`h-1.5 w-1.5 rounded-full ${ACCENT_DOTS[accent]}`} aria-hidden="true" />
        {label}
      </p>
      <p className={`text-2xl font-bold leading-none ${VALUE_STYLES[accent]}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-1.5">{sub}</p>}
    </div>
  );
}

function Card({ title, sub, children, headerRight, className = "" }: {
  title?: string; sub?: string; children: React.ReactNode;
  headerRight?: React.ReactNode; className?: string;
}) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-white p-5 ${className}`}>
      {(title || headerRight) && (
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            {title && <h3 className="text-sm font-semibold text-slate-800">{title}</h3>}
            {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
          </div>
          {headerRight && <div className="flex-shrink-0">{headerRight}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

function Segmented<T extends string>({ value, onChange, options }: {
  value: T; onChange: (v: T) => void; options: { key: T; label: string }[];
}) {
  return (
    <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
      {options.map((o) => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          className={`min-h-8 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${
            value === o.key ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function MetricRail({ metrics }: { metrics: Metrics }) {
  const sla = metrics.sla;
  const rate = sla?.achievement_rate;
  const items = [
    { label: "Messages sent", value: metrics.summary.messages_sent.toLocaleString(), detail: "provider total", tone: "text-slate-900" },
    { label: "SLA achievement", value: rate != null ? `${(rate * 100).toFixed(1)}%` : "n/a", detail: `${sla?.achieved ?? 0} / ${sla?.evaluated ?? 0} evaluated`, tone: "text-emerald-700" },
    { label: "SLA breaches", value: (sla?.breached ?? 0).toLocaleString(), detail: "SLA breaches", tone: "text-rose-700" },
    { label: "Median first response", value: metrics.summary.frt_display || "n/a", detail: "24/7 reference — not business hrs", tone: "text-amber-700" },
    { label: "CSAT", value: metrics.summary.csat_avg != null ? metrics.summary.csat_avg.toFixed(2) : "n/a", detail: `${metrics.summary.csat_count} responses`, tone: "text-sky-700" },
  ];
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white" aria-label="CS performance summary">
      <div className="grid grid-cols-2 gap-px bg-slate-200 md:grid-cols-[1.25fr_repeat(5,minmax(0,1fr))]">
        <div className="col-span-2 bg-blue-50/70 px-5 py-5 md:col-span-1 md:px-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-blue-700">Tickets created</p>
          <p className="mt-2 text-4xl font-semibold tracking-tight text-slate-950">
            {(metrics.summary.tickets_created_filtered ?? metrics.summary.tickets_created).toLocaleString()}
          </p>
          <p className="mt-2 text-xs text-slate-500">
            {metrics.summary.tickets_created_filtered != null
              ? `CS filtered · ${(metrics.summary.tickets_created_unfiltered ?? metrics.summary.tickets_created).toLocaleString()} all (unfiltered)`
              : "Volume in selected window"}
          </p>
        </div>
        {items.map((item) => (
          <div key={item.label} className="bg-white px-5 py-5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{item.label}</p>
            <p className={`mt-3 text-xl font-semibold tracking-tight ${item.tone}`}>{item.value}</p>
            <p className="mt-2 text-[11px] text-slate-500">{item.detail}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

const TH = "px-3 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wider";
const TD = "px-3 py-2 text-xs text-slate-800";

function pct(rate: number | null | undefined) {
  return rate != null ? `${(rate * 100).toFixed(1)}%` : "n/a";
}
// Highlight poor achievement so a bad segment (e.g. Chat's 5-min target) reads
// at a glance, matching the breach-focused report the team wants.
function rateTone(rate: number | null | undefined) {
  if (rate == null) return "text-slate-400";
  if (rate >= 0.9) return "text-emerald-700";
  if (rate >= 0.75) return "text-amber-700";
  return "text-rose-700";
}

function fmtDate(d: string) {
  return new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
// Collector windows store an exclusive end (Thu → next Thu); the team reads
// ranges as inclusive Thu–Wed, so displayed ends are the day before.
function fmtDateEndIncl(d: string) {
  const dt = new Date(`${d}T00:00:00`);
  dt.setDate(dt.getDate() - 1);
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

export default function CsMetricsPage() {
  const [today] = useState(() => isoDate(new Date()));
  const [kind, setKind] = useState("7d");
  const [weekStart, setWeekStart] = useState<string | null>(null);
  const [customStart, setCustomStart] = useState(() => isoDate(new Date(Date.now() - 6 * 86400000)));
  const [customEnd, setCustomEnd] = useState(() => isoDate(new Date()));
  const [customResult, setCustomResult] = useState<ExplorerResult | null>(null);
  const [customLoading, setCustomLoading] = useState(false);
  const customStartRef = useRef<HTMLInputElement>(null);
  const customEndRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<{
    key: string; metrics: Metrics | null; windows: WindowInfo[];
  } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reports, setReports] = useState<ReportFile[]>([]);
  const [reportsOpen, setReportsOpen] = useState(false);

  const reportGroups = useMemo<ReportGroup[]>(() => {
    const groups = new Map<string, ReportGroup>();
    for (const file of reports) {
      const isWorkbook = file.name === "CS Metrics Report.xlsx";
      const stem = file.name.replace(/\.(xlsx|pdf|md)$/i, "");
      const key = isWorkbook ? "cumulative-workbook" : stem.toLowerCase();
      const weekStart = stem.match(/^cs-metrics-week-(\d{4}-\d{2}-\d{2})$/i)?.[1];
      const label = isWorkbook
        ? "Cumulative workbook"
        : weekStart ? `Week of ${fmtDate(weekStart)}` : stem;
      const existing = groups.get(key);
      if (existing) {
        existing.files.push(file);
        if (file.modified > existing.modified) existing.modified = file.modified;
      } else {
        groups.set(key, { key, label, modified: file.modified, files: [file] });
      }
    }
    const extOrder = (name: string) => ({ pdf: 0, xlsx: 1, md: 2 }[name.split(".").pop()?.toLowerCase() ?? ""] ?? 3);
    return [...groups.values()]
      .sort((a, b) => b.modified.localeCompare(a.modified))
      .slice(0, 3)
      .map((group) => ({ ...group, files: [...group.files].sort((a, b) => extOrder(a.name) - extOrder(b.name)) }));
  }, [reports]);

  const requestKey = `${kind}|${weekStart ?? ""}`;
  const openDatePicker = (ref: React.RefObject<HTMLInputElement | null>) => {
    const input = ref.current as (HTMLInputElement & { showPicker?: () => void }) | null;
    input?.focus();
    try { input?.showPicker?.(); } catch { /* some browsers require direct input activation */ }
  };
  useEffect(() => {
    if (kind === "custom") return;
    let cancelled = false;
    const params = new URLSearchParams({ kind });
    if (kind === "week" && weekStart) params.set("start", weekStart);
    fetch(`/api/cs-metrics?${params}`)
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "Metrics request failed");
        return data;
      })
      .then((data) => {
        if (cancelled) return;
        setLoadError(null);
        setResult({ key: requestKey, metrics: data.metrics, windows: data.windows ?? [] });
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError("Could not load this snapshot. Try again shortly.");
          setResult({ key: requestKey, metrics: null, windows: [] });
        }
      });
    return () => { cancelled = true; };
  }, [kind, weekStart, requestKey]);

  useEffect(() => {
    if (kind !== "custom") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async (jobId: string) => {
      try {
        const response = await fetch(`/api/cs-explorer?job=${encodeURIComponent(jobId)}`);
        const data = await response.json();
        if (data.status === "done") {
          if (!cancelled) {
            setLoadError(null);
            setCustomResult(data as ExplorerResult);
            setCustomLoading(false);
          }
          return;
        }
        if (data.status === "error") throw new Error(data.error || "Custom range failed");
        if (!cancelled) timer = setTimeout(() => { void poll(jobId); }, 5000);
      } catch {
        if (!cancelled) {
          setLoadError("Could not run this custom range. Try again shortly.");
          setCustomResult(null);
          setCustomLoading(false);
        }
      }
    };
    const start = async () => {
      try {
        const params = new URLSearchParams({ start: customStart, end: customEnd });
        const response = await fetch(`/api/cs-explorer?${params}`);
        const data = await response.json();
        if (!response.ok && response.status !== 202) throw new Error(data.error || "Custom range failed");
        if (data.status !== "running" || !data.jobId) throw new Error("Custom range did not start");
        await poll(data.jobId);
      } catch {
        if (!cancelled) {
          setLoadError("Could not start this custom range. Try again shortly.");
          setCustomResult(null);
          setCustomLoading(false);
        }
      }
    };
    void start();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [kind, customStart, customEnd]);

  const loading = kind === "custom" ? customLoading : result?.key !== requestKey;
  const metrics = kind === "custom" || loading ? null : result?.metrics ?? null;
  const windows = useMemo(() => result?.windows ?? [], [result]);

  const loadReports = useCallback(() => {
    fetch("/api/cs-reports")
      .then((r) => r.json())
      .then((data) => setReports(data.files ?? []))
      .catch(() => {});
  }, []);
  useEffect(() => { loadReports(); }, [loadReports]);

  const weekOptions = useMemo(
    () => windows.filter((w) => w.window_kind === "week"),
    [windows],
  );

  // Ordered [name, Segment] list for the business-hours SLA tables. Falls back
  // to an empty list for legacy snapshots that predate the segment rework.
  const segmentList = useMemo<[string, Segment][]>(() => {
    const segs = metrics?.segments;
    if (!segs) return [];
    const ordered = [
      ...CHANNEL_ORDER.filter((c) => segs[c]),
      ...Object.keys(segs).filter((c) => !CHANNEL_ORDER.includes(c)),
    ];
    return ordered.map((name) => [name, segs[name]]);
  }, [metrics]);

  const heat = metrics?.heatmap ?? {};
  const heatMax = Math.max(1, ...Object.values(heat));
  const heatHours = Object.keys(heat).length
    ? Array.from(new Set(Object.keys(heat).map((k) => Number(k.split("-")[1])))).sort((a, b) => a - b)
    : [];

  return (
    <div className="min-h-screen bg-[#f5f7fb]">
      <div className="mx-auto max-w-screen-xl space-y-5 px-4 py-5 sm:px-6 sm:py-7">
        <header className="flex flex-col gap-5 rounded-2xl border border-slate-200 bg-white px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-950">CS performance</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <Segmented
              value={kind}
              onChange={(k) => {
                setKind(k);
                setWeekStart(null);
                setLoadError(null);
                if (k === "custom") {
                  setCustomLoading(true);
                  requestAnimationFrame(() => openDatePicker(customStartRef));
                }
              }}
              options={KINDS}
            />
            {kind === "week" && weekOptions.length > 0 && (
              <select
                className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs text-slate-700 bg-white"
                value={weekStart ?? weekOptions[0].window_start}
                onChange={(e) => setWeekStart(e.target.value)}
              >
                {weekOptions.map((w) => (
                  <option key={w.window_start} value={w.window_start}>
                    {fmtDate(w.window_start)} – {fmtDateEndIncl(w.window_end)}
                  </option>
                ))}
              </select>
            )}
            {kind === "custom" && (
              <div className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 p-1">
                <input
                  ref={customStartRef}
                  type="date"
                  value={customStart}
                  max={customEnd}
                  onChange={(e) => { setCustomLoading(true); setCustomStart(e.target.value); }}
                  aria-label="Custom range start"
                  onClick={() => openDatePicker(customStartRef)}
                  className="h-7 rounded-md px-2 text-xs text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                />
                <span className="text-xs text-slate-400">to</span>
                <input
                  ref={customEndRef}
                  type="date"
                  value={customEnd}
                  min={customStart}
                  max={today}
                  onChange={(e) => { setCustomLoading(true); setCustomEnd(e.target.value); }}
                  aria-label="Custom range end"
                  onClick={() => openDatePicker(customEndRef)}
                  className="h-7 rounded-md px-2 text-xs text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                />
              </div>
            )}
          </div>
        </header>

        {loading && (
          <div className="grid gap-3 md:grid-cols-3" aria-label="Loading metrics">
            {["w-full", "w-4/5", "w-3/5"].map((width) => (
              <div key={width} className="h-24 animate-pulse rounded-xl border border-slate-200 bg-white p-5">
                <div className={`h-3 ${width} rounded bg-slate-200`} />
                <div className="mt-4 h-6 w-1/2 rounded bg-slate-100" />
              </div>
            ))}
          </div>
        )}
        {kind === "custom" && customLoading && (
          <p className="text-xs font-medium text-slate-500">Loading selected range…</p>
        )}
        {!loading && loadError && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-900">
            <p className="font-semibold">Metrics unavailable</p>
            <p className="mt-1 text-red-800">{loadError}</p>
          </div>
        )}
        {!loading && !loadError && !metrics && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            <p className="font-semibold">No snapshot for this window yet.</p>
            <p className="mt-1 text-amber-800">Daily snapshots refresh at 10:15 UTC; weekly reports refresh Thursdays at 12:30 UTC.</p>
          </div>
        )}

        {kind === "custom" && !customLoading && customResult && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard accent="blue" label="Tickets Created"
              value={customResult.metrics.ticketsCreated.toLocaleString()} />
            <StatCard label="Messages Sent"
              value={customResult.metrics.messagesSent.toLocaleString()} />
            <StatCard accent="amber" label="Median First Response"
              value={customResult.metrics.frtDisplay || "n/a"}
              sub="Gorgias 24/7 median" />
          </div>
        )}

        {metrics && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] text-slate-400">Generated {new Date(metrics.generated_at).toLocaleString()}</p>
            </div>
            <MetricRail metrics={metrics} />

            {metrics.sla && (
              <Card title="Daily SLA">
                <div className="overflow-x-auto">
                  <table className="min-w-full">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className={`${TH} text-left`}>Date</th>
                        <th className={`${TH} text-right`}>Evaluated</th>
                        <th className={`${TH} text-right`}>Achieved</th>
                        <th className={`${TH} text-right`}>Breached</th>
                        <th className={`${TH} text-right`}>Pending</th>
                        <th className={`${TH} text-right`}>Achievement Rate</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {Object.entries(metrics.sla.daily).map(([date, row]) => (
                        <tr key={date} className="hover:bg-slate-50/60">
                          <td className={`${TD} font-medium`}>{fmtDate(date)}</td>
                          <td className={`${TD} text-right tabular-nums`}>{row.evaluated.toLocaleString()}</td>
                          <td className={`${TD} text-right tabular-nums text-emerald-700`}>{row.achieved.toLocaleString()}</td>
                          <td className={`${TD} text-right tabular-nums text-red-700`}>{row.breached.toLocaleString()}</td>
                          <td className={`${TD} text-right tabular-nums`}>{row.pending.toLocaleString()}</td>
                          <td className={`${TD} text-right tabular-nums`}>{row.evaluated ? `${((row.achieved / row.evaluated) * 100).toFixed(1)}%` : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            {/* SLA & First Response — business-hours FRT from warehouse timestamps (Jess's report) */}
            {metrics.sla_frt?.table && (
              <Card title="SLA & First Response (business hours, 8am–4pm ET)">
                <p className="mb-4 text-xs text-slate-500">
                  Business hours: Mon&ndash;Fri, 8am&ndash;4pm ET. Unanswered tickets count as
                  breached; breached FRT averages answered-but-late tickets only. Targets: 8h
                  (Email / Help&nbsp;Center), 5m (Chat).
                </p>
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <table className="min-w-full">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className={`${TH} text-left`}>Channel</th>
                        <th className={`${TH} text-left`}>Customer Type</th>
                        <th className={`${TH} text-right`}>Breached</th>
                        <th className={`${TH} text-right`}>FRT Breached</th>
                        <th className={`${TH} text-right`}>Achieved</th>
                        <th className={`${TH} text-right`}>FRT Achieved</th>
                        <th className={`${TH} text-right`}>Tickets</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(() => {
                        const CHAN_LABEL: Record<string, string> = { email: "Email", "help-center": "Help Center", chat: "Chat", sms: "SMS" };
                        const order = ["email", "help-center", "chat", "sms"];
                        const table = metrics.sla_frt!.table;
                        const chans = [...order.filter((c) => table[c]), ...Object.keys(table).filter((c) => !order.includes(c))];
                        const out: ReactElement[] = [];
                        for (const chan of chans) {
                          let first = true;
                          for (const ct of CTYPE_ORDER) {
                            const cell = table[chan]?.[ct];
                            if (!cell) continue;
                            out.push(
                              <tr key={`${chan}-${ct}`} className={`hover:bg-slate-50/60 ${first ? "border-t-2 border-slate-200" : ""}`}>
                                <td className={`${TD} font-semibold text-slate-900`}>{first ? (CHAN_LABEL[chan] ?? chan) : ""}</td>
                                <td className={`${TD} text-slate-600`}>{ct}</td>
                                <td className={`${TD} text-right tabular-nums ${cell.breached ? "text-rose-700 font-semibold" : ""}`}>{cell.breached.toLocaleString()}</td>
                                <td className={`${TD} text-right tabular-nums text-slate-600`}>{cell.frt_breached_display || "—"}</td>
                                <td className={`${TD} text-right tabular-nums`}>{cell.achieved.toLocaleString()}</td>
                                <td className={`${TD} text-right tabular-nums text-slate-600`}>{cell.frt_achieved_display || "—"}</td>
                                <td className={`${TD} text-right tabular-nums text-slate-400`}>{cell.tickets.toLocaleString()}</td>
                              </tr>,
                            );
                            first = false;
                          }
                        }
                        return out;
                      })()}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            {/* fallback: legacy per-segment SLA (only for snapshots without sla_frt) */}
            {!metrics.sla_frt?.table && segmentList.length > 0 && (
              <Card title="First response — SLA (business hours, 8am–4pm ET)">
                <p className="mb-4 text-xs text-slate-500">
                  Achieved vs breached against each policy&rsquo;s target — the business-hours
                  first-response signal.
                </p>
                <div className="space-y-6">
                  {segmentList.map(([name, seg]) => {
                    const t = seg.totals;
                    return (
                      <div key={name}>
                        <div className="mb-1 flex flex-wrap items-baseline gap-x-2">
                          <h4 className="text-sm font-semibold text-slate-900">{name}</h4>
                          {seg.subset_of && (
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                              subset of {seg.subset_of} — do not add
                            </span>
                          )}
                        </div>
                        {seg.channel_note && (
                          <p className="mb-2 text-[11px] text-slate-400">{seg.channel_note}</p>
                        )}
                        <div className="overflow-x-auto rounded-lg border border-slate-200">
                          <table className="min-w-full">
                            <thead className="bg-slate-50 border-b border-slate-200">
                              <tr>
                                <th className={`${TH} text-left`}>Customer Type</th>
                                <th className={`${TH} text-right`}>Evaluated</th>
                                <th className={`${TH} text-right`}>Achieved</th>
                                <th className={`${TH} text-right`}>Breached</th>
                                <th className={`${TH} text-right`}>Achievement %</th>
                                <th className={`${TH} text-right`}>Tickets</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {CTYPE_ORDER.filter((c) => seg.by_customer_type[c]).map((ctype) => {
                                const cell = seg.by_customer_type[ctype];
                                return (
                                  <tr key={ctype} className="hover:bg-slate-50/60">
                                    <td className={`${TD} text-slate-600`}>{ctype}</td>
                                    <td className={`${TD} text-right tabular-nums`}>{cell.evaluated.toLocaleString()}</td>
                                    <td className={`${TD} text-right tabular-nums`}>{cell.achieved.toLocaleString()}</td>
                                    <td className={`${TD} text-right tabular-nums`}>{cell.breached.toLocaleString()}</td>
                                    <td className={`${TD} text-right tabular-nums font-semibold ${rateTone(cell.achievement_rate)}`}>{pct(cell.achievement_rate)}</td>
                                    <td className={`${TD} text-right tabular-nums text-slate-500`}>{cell.tickets_created.toLocaleString()}</td>
                                  </tr>
                                );
                              })}
                              <tr className="border-t-2 border-slate-200 bg-slate-50/50 font-semibold">
                                <td className={`${TD} text-slate-900`}>Total</td>
                                <td className={`${TD} text-right tabular-nums`}>{t.evaluated.toLocaleString()}</td>
                                <td className={`${TD} text-right tabular-nums`}>{t.achieved.toLocaleString()}</td>
                                <td className={`${TD} text-right tabular-nums`}>{t.breached.toLocaleString()}</td>
                                <td className={`${TD} text-right tabular-nums ${rateTone(t.achievement_rate)}`}>{pct(t.achievement_rate)}</td>
                                <td className={`${TD} text-right tabular-nums text-slate-500`}>{t.tickets_created.toLocaleString()}</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}

            {/* team */}
            <Card title="Team">
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className={`${TH} text-left`}>TM Name</th>
                      <th className={`${TH} text-right`}>TPH</th>
                      <th className={`${TH} text-right`}>Messages sent</th>
                      <th className={`${TH} text-right`} title="Distinct tickets this agent sent at least one message on">Unique tickets handled</th>
                      <th className={`${TH} text-right`}>CSAT</th>
                      <th className={`${TH} text-right`}>Days Worked</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {Object.entries(metrics.agents).map(([email, a]) => (
                      <tr key={email} className="hover:bg-slate-50/60">
                        <td className={`${TD} font-semibold text-slate-900`} title={email}>{a.name}</td>
                        <td className={`${TD} text-right tabular-nums`}>{a.tph ?? "—"}</td>
                        <td className={`${TD} text-right tabular-nums`}>{a.messages_sent.toLocaleString()}</td>
                        <td className={`${TD} text-right tabular-nums`}>{a.tickets_touched.toLocaleString()}</td>
                        <td className={`${TD} text-right tabular-nums`}>{a.csat != null ? `${a.csat.toFixed(2)}${a.csat_count != null ? ` (${a.csat_count})` : ""}` : "—"}</td>
                        <td className={`${TD} text-right tabular-nums`}>
                          {a.days_worked}
                          {a.schedule_source === "default" && (
                            <span className="text-slate-400" title="No schedule entries — assumed Mon–Fri.">*</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            {/* top drivers */}
            <div className="grid md:grid-cols-3 gap-4">
              {DRIVER_ORDER.filter((t) => metrics.top_drivers[t]?.length).map((section) => (
                <Card key={section} title={section === "All customer types" ? "Contact Reasons" : `${section} — Contact Reasons`}>
                  <div className="divide-y divide-slate-100">
                    {metrics.top_drivers[section].slice(0, 6).map(([driver, count]) => (
                      <div key={driver} className="flex items-center justify-between py-1.5 text-xs">
                        <span className="text-slate-600 truncate pr-3" title={driver}>{driver.split("::").slice(-1)[0]}</span>
                        <span className="tabular-nums font-semibold text-slate-900">{count}</span>
                      </div>
                    ))}
                  </div>
                </Card>
              ))}
            </div>

            {/* heatmap */}
            {heatHours.length > 0 && (
              <Card title="Busiest Times">
                <div className="overflow-x-auto">
                  <table className="w-full table-fixed text-[11px]">
                    <thead>
                      <tr>
                        <th className="w-16 pr-3 py-1 text-left text-slate-500 font-medium">Hour</th>
                        {WEEKDAYS.map((d) => (
                          <th key={d} className="px-1 py-1 text-slate-500 font-medium">{d}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {heatHours.map((h) => (
                        <tr key={h}>
                          <td className="pr-3 py-0.5 text-slate-500 tabular-nums">{String(h).padStart(2, "0")}:00</td>
                          {WEEKDAYS.map((_, d) => {
                            const v = heat[`${d}-${h}`] ?? 0;
                            const depth = v / heatMax;
                            const bg = depth === 0 ? "transparent" : `rgba(37, 99, 235, ${0.08 + depth * 0.72})`;
                            return (
                              <td key={d} className="px-0.5 py-0.5">
                                <div
                                  className="h-7 w-full rounded flex items-center justify-center tabular-nums"
                                  style={{ backgroundColor: bg, color: depth > 0.55 ? "white" : "#334155" }}
                                  title={`${WEEKDAYS[d]} ${String(h).padStart(2, "0")}:00 — ${v} tickets`}
                                >
                                  {v || ""}
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </>
        )}

        <ScheduleEditor seedAgents={metrics ? Object.entries(metrics.agents).map(([email, a]) => ({ email, name: a.name })) : []} />

        <GenerateReport onGenerated={loadReports} />

        <Card
          title="Generated Reports"
          sub="Weekly and on-demand downloads"
          headerRight={(
            <button
              onClick={() => setReportsOpen((open) => !open)}
              aria-expanded={reportsOpen}
              className="inline-flex min-h-8 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:border-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
            >
              {reportsOpen ? "Hide" : "Expand"}
              <svg className={`h-3.5 w-3.5 transition-transform ${reportsOpen ? "rotate-180" : ""}`} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m3.25 5.75 4.75 4.5 4.75-4.5" />
              </svg>
            </button>
          )}
        >
          {reportsOpen && (reportGroups.length === 0 ? (
            <p className="text-xs text-slate-400">No generated files yet.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {reportGroups.map((group) => (
                <div key={group.key} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-xs">
                  <div>
                    <p className="font-semibold text-slate-700">{group.label}</p>
                    <p className="mt-0.5 text-slate-400">{new Date(group.modified).toLocaleDateString()}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {group.files.filter((f) => /\.(pdf|xlsx)$/i.test(f.name)).map((f) => (
                      <a key={f.name} href={`/api/cs-reports?file=${encodeURIComponent(f.name)}`} className="rounded-md border border-slate-200 px-2 py-1 font-semibold text-blue-700 hover:border-blue-300 hover:bg-blue-50">
                        {f.name.split(".").pop()?.toUpperCase()}
                      </a>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}

// ── schedule editor ───────────────────────────────────────────────────────────
function ScheduleEditor({ seedAgents }: { seedAgents: { email: string; name: string }[] }) {
  const monday = useMemo(() => {
    const now = new Date();
    const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    const dow = (d.getUTCDay() + 6) % 7; // 0 = Monday
    d.setUTCDate(d.getUTCDate() - dow);
    return d;
  }, []);
  const [weekOffset, setWeekOffset] = useState(0);
  const [rows, setRows] = useState<Record<string, ScheduleRow>>({});
  const [manualAgents, setManualAgents] = useState<{ email: string; name: string }[]>([]);
  const [newAgent, setNewAgent] = useState("");
  const [saving, setSaving] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [expanded, setExpanded] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const agents = useMemo(() => {
    const seen = new Set<string>();
    const merged: { email: string; name: string }[] = [];
    for (const a of [
      ...seedAgents,
      ...Object.values(rows).map((r) => ({ email: r.agent_email, name: r.agent_name ?? r.agent_email })),
      ...manualAgents,
    ]) {
      if (!a.email || seen.has(a.email)) continue;
      seen.add(a.email);
      merged.push(a);
    }
    return merged;
  }, [seedAgents, rows, manualAgents]);

  const weekDates = useMemo(() => {
    const start = new Date(monday);
    start.setUTCDate(start.getUTCDate() + weekOffset * 7);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setUTCDate(d.getUTCDate() + i);
      return isoDate(d);
    });
  }, [monday, weekOffset]);

  const load = useCallback(() => {
    const start = weekDates[0];
    const endDate = new Date(`${weekDates[6]}T00:00:00Z`);
    endDate.setUTCDate(endDate.getUTCDate() + 1);
    fetch(`/api/cs-schedule?start=${start}&end=${isoDate(endDate)}`)
      .then((r) => r.json())
      .then((data) => {
        const map: Record<string, ScheduleRow> = {};
        for (const row of (data.rows ?? []) as ScheduleRow[]) {
          map[`${row.agent_email}|${row.date}`] = row;
        }
        setRows(map);
      })
      .catch(() => {});
  }, [weekDates]);

  useEffect(load, [load]);

  const cycle = (email: string, name: string, date: string) => {
    const key = `${email}|${date}`;
    const current = rows[key]?.status ?? defaultStatus(date);
    const next = STATUS_CYCLE[(STATUS_CYCLE.indexOf(current) + 1) % STATUS_CYCLE.length];
    setRows({ ...rows, [key]: { agent_email: email, agent_name: name, date, status: next, note: rows[key]?.note ?? null } });
    setSaving("idle");
  };

  const save = async () => {
    setSaving("saving");
    try {
      const res = await fetch("/api/cs-schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: Object.values(rows) }),
      });
      setSaving(res.ok ? "saved" : "error");
    } catch {
      setSaving("error");
    }
  };

  const addAgent = () => {
    const email = newAgent.trim().toLowerCase();
    if (!email || agents.some((a) => a.email === email)) return;
    setManualAgents([...manualAgents, { email, name: email.split("@")[0] }]);
    setNewAgent("");
  };

  const handleUpload = async (file: File) => {
    setUploading(true);
    setUploadMsg(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/cs-schedule/upload", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        setUploadMsg({ ok: false, text: data.error || "upload failed" });
      } else {
        const parts = [`${data.accepted} row${data.accepted === 1 ? "" : "s"} saved`];
        if (data.rejected) parts.push(`${data.rejected} skipped`);
        setUploadMsg({ ok: data.rejected === 0, text: parts.join(", ") });
        load(); // refresh the visible grid
      }
    } catch {
      setUploadMsg({ ok: false, text: "upload failed" });
    } finally {
      setUploading(false);
      if (uploadRef.current) uploadRef.current.value = "";
    }
  };

  const headerRight = (
    <div className="flex items-center gap-2 text-xs">
      <button
        onClick={() => setWeekOffset(weekOffset - 1)}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:border-slate-400 hover:bg-slate-50"
        aria-label="Previous week"
        title="Previous week"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m15 18-6-6 6-6" />
        </svg>
      </button>
      <span className="text-slate-600 tabular-nums">{fmtDate(weekDates[0])} – {fmtDate(weekDates[6])}</span>
      <button
        onClick={() => setWeekOffset(weekOffset + 1)}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:border-slate-400 hover:bg-slate-50"
        aria-label="Next week"
        title="Next week"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m9 18 6-6-6-6" />
        </svg>
      </button>
      <button onClick={save} disabled={saving === "saving"}
        className="ml-2 px-3 py-1.5 rounded-lg bg-blue-600 text-white font-medium disabled:opacity-50">
        {saving === "saving" ? "Saving…" : saving === "saved" ? "Saved ✓" : "Save"}
      </button>
      {saving === "error" && <span className="text-red-600">save failed</span>}
    </div>
  );

  const expandButton = (
    <button
      onClick={() => setExpanded((open) => !open)}
      aria-expanded={expanded}
      className="inline-flex min-h-8 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:border-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
    >
      {expanded ? "Hide" : "Expand"}
      <svg className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m3.25 5.75 4.75 4.5 4.75-4.5" />
      </svg>
    </button>
  );

  return (
    <Card
      title="Team Schedule"
      sub="Optional schedule inputs for TPH"
      headerRight={expanded ? (
        <div>{headerRight}</div>
      ) : expandButton}
    >
      {expanded && (
        <>
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className={`${TH} text-left`}>Agent</th>
                  {weekDates.map((d, i) => (
                    <th key={d} className={`${TH} text-center`}>
                      {WEEKDAYS[i]}<br /><span className="text-slate-400 normal-case font-normal">{fmtDate(d)}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {agents.map((agent) => (
                  <tr key={agent.email} className="hover:bg-slate-50/60">
                    <td className={`${TD} font-semibold text-slate-900`} title={agent.email}>{agent.name}</td>
                    {weekDates.map((date) => {
                      const status = rows[`${agent.email}|${date}`]?.status ?? defaultStatus(date);
                      return (
                        <td key={date} className="px-2 py-1.5 text-center">
                          <button
                            onClick={() => cycle(agent.email, agent.name, date)}
                            className={`w-9 h-7 rounded text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 ${STATUS_STYLE[status]}`}
                            title={`${status} — click to change`}
                          >
                            {STATUS_SHORT[status]}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-2 mt-3">
            <input
              value={newAgent}
              onChange={(e) => setNewAgent(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addAgent()}
              placeholder="Agent email"
              spellCheck={false}
              autoComplete="off"
              className="h-9 w-80 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 caret-blue-600 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
            <button
              onClick={addAgent}
              disabled={!newAgent.trim()}
              className="h-9 rounded-md border border-slate-300 px-3 text-xs font-medium text-slate-700 hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Add
            </button>
            <div className="ml-auto flex items-center gap-2">
              <input
                ref={uploadRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleUpload(file);
                }}
              />
              <button
                onClick={() => uploadRef.current?.click()}
                disabled={uploading}
                className="h-9 rounded-md border border-slate-300 px-3 text-xs font-medium text-slate-700 hover:border-slate-400 disabled:opacity-40"
                title="Bulk-upload a CSV: columns for agent email, date and status (e.g. present, leave, sick, half_day, off)"
              >
                {uploading ? "Uploading…" : "Upload CSV"}
              </button>
              {uploadMsg && (
                <span className={`text-xs ${uploadMsg.ok ? "text-emerald-600" : "text-rose-600"}`}>
                  {uploadMsg.text}
                </span>
              )}
            </div>
          </div>
          <p className="mt-2 text-[11px] text-slate-400">
            CSV columns: agent email, date (YYYY-MM-DD or M/D/YYYY), status
            (present / half_day / leave / sick / absent / off), optional name and note.
          </p>
        </>
      )}
    </Card>
  );
}

function defaultStatus(date: string) {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6 ? "off" : "present";
}

// ── on-demand report generator ────────────────────────────────────────────────
interface JobState { id: string; status: string; files?: string[]; error?: string }

function GenerateReport({ onGenerated }: { onGenerated: () => void }) {
  const [today] = useState(() => isoDate(new Date()));
  const [start, setStart] = useState(() => isoDate(new Date(Date.now() - 6 * 86400000)));
  const [end, setEnd] = useState(() => isoDate(new Date()));
  const [surveys, setSurveys] = useState(true);
  const [job, setJob] = useState<JobState | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const poll = useCallback((id: string, onDone: () => void) => {
    let tries = 0;
    const iv = setInterval(async () => {
      tries += 1;
      if (tries > 480) { // ~40 min ceiling
        clearInterval(iv);
        setJob({ id, status: "error", error: "timed out" });
        setBusy(false);
        return;
      }
      try {
        const res = await fetch(`/api/cs-generate?job=${id}`);
        const data = await res.json();
        if (data.status === "done") {
          clearInterval(iv);
          setJob({ id, status: "done", files: data.files });
          setBusy(false);
          onDone();
        } else if (data.status === "error") {
          clearInterval(iv);
          setJob({ id, status: "error", error: `exit code ${data.code ?? "?"}` });
          setBusy(false);
        }
      } catch { /* transient — keep polling */ }
    }, 5000);
  }, []);

  const generate = async () => {
    setBusy(true);
    setJob(null);
    // UI dates are inclusive; the collector's end is exclusive → add a day.
    const endEx = isoDate(new Date(Date.parse(`${end}T00:00:00Z`) + 86400000));
    try {
      const res = await fetch("/api/cs-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start, end: endEx, surveys }),
      });
      const data = await res.json();
      if (!res.ok) {
        setJob({ id: "", status: "error", error: data.error });
        setBusy(false);
        return;
      }
      setJob({ id: data.jobId, status: "running" });
      poll(data.jobId, onGenerated);
    } catch {
      setJob({ id: "", status: "error", error: "request failed" });
      setBusy(false);
    }
  };

  return (
    <Card
      title="Generate a Report"
      sub="Create a provider-backed Excel and PDF for any date range"
      headerRight={(
        <button
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          className="inline-flex min-h-8 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:border-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
        >
          {expanded ? "Hide" : "Expand"}
          <svg className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m3.25 5.75 4.75 4.5 4.75-4.5" />
          </svg>
        </button>
      )}
    >
      {expanded && <>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-slate-600">
          From
          <input type="date" value={start} max={end} onChange={(e) => setStart(e.target.value)}
            className="block mt-1 border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white" />
        </label>
        <label className="text-xs text-slate-600">
          To <span className="text-slate-400">(inclusive)</span>
          <input type="date" value={end} min={start} max={today} onChange={(e) => setEnd(e.target.value)}
            className="block mt-1 border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white" />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-slate-600 pb-2">
          <input type="checkbox" checked={surveys} onChange={(e) => setSurveys(e.target.checked)} />
          Include CSAT <span className="text-slate-400">(slower)</span>
        </label>
        <button onClick={generate} disabled={busy}
          className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:opacity-50">
          {busy ? "Generating…" : "Generate"}
        </button>
      </div>

      {job?.status === "running" && (
        <p className="text-xs text-slate-500 mt-3">
          Collecting from Gorgias and building the report… this can take a few minutes
          {surveys ? " (longer with CSAT on)" : ""}. You can keep using the page.
        </p>
      )}
      {job?.status === "done" && (
        <div className="mt-3 text-xs">
          <p className="text-emerald-700 font-medium mb-1.5">Report ready:</p>
          <div className="flex flex-wrap gap-4">
            {(job.files ?? []).map((f) => (
              <a key={f} href={`/api/cs-reports?file=${encodeURIComponent(f)}`} className="text-blue-700 hover:underline">{f}</a>
            ))}
          </div>
        </div>
      )}
      {job?.status === "error" && (
        <p className="text-xs text-red-600 mt-3">
          Generation failed{job.error ? `: ${job.error}` : ""}. Check the droplet logs (logs/ondemand-*.log).
        </p>
      )}
      </>}
    </Card>
  );
}
