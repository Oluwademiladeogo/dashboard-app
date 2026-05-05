import { NextResponse } from "next/server";
import pool from "../../../lib/db";

export async function GET() {
  try {
    const [rows] = await pool.query(`
      SELECT
        DATE_FORMAT(DATE_SUB(ticket_created_at, INTERVAL WEEKDAY(ticket_created_at) DAY), '%Y-%m-%d') AS week_start,
        COUNT(*) AS issues,
        SUM(status = 'closed') AS resolved,
        SUM(tags LIKE '%reship%' OR tags LIKE '%refund%') AS refunded_or_reship,
        COUNT(DISTINCT order_number) AS orders
      FROM gorgias_tickets
      WHERE ticket_created_at IS NOT NULL
      GROUP BY week_start
      ORDER BY week_start ASC
    `) as [Record<string, unknown>[], unknown];

    const payload = (rows as Record<string, unknown>[]).map((row) => {
      const weekStart = new Date(`${row.week_start}T00:00:00Z`);
      const m = weekStart.getUTCMonth() + 1;
      const d = weekStart.getUTCDate();
      const heavy = Number(row.refunded_or_reship) * 65;
      const medium = Math.max(Number(row.resolved) - Number(row.refunded_or_reship), 0) * 12;
      const estimatedCost = heavy + medium;
      const orders = Number(row.orders) || 1;
      return {
        weekLabel: `${m}/${d}`,
        weekStart: weekStart.toISOString(),
        costPerOrder: estimatedCost / orders,
      };
    });

    return NextResponse.json(payload);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
