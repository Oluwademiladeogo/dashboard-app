import { NextResponse } from "next/server";
import pool from "../../../lib/db";

export async function GET() {
  try {
    const [[summary]] = await pool.query(`
      SELECT
        COUNT(*) AS total_tickets,
        SUM(status != 'closed') AS open_tickets,
        SUM(status = 'closed') AS closed_tickets,
        MAX(ticket_created_at) AS latest_created_at
      FROM gorgias_tickets
    `) as [Record<string, unknown>[], unknown];

    const [[topCat]] = await pool.query(`
      SELECT tags AS category, COUNT(*) AS cnt
      FROM gorgias_tickets
      WHERE tags IS NOT NULL AND tags != ''
      GROUP BY tags
      ORDER BY cnt DESC
      LIMIT 1
    `) as [Record<string, unknown>[], unknown];

    return NextResponse.json({
      totalTickets: Number(summary.total_tickets) || 0,
      openTickets: Number(summary.open_tickets) || 0,
      closedTickets: Number(summary.closed_tickets) || 0,
      topCategory: (topCat?.category as string) ?? "Uncategorized",
      latestCreatedAt: summary.latest_created_at,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
