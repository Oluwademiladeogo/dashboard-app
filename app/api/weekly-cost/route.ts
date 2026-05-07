import { NextResponse } from "next/server";
import pool from "../../../lib/db";

const COST: Record<string, number> = {
  reship: 65,
  refund: 65,
  "extra cheese": 5.5,
  "extra meat": 4,
  "extra accompaniment": 2.5,
};

function estimateCost(tags: string | null): number {
  if (!tags) return 0;
  const t = tags.toLowerCase();
  if (t.includes("reship")) return COST.reship;
  if (t.includes("refund")) return COST.refund;
  if (t.includes("extra cheese")) return COST["extra cheese"];
  if (t.includes("extra meat")) return COST["extra meat"];
  if (t.includes("extra accompaniment")) return COST["extra accompaniment"];
  return 0;
}

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
    // Get ticket costs grouped by week from DB
    const [rows] = await pool.query(`
      SELECT ticket_created_at, tags
      FROM gorgias_tickets
      WHERE ticket_created_at IS NOT NULL
    `) as [Record<string, unknown>[], unknown];

    const weekCosts = new Map<string, number>();
    for (const row of rows) {
      const ws = toWeekKey(String(row.ticket_created_at));
      weekCosts.set(ws, (weekCosts.get(ws) ?? 0) + estimateCost(row.tags as string | null));
    }

    // Count unique orders per week using MIN(order_created_at) per shopify_order_id
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

    // Build payload — include ALL weeks in range, zero-cost weeks included
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
