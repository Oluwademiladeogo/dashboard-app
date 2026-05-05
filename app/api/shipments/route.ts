import { NextResponse } from "next/server";
import pool from "../../../lib/db";

export async function GET() {
  try {
    const [rows] = await pool.query(`
      SELECT
        DATE_FORMAT(DATE_SUB(ticket_created_at, INTERVAL WEEKDAY(ticket_created_at) DAY), '%Y-%m-%d') AS week_start,
        COUNT(DISTINCT order_number) AS orders
      FROM gorgias_tickets
      WHERE ticket_created_at IS NOT NULL
      GROUP BY week_start
      ORDER BY week_start ASC
    `) as [Record<string, unknown>[], unknown];

    const payload = (rows as Record<string, unknown>[]).map((row) => {
      const weekStart = new Date(`${row.week_start}T00:00:00Z`);
      const weekEnd = new Date(weekStart);
      weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
      const total = Number(row.orders) || 0;
      return {
        weekStart: weekStart.toISOString(),
        weekEnd: weekEnd.toISOString(),
        gripca: 0,
        rmfg: total,
        cog: 0,
        total,
      };
    });

    return NextResponse.json(payload);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
