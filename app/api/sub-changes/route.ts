import { NextRequest, NextResponse } from "next/server";
import pool from "../../../lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const [rows] = await pool.query(
      `SELECT 
         id,
         ticket_id,
         customer_email,
         customer_name,
         customer_id,
         subscription_id,
         charge_id,
         current_charge_date,
         subject,
         customer_text,
         action,
         target_date,
         skip_count,
         decision,
         reason,
         confidence,
         gorgias_ticket_url,
         recharge_customer_url,
         created_at,
         updated_at
       FROM subscription_change_preview
       ORDER BY created_at DESC
       LIMIT 250`
    );

    const items = rows as Record<string, unknown>[];

    const stats = {
      total: items.length,
      skips: items.filter((r) => r.action === "skip").length,
      delays: items.filter((r) => r.action === "delay").length,
      multiSkips: items.filter((r) => r.action === "multi_skip").length,
      uniqueCustomers: new Set(items.map((r) => r.customer_email)).size,
    };

    return NextResponse.json({
      success: true,
      stats,
      items,
    });
  } catch (err) {
    console.error("sub-changes api error:", err);
    return NextResponse.json({ error: "Failed to load sub changes" }, { status: 500 });
  }
}
