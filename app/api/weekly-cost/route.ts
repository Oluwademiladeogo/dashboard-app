import { NextResponse } from "next/server";
import pool from "../../../lib/db";
import { getTableColumns } from "../../../lib/db-columns";
import { parseResolution } from "../../../lib/resolution";

function toWeekKey(dateStr: string): string {
  const dt = new Date(dateStr);
  const day = dt.getUTCDay();
  const daysToMon = day === 0 ? 6 : day - 1;
  const mon = new Date(dt);
  mon.setUTCDate(mon.getUTCDate() - daysToMon);
  mon.setUTCHours(0, 0, 0, 0);
  return mon.toISOString().slice(0, 10);
}

export async function GET() {
  try {
    const columns = await getTableColumns("gorgias_tickets");
    const has = (name: string) => columns.has(name);
    const selectResolutionApplied = has("resolution_applied")
      ? "resolution_applied"
      : "NULL AS resolution_applied";
    const selectResolutionCost = has("resolution_cost")
      ? "resolution_cost"
      : "NULL AS resolution_cost";
    const [rows] = await pool.query(`
      SELECT ticket_created_at, tags, ${selectResolutionApplied}, ${selectResolutionCost}
      FROM gorgias_tickets
      WHERE ticket_created_at IS NOT NULL
    `) as [Record<string, unknown>[], unknown];

    const weekCosts = new Map<string, number>();
    for (const row of rows) {
      const ws = toWeekKey(String(row.ticket_created_at));
      const dbCost = Number(row.resolution_cost ?? 0);
      const parsed = parseResolution(row.resolution_applied as string | null, row.tags as string | null);
      const cost = dbCost > 0 ? dbCost : parsed.cost;
      weekCosts.set(ws, (weekCosts.get(ws) ?? 0) + cost);
    }

    const [uniqueOrders] = await pool.query(`
      SELECT shopify_order_id, MIN(order_created_at) AS order_created_at
      FROM gorgias_tickets
      WHERE shopify_order_id IS NOT NULL AND order_created_at IS NOT NULL
      GROUP BY shopify_order_id
    `) as [Record<string, unknown>[], unknown];

    const weekOrderCounts = new Map<string, number>();
    for (const row of uniqueOrders) {
      const ws = toWeekKey(String(row.order_created_at));
      weekOrderCounts.set(ws, (weekOrderCounts.get(ws) ?? 0) + 1);
    }

    const allWeeks = new Set([...weekCosts.keys(), ...weekOrderCounts.keys()]);
    const weeks = Array.from(allWeeks).sort();
    const payload = weeks.map((ws) => {
      const weekStart = new Date(`${ws}T00:00:00Z`);
      const m = weekStart.getUTCMonth() + 1;
      const d = weekStart.getUTCDate();
      const totalCost = weekCosts.get(ws) ?? 0;
      const orderCount = weekOrderCounts.get(ws) ?? 1;
      return {
        weekLabel: `${m}/${d}`,
        weekStart: weekStart.toISOString(),
        costPerOrder: totalCost / orderCount,
      };
    });

    return NextResponse.json(payload);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
