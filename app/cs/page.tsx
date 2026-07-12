"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

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
  csat_count: number;
  days_worked: number;
  schedule_source: string;
  tph: number | null;
}
interface Metrics {
  window_start: string;
  window_end: string;
  timezone: string;
  generated_at: string;
  summary: {
    tickets_created: number;
    tickets_closed: number;
    messages_sent: number;
    frt_display: string;
    resolution_display: string;
    csat_avg: number | null;
    csat_count: number;
  };
  channel_table: Record<string, Record<string, Cell>>;
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

const KINDS = [
  { key: "7d", label: "Last 7 Days" },
  { key: "14d", label: "Last 14 Days" },
  { key: "week", label: "Weekly (Thu–Wed)" },
];
const CHANNEL_ORDER = ["Email", "Chat", "Help Center", "SMS"];
const CTYPE_ORDER = ["Lead", "New (1 Order)", "Recurring"];
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

function StatCard({ label, value, sub, accent = "neutral" }: {
  label: string; value: string; sub?: string; accent?: Accent;
}) {
  return (
    <div className={`rounded-lg border border-slate-200 border-t-2 p-4 ${ACCENT_STYLES[accent]}`}>
      <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">{label}</p>
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
    <div className={`rounded-lg border border-slate-200 bg-white p-5 ${className}`}>
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
          className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
            value === o.key ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const TH = "px-3 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wider";
const TD = "px-3 py-2 text-xs text-slate-800";

function fmtDate(d: string) {
  return new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

export default function CsMetricsPage() {
  const [kind, setKind] = useState("7d");
  const [weekStart, setWeekStart] = useState<string | null>(null);
  const [result, setResult] = useState<{
    key: string; metrics: Metrics | null; windows: WindowInfo[];
  } | null>(null);
  const [reports, setReports] = useState<ReportFile[]>([]);

  const requestKey = `${kind}|${weekStart ?? ""}`;
  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ kind });
    if (kind === "week" && weekStart) params.set("start", weekStart);
    fetch(`/api/cs-metrics?${params}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setResult({ key: requestKey, metrics: data.metrics, windows: data.windows ?? [] });
      })
      .catch(() => !cancelled && setResult({ key: requestKey, metrics: null, windows: [] }));
    return () => { cancelled = true; };
  }, [kind, weekStart, requestKey]);

  const loading = result?.key !== requestKey;
  const metrics = loading ? null : result?.metrics ?? null;
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

  const channelRows = useMemo(() => {
    if (!metrics) return [];
    const table = metrics.channel_table;
    const channels = [
      ...CHANNEL_ORDER.filter((c) => table[c]),
      ...Object.keys(table).filter((c) => !CHANNEL_ORDER.includes(c)),
    ];
    const rows: { channel: string; ctype: string; cell: Cell; first: boolean }[] = [];
    for (const chan of channels) {
      const ctypes = [
        ...CTYPE_ORDER.filter((t) => table[chan][t]),
        ...Object.keys(table[chan]).filter((t) => !CTYPE_ORDER.includes(t)),
      ];
      ctypes.forEach((ctype, i) =>
        rows.push({ channel: i === 0 ? chan : "", ctype, cell: table[chan][ctype], first: i === 0 }),
      );
    }
    return rows;
  }, [metrics]);

  const heat = metrics?.heatmap ?? {};
  const heatMax = Math.max(1, ...Object.values(heat));
  const heatHours = Object.keys(heat).length
    ? Array.from(new Set(Object.keys(heat).map((k) => Number(k.split("-")[1])))).sort((a, b) => a - b)
    : [];

  const win = metrics
    ? `${fmtDate(metrics.window_start.slice(0, 10))} → ${fmtDate(metrics.window_end.slice(0, 10))} (${metrics.timezone})`
    : "";

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="px-6 py-6 max-w-screen-xl mx-auto space-y-6">
        {/* header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-900">CS Metrics</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Pulled directly from the Gorgias API by the droplet collector
              {metrics && <> — window {win}, generated {new Date(metrics.generated_at).toLocaleString()}</>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Segmented value={kind} onChange={(k) => { setKind(k); setWeekStart(null); }} options={KINDS} />
            {kind === "week" && weekOptions.length > 0 && (
              <select
                className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs text-slate-700 bg-white"
                value={weekStart ?? weekOptions[0].window_start}
                onChange={(e) => setWeekStart(e.target.value)}
              >
                {weekOptions.map((w) => (
                  <option key={w.window_start} value={w.window_start}>
                    {fmtDate(w.window_start)} – {fmtDate(w.window_end)}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        {loading && <p className="text-sm text-slate-400">Loading…</p>}
        {!loading && !metrics && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            No snapshot for this window yet. The collector cron writes 7/14-day snapshots daily and
            weekly snapshots every Thursday; run <code>run_report.py</code> on the droplet to backfill.
          </div>
        )}

        {metrics && (
          <>
            {/* KPI row */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <StatCard accent="blue" label="Tickets Created" value={metrics.summary.tickets_created.toLocaleString()} />
              <StatCard label="Tickets Closed" value={metrics.summary.tickets_closed.toLocaleString()} />
              <StatCard label="Messages Sent" value={metrics.summary.messages_sent.toLocaleString()} />
              <StatCard accent="amber" label="First Response" value={metrics.summary.frt_display || "n/a"} sub="avg, created in window" />
              <StatCard label="Resolution Time" value={metrics.summary.resolution_display || "n/a"} sub="avg, closed in window" />
              <StatCard accent="green" label="Average CSAT"
                value={metrics.summary.csat_avg != null ? metrics.summary.csat_avg.toFixed(2) : "n/a"}
                sub={`${metrics.summary.csat_count} responses`} />
            </div>

            {/* channel × customer type */}
            <Card title="Channel × Customer Type">
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className={`${TH} text-left`}>Channel</th>
                      <th className={`${TH} text-left`}>Customer Type</th>
                      <th className={`${TH} text-right`}>Tickets Created</th>
                      <th className={`${TH} text-right`}>Messages Sent</th>
                      <th className={`${TH} text-right`}>First Response Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {channelRows.map((row, i) => (
                      <tr key={i} className={`hover:bg-slate-50/60 ${row.first && i > 0 ? "border-t-2 border-slate-200" : ""}`}>
                        <td className={`${TD} font-semibold text-slate-900`}>{row.channel}</td>
                        <td className={`${TD} text-slate-600`}>{row.ctype}</td>
                        <td className={`${TD} text-right tabular-nums`}>{row.cell.tickets_created.toLocaleString()}</td>
                        <td className={`${TD} text-right tabular-nums`}>{row.cell.messages_sent.toLocaleString()}</td>
                        <td className={`${TD} text-right tabular-nums`}>{row.cell.frt_display || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            {/* team */}
            <Card title="Team" sub="Total Tickets = messages sent · TPH = Total Tickets ÷ (days worked × 7.5h) · * = default Mon–Fri (set the roster below)">
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className={`${TH} text-left`}>TM Name</th>
                      <th className={`${TH} text-right`}>TPH</th>
                      <th className={`${TH} text-right`}>Total Tickets</th>
                      <th className={`${TH} text-right`}>Tickets Touched</th>
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
                        <td className={`${TD} text-right tabular-nums`}>{a.csat != null ? `${a.csat.toFixed(2)} (${a.csat_count})` : "—"}</td>
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
              {CTYPE_ORDER.filter((t) => metrics.top_drivers[t]?.length).map((section) => (
                <Card key={section} title={`${section} — Top Drivers`}>
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
              <Card title="Busiest Times" sub="tickets created per weekday × hour">
                <div className="overflow-x-auto">
                  <table className="text-[11px]">
                    <thead>
                      <tr>
                        <th className="pr-3 py-1 text-left text-slate-500 font-medium">Hour</th>
                        {WEEKDAYS.map((d) => (
                          <th key={d} className="px-1 py-1 text-slate-500 font-medium w-14">{d}</th>
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
                                  className="h-6 w-14 rounded flex items-center justify-center tabular-nums"
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

        <Card title="Generated Reports" sub="weekly Excel + PDF from the droplet cron, plus anything you generate below">
          {reports.length === 0 ? (
            <p className="text-xs text-slate-400">No generated files yet.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {reports.map((f) => (
                <div key={f.name} className="flex items-center justify-between py-1.5 text-xs">
                  <a href={`/api/cs-reports?file=${encodeURIComponent(f.name)}`} className="text-blue-700 hover:underline">{f.name}</a>
                  <span className="text-slate-400">{(f.size / 1024).toFixed(0)} KB — {new Date(f.modified).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          )}
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

  const headerRight = (
    <div className="flex items-center gap-2 text-xs">
      <button onClick={() => setWeekOffset(weekOffset - 1)} className="px-2 py-1 border border-slate-300 rounded hover:border-slate-400">←</button>
      <span className="text-slate-600 tabular-nums">{fmtDate(weekDates[0])} – {fmtDate(weekDates[6])}</span>
      <button onClick={() => setWeekOffset(weekOffset + 1)} className="px-2 py-1 border border-slate-300 rounded hover:border-slate-400">→</button>
      <button onClick={save} disabled={saving === "saving"}
        className="ml-2 px-3 py-1.5 rounded-lg bg-blue-600 text-white font-medium disabled:opacity-50">
        {saving === "saving" ? "Saving…" : saving === "saved" ? "Saved ✓" : "Save"}
      </button>
      {saving === "error" && <span className="text-red-600">save failed</span>}
    </div>
  );

  return (
    <Card
      title="Team Schedule"
      sub="Feeds TPH — click a day to cycle. P present · ½ half day · L leave · S sick · A absent · — off"
      headerRight={headerRight}
    >
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
                        className={`w-9 h-7 rounded text-xs font-semibold ${STATUS_STYLE[status]}`}
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
          placeholder="add agent email…"
          className="border border-slate-300 rounded-lg px-3 py-1.5 text-xs w-64"
        />
        <button onClick={addAgent} className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs hover:border-slate-400">Add</button>
      </div>
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
    <Card title="Generate a Report" sub="Build the Excel + PDF for any date range, on demand (separate from the weekly cron)">
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
          className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium disabled:opacity-50">
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
    </Card>
  );
}
