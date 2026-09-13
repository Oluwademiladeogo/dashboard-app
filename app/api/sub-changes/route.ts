import { NextRequest, NextResponse } from "next/server";
import pool from "../../../lib/db";

export const dynamic = "force-dynamic";

function getDelayDays(item: Record<string, unknown>): number | null {
  if (item.current_charge_date && item.target_date) {
    try {
      const d1 = new Date(String(item.current_charge_date).slice(0, 10));
      const d2 = new Date(String(item.target_date).slice(0, 10));
      const diff = Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
      if (!isNaN(diff) && diff > 0) return diff;
    } catch {
      // fallback
    }
  }
  const reason = String(item.reason || "").toLowerCase();
  const text = String(item.customer_text || "").toLowerCase();
  if (reason.includes("7 days") || reason.includes("1 week") || text === "1" || text.includes("1 week")) return 7;
  if (reason.includes("14 days") || reason.includes("2 weeks") || text === "2" || text.includes("2 weeks")) return 14;
  return null;
}

export async function GET(req: NextRequest) {
  try {
    const ticketId = req.nextUrl.searchParams.get("ticket_id");

    // If specific ticket messages requested for drawer transcript
    if (ticketId) {
      const [msgRows] = await pool.query(
        `SELECT 
           message_id,
           ticket_id,
           from_agent,
           channel,
           body_text,
           created_at,
           sender_email
         FROM gorgias_messages
         WHERE ticket_id = ?
         ORDER BY created_at ASC`,
        [ticketId]
      );
      return NextResponse.json({
        success: true,
        ticket_id: ticketId,
        messages: msgRows,
      });
    }

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

    const delays1w = items.filter((r) => {
      const d = getDelayDays(r);
      return d !== null && d >= 5 && d <= 9;
    }).length;

    const delays2w = items.filter((r) => {
      const d = getDelayDays(r);
      return d !== null && d >= 12 && d <= 16;
    }).length;

    const totalDelaysAutomated = items.filter(
      (r) => r.action === "delay" && r.decision === "APPLIED"
    ).length;

    const activeInquiries = items.filter(
      (r) => r.decision === "AWAITING_CHOICE"
    ).length;

    const stats = {
      total: items.length,
      totalDelaysAutomated,
      delays1w,
      delays2w,
      activeInquiries,
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
