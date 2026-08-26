import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import { spawn } from "child_process";
import crypto from "crypto";
import path from "path";

// Custom ranges use the same provider-owned Reporting Statistics collector as
// cron snapshots. They run as a detached Droplet job because a full Gorgias
// reporting query can exceed the reverse proxy's request timeout.
export const dynamic = "force-dynamic";

const CS_DIR = process.env.CS_METRICS_DIR ?? "/opt/cs-metrics";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 62;

function validDate(value: string | null): value is string {
  return !!value && DATE_RE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function parseDateRange(req: NextRequest) {
  const now = new Date();
  const fallbackStart = new Date(now.getTime() - 6 * 86400000).toISOString().slice(0, 10);
  const fallbackEnd = now.toISOString().slice(0, 10);
  const start = req.nextUrl.searchParams.get("start") ?? fallbackStart;
  const inclusiveEnd = req.nextUrl.searchParams.get("end") ?? fallbackEnd;
  if (!validDate(start) || !validDate(inclusiveEnd)) return { error: "start and end must be YYYY-MM-DD" };
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endMs = Date.parse(`${inclusiveEnd}T00:00:00Z`) + 86400000;
  if (!(startMs < endMs) || (endMs - startMs) / 86400000 > MAX_DAYS) {
    return { error: `Choose a valid range of up to ${MAX_DAYS} days.` };
  }
  return { start, end: new Date(endMs).toISOString().slice(0, 10) };
}

function responseFromMetrics(raw: Record<string, unknown>) {
  const summary = raw.summary && typeof raw.summary === "object"
    ? raw.summary as Record<string, unknown>
    : {};
  return {
    status: "done",
    metrics: {
      ticketsCreated: Number(summary.tickets_created ?? 0),
      messagesSent: Number(summary.messages_sent ?? 0),
      frtSeconds: summary.frt_seconds == null ? null : Number(summary.frt_seconds),
      frtDisplay: String(summary.frt_display ?? ""),
      frtCount: summary.frt_count == null ? null : Number(summary.frt_count),
    },
    providerMetrics: raw,
    options: { channels: ["Email", "Chat", "Help Center", "SMS"], customerTypes: ["Lead", "New (1 Order)", "Recurring"] },
    coverage: { source: "gorgias_reporting", from: raw.window_start, to: raw.window_end },
    definitions: {
      sms: "Gorgias filter: tag klaviyo-sms",
      frt: "Gorgias 24/7 median first-response-time",
    },
  };
}

async function status(job: string) {
  const statusPath = path.join(CS_DIR, "jobs", `${job}.json`);
  const state = JSON.parse(await fs.readFile(statusPath, "utf8")) as Record<string, unknown>;
  if (state.status !== "done") return state;
  const metricsPathValue = typeof state.metrics === "string"
    ? state.metrics
    : path.join(CS_DIR, "jobs", `${job}.metrics.json`);
  const metricsPath = path.isAbsolute(metricsPathValue)
    ? metricsPathValue
    : path.join(CS_DIR, metricsPathValue);
  const metrics = JSON.parse(await fs.readFile(metricsPath, "utf8")) as Record<string, unknown>;
  return responseFromMetrics(metrics);
}

export async function GET(req: NextRequest) {
  const job = req.nextUrl.searchParams.get("job");
  if (job) {
    if (!/^[0-9a-f-]{1,80}$/.test(job)) return NextResponse.json({ error: "invalid job" }, { status: 400 });
    try {
      const value = await status(job);
      return NextResponse.json(value, { status: value.status === "done" ? 200 : 202 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return NextResponse.json({ status: "running", jobId: job }, { status: 202 });
      console.error("cs explorer job error:", error);
      return NextResponse.json({ error: "Failed to read Reporting Statistics job." }, { status: 503 });
    }
  }

  const range = parseDateRange(req);
  if ("error" in range) return NextResponse.json({ error: range.error }, { status: 400 });
  const jobId = `${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  const child = spawn("bash", [path.join(CS_DIR, "run_ondemand.sh"), jobId, range.start, range.end, "0"], {
    cwd: CS_DIR,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  return NextResponse.json({ status: "running", jobId, start: range.start, end: range.end }, { status: 202 });
}
