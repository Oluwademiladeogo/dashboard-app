import { NextRequest, NextResponse } from "next/server";
import pool from "../../../lib/db";

// Snapshots are produced by Automations/cs-metrics-report (direct Gorgias API
// collector) on the droplet cron; the dashboard only reads them.

function parseJson<T>(v: unknown, fallback: T): T {
  if (v == null) return fallback;
  if (typeof v === "string") { try { return JSON.parse(v) as T; } catch { return fallback; } }
  return v as T;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const kind = searchParams.get("kind") ?? "7d";
  const start = searchParams.get("start");
  try {
    const [windows] = await pool.query(
      `SELECT window_kind, DATE_FORMAT(window_start, '%Y-%m-%d') AS window_start,
              DATE_FORMAT(window_end, '%Y-%m-%d') AS window_end, generated_at
       FROM cs_metrics_snapshots ORDER BY window_start DESC, window_kind`,
    );
    let query = `SELECT payload, generated_at FROM cs_metrics_snapshots
                 WHERE window_kind = ?`;
    const params: string[] = [kind];
    if (start) {
      query += " AND window_start = ?";
      params.push(start);
    }
    query += " ORDER BY window_start DESC, generated_at DESC LIMIT 1";
    const [rows] = await pool.query(query, params);
    const row = (rows as Record<string, unknown>[])[0];
    return NextResponse.json({
      metrics: row ? parseJson<Record<string, unknown> | null>(row.payload, null) : null,
      generatedAt: row?.generated_at ?? null,
      windows,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // table may not exist until the collector's first run
    if (message.includes("doesn't exist")) {
      return NextResponse.json({ metrics: null, generatedAt: null, windows: [] });
    }
    console.error("cs-metrics api error:", err);
    return NextResponse.json({ error: "failed to load metrics" }, { status: 500 });
  }
}
