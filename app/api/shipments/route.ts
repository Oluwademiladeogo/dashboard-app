import { NextResponse } from "next/server";
import pool from "../../../lib/db";

export async function GET() {
  try {
    // Last 12 weeks of orders, aggregated by ISO week (Monday) from local mirror.
    const since = new Date(Date.now() - 84 * 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 19).replace("T", " ");

    const [rows] = await pool.query(
      `SELECT DATE(DATE_SUB(created_at, INTERVAL ((DAYOFWEEK(created_at)+5) % 7) DAY)) AS week_mon,
              COUNT(*) AS total
       FROM shopify_orders
       WHERE created_at IS NOT NULL AND created_at >= ?
       GROUP BY week_mon
       ORDER BY week_mon`,
      [since],
    ) as [Array<{ week_mon: Date | string; total: number }>, unknown];

    const payload = rows.map((r) => {
      const ymd = typeof r.week_mon === "string" ? r.week_mon : r.week_mon.toISOString().slice(0, 10);
      const weekStart = new Date(`${ymd}T00:00:00Z`);
      const weekEnd = new Date(weekStart);
      weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
      return {
        weekStart: weekStart.toISOString(),
        weekEnd: weekEnd.toISOString(),
        gripca: 0,
        rmfg: r.total,
        cog: 0,
        total: r.total,
      };
    });

    return NextResponse.json(payload);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
