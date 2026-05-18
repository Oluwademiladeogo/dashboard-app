import { NextResponse } from "next/server";
import pool from "../../../lib/db";
import { getTableColumns } from "../../../lib/db-columns";
import { parseResolution } from "../../../lib/resolution";

// Map canonical concerns → ops issue type buckets (used by the Cost-of-Issues page).
function bucket(concerns: string[]): string {
  if (concerns.includes("Arrived Warm")) return "Arrived Warm";
  if (concerns.includes("Lost in Transit") || concerns.includes("Misdelivered")) return "Lost in Transit";
  if (concerns.includes("Delayed")) return "Delayed in Transit";
  if (concerns.includes("Not Received")) return "Lost in Transit";
  if (concerns.includes("Mold") || concerns.includes("Spoiled") || concerns.includes("Expired") ||
      concerns.includes("Damaged") || concerns.includes("Damaged in Transit") ||
      concerns.includes("Quality Issue") || concerns.includes("Contamination"))
    return "Product Quality";
  if (concerns.includes("Missing/Wrong Item")) return "Missing/Wrong Item";
  if (concerns.includes("Cancellation") || concerns.includes("Subscription Skip") ||
      concerns.includes("Subscription Change") || concerns.includes("Billing Dispute"))
    return "Cancellation/Billing";
  if (concerns.includes("Address Change") || concerns.includes("Wrong Address")) return "Address Change";
  if (concerns.includes("Spam/Bot")) return "Bot/System";
  return "Other";
}

function parseJson<T>(v: unknown, fallback: T): T {
  if (v == null) return fallback;
  if (typeof v === "string") { try { return JSON.parse(v) as T; } catch { return fallback; } }
  return v as T;
}

export async function GET() {
  try {
    const columns = await getTableColumns("gorgias_tickets");
    const has = (name: string) => columns.has(name);
    const since = new Date(Date.now() - 84 * 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 19).replace("T", " ");
    const selectResolutionApplied = has("resolution_applied")
      ? "resolution_applied"
      : "NULL AS resolution_applied";
    const selectConcerns = has("concerns")
      ? "concerns"
      : "NULL AS concerns";
    const [rows] = await pool.query(
      `SELECT ticket_id, ticket_created_at, subject, status, customer_email,
              tags, assignee_email, order_number, shopify_order_id, ${selectConcerns},
              ${selectResolutionApplied}
       FROM gorgias_tickets
       WHERE ticket_created_at IS NOT NULL AND ticket_created_at >= ?
       ORDER BY ticket_created_at DESC`,
      [since],
    );

    const ops = (rows as Record<string, unknown>[]).map((r) => {
      const concerns = parseJson<string[]>(r.concerns, []);
      const issueType = bucket(concerns);
      const parsed = parseResolution(r.resolution_applied as string | null, r.tags as string | null);
      return {
        date: r.ticket_created_at,
        contactReason: r.subject,
        orderNumber: r.order_number ?? String(r.ticket_id),
        gorgiasLink: `https://appyhour.gorgias.com/app/ticket/${r.ticket_id}`,
        carrier: null,
        destinationState: null,
        fulfillmentCenter: null,
        issueType,
        resolution: parsed.label,
        comment: r.tags,
      };
    });

    return NextResponse.json(ops);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
