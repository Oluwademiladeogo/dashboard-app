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
  { id: "7d", label: "Last 7 Days" },
  { id: "14d", label: "Last 14 Days" },
  { id: "week", label: "Weekly (Thu–Wed)" },
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
  off: "bg-slate-100 text-slate-500",
};
const STATUS_SHORT: Record<string, string> = {
  present: "P", half_day: "½", leave: "L", sick: "S", absent: "A", off: "—",
};

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 border-t-2 border-t-blue-500 bg-white p-4">
      <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">{label}</p>
      <p className="text-2xl font-semibold text-slate-900">{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
    </div>
  );
}

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

  useEffect(() => {
    fetch("/api/cs-reports")
      .then((r) => r.json())
      .then((data) => setReports(data.files ?? []))
      .catch(() => {});
  }, []);

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
    const rows: { channel: string; ctype: string; cell: Cell }[] = [];
    for (const chan of channels) {
      const ctypes = [
        ...CTYPE_ORDER.filter((t) => table[chan][t]),
        ...Object.keys(table[chan]).filter((t) => !CTYPE_ORDER.includes(t)),
      ];
      ctypes.forEach((ctype, i) =>
        rows.push({ channel: i === 0 ? chan : "", ctype, cell: table[chan][ctype] }),
      );
    }
    return rows;
  }, [metrics]);

  const heat = metrics?.heatmap ?? {};
  const heatMax = Math.max(1, ...Object.values(heat));
  const heatHours = Object.keys(heat).length
    ? Array.from(new Set(Object.keys(heat).map((k) => Number(k.split("-")[1])))).sort((a, b) => a - b)
    : [];

  return (
    <div className="px-6 py-6 max-w-7xl mx-auto space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">CS Metrics</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Pulled directly from the Gorgias API by the droplet collector
            {metrics && <> — window {fmtDate(metrics.window_start.slice(0, 10))} → {fmtDate(metrics.window_end.slice(0, 10))} ({metrics.timezone}), generated {new Date(metrics.generated_at).toLocaleString()}</>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {KINDS.map((k) => (
            <button
              key={k.id}
              onClick={() => { setKind(k.id); setWeekStart(null); }}
              className={`px-3 py-1.5 rounded-md text-sm font-medium border ${
                kind === k.id
                  ? "bg-slate-900 text-white border-slate-900"
                  : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"
              }`}
            >
              {k.label}
            </button>
          ))}
          {kind === "week" && weekOptions.length > 0 && (
            <select
              className="border border-slate-200 rounded-md px-2 py-1.5 text-sm text-slate-700"
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
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <StatCard label="Tickets Created" value={metrics.summary.tickets_created.toLocaleString()} />
            <StatCard label="Tickets Closed" value={metrics.summary.tickets_closed.toLocaleString()} />
            <StatCard label="Messages Sent" value={metrics.summary.messages_sent.toLocaleString()} />
            <StatCard label="First Response" value={metrics.summary.frt_display || "n/a"} sub="avg, created in window" />
            <StatCard label="Resolution Time" value={metrics.summary.resolution_display || "n/a"} sub="avg, closed in window" />
            <StatCard
              label="Average CSAT"
              value={metrics.summary.csat_avg != null ? metrics.summary.csat_avg.toFixed(2) : "n/a"}
              sub={`${metrics.summary.csat_count} responses`}
            />
          </div>

          <section>
            <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wider mb-3">
              Channel × Customer Type
            </h2>
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                  <tr>
                    <th className="px-4 py-2 text-left">Channel</th>
                    <th className="px-4 py-2 text-left">Customer Type</th>
                    <th className="px-4 py-2 text-right">Tickets Created</th>
                    <th className="px-4 py-2 text-right">Messages Sent</th>
                    <th className="px-4 py-2 text-right">First Response Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {channelRows.map((row, i) => (
                    <tr key={i} className={row.channel ? "border-t border-slate-200" : ""}>
                      <td className="px-4 py-2 font-medium text-slate-900">{row.channel}</td>
                      <td className="px-4 py-2 text-slate-600">{row.ctype}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{row.cell.tickets_created.toLocaleString()}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{row.cell.messages_sent.toLocaleString()}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{row.cell.frt_display || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wider mb-3">Team</h2>
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                  <tr>
                    <th className="px-4 py-2 text-left">TM Name</th>
                    <th className="px-4 py-2 text-right">TPH</th>
                    <th className="px-4 py-2 text-right">Total Tickets</th>
                    <th className="px-4 py-2 text-right">Tickets Touched</th>
                    <th className="px-4 py-2 text-right">CSAT</th>
                    <th className="px-4 py-2 text-right">Days Worked</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {Object.entries(metrics.agents).map(([email, a]) => (
                    <tr key={email}>
                      <td className="px-4 py-2 font-medium text-slate-900" title={email}>{a.name}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{a.tph ?? "—"}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{a.messages_sent.toLocaleString()}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{a.tickets_touched.toLocaleString()}</td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {a.csat != null ? `${a.csat.toFixed(2)} (${a.csat_count})` : "—"}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {a.days_worked}
                        {a.schedule_source === "default" && (
                          <span className="text-slate-400" title="No schedule entries — assumed Mon–Fri. Set the roster below.">*</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-slate-400 mt-2">
              Total Tickets = messages sent by the agent in the window. TPH = Total Tickets ÷ (days worked × 7.5h).
              * = default Mon–Fri schedule; edit the roster below for accuracy.
            </p>
          </section>

          <section className="grid md:grid-cols-3 gap-6">
            {CTYPE_ORDER.filter((t) => metrics.top_drivers[t]?.length).map((section) => (
              <div key={section}>
                <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wider mb-3">
                  {section} Top Drivers
                </h2>
                <div className="rounded-lg border border-slate-200 bg-white divide-y divide-slate-100">
                  {metrics.top_drivers[section].slice(0, 6).map(([driver, count]) => (
                    <div key={driver} className="flex items-center justify-between px-4 py-2 text-sm">
                      <span className="text-slate-600 truncate pr-3" title={driver}>
                        {driver.split("::").slice(-1)[0]}
                      </span>
                      <span className="tabular-nums font-medium text-slate-900">{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </section>

          {heatHours.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wider mb-3">
                Busiest Times (tickets created)
              </h2>
              <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white p-4">
                <table className="text-xs">
                  <thead>
                    <tr>
                      <th className="pr-3 py-1 text-left text-slate-500 font-medium">Hour</th>
                      {WEEKDAYS.map((d) => (
                        <th key={d} className="px-1 py-1 text-slate-500 font-medium w-16">{d}</th>
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
                                className="h-6 w-16 rounded flex items-center justify-center tabular-nums"
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
            </section>
          )}
        </>
      )}

      <ScheduleEditor seedAgents={metrics ? Object.entries(metrics.agents).map(([email, a]) => ({ email, name: a.name })) : []} />

      <section>
        <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wider mb-3">Generated Reports</h2>
        {reports.length === 0 ? (
          <p className="text-sm text-slate-400">No generated files yet.</p>
        ) : (
          <div className="rounded-lg border border-slate-200 bg-white divide-y divide-slate-100">
            {reports.map((f) => (
              <div key={f.name} className="flex items-center justify-between px-4 py-2 text-sm">
                <a href={`/api/cs-reports?file=${encodeURIComponent(f.name)}`} className="text-blue-700 hover:underline">
                  {f.name}
                </a>
                <span className="text-xs text-slate-400">
                  {(f.size / 1024).toFixed(0)} KB — {new Date(f.modified).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
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

  // agents = snapshot agents + anyone already in the saved schedule + manually added
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

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wider">
          Team Schedule <span className="normal-case font-normal text-slate-400">(feeds TPH — click a day to cycle)</span>
        </h2>
        <div className="flex items-center gap-2 text-sm">
          <button onClick={() => setWeekOffset(weekOffset - 1)} className="px-2 py-1 border border-slate-200 rounded hover:border-slate-400">←</button>
          <span className="text-slate-600 tabular-nums">{fmtDate(weekDates[0])} – {fmtDate(weekDates[6])}</span>
          <button onClick={() => setWeekOffset(weekOffset + 1)} className="px-2 py-1 border border-slate-200 rounded hover:border-slate-400">→</button>
          <button
            onClick={save}
            disabled={saving === "saving"}
            className="ml-2 px-3 py-1.5 rounded-md bg-slate-900 text-white font-medium disabled:opacity-50"
          >
            {saving === "saving" ? "Saving…" : saving === "saved" ? "Saved ✓" : "Save"}
          </button>
          {saving === "error" && <span className="text-red-600 text-xs">save failed</span>}
        </div>
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
            <tr>
              <th className="px-4 py-2 text-left">Agent</th>
              {weekDates.map((d, i) => (
                <th key={d} className="px-2 py-2 text-center font-medium">
                  {WEEKDAYS[i]}<br /><span className="text-slate-400 normal-case">{fmtDate(d)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {agents.map((agent) => (
              <tr key={agent.email}>
                <td className="px-4 py-2 font-medium text-slate-900" title={agent.email}>{agent.name}</td>
                {weekDates.map((date) => {
                  const status = rows[`${agent.email}|${date}`]?.status ?? defaultStatus(date);
                  return (
                    <td key={date} className="px-2 py-1.5 text-center">
                      <button
                        onClick={() => cycle(agent.email, agent.name, date)}
                        className={`w-10 h-7 rounded text-xs font-semibold ${STATUS_STYLE[status]}`}
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
          className="border border-slate-200 rounded-md px-3 py-1.5 text-sm w-64"
        />
        <button onClick={addAgent} className="px-3 py-1.5 border border-slate-200 rounded-md text-sm hover:border-slate-400">
          Add
        </button>
        <span className="text-xs text-slate-400">
          P present · ½ half day · L leave · S sick · A absent · — off. Unsaved cells use Mon–Fri defaults.
        </span>
      </div>
    </section>
  );
}

function defaultStatus(date: string) {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6 ? "off" : "present";
}
