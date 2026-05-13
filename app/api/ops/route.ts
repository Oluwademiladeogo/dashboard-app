import { NextResponse } from "next/server";
import pool from "../../../lib/db";

// Map canonical concerns → ops issue type buckets (used by the Cost-of-Issues page).
function bucket(concerns: string[]): string {
  if (concerns.includes("Arrived Warm")) return "Arrived Warm";
  if (concerns.includes("Lost in Transit") || concerns.includes("Misdelivered")) return "Lost in Transit";
  if (concerns.includes("Delayed")) return "Delayed in Transit";
  if (concerns.includes("Not Received")) return "Lost in Transit";
  if (concerns.includes("Mold") || concerns.includes("Spoiled") || concerns.includes("Expired") ||
      concerns.includes("Damaged") || concerns.includes("Quality Issue") || concerns.includes("Contamination"))
    return "Product Quality";
  if (concerns.includes("Missing/Wrong Item")) return "Missing/Wrong Item";
  if (concerns.includes("Cancellation") || concerns.includes("Subscription Skip") ||
      concerns.includes("Subscription Change") || concerns.includes("Billing Dispute"))
    return "Cancellation/Billing";
  if (concerns.includes("Address Change") || concerns.includes("Wrong Address")) return "Address Change";
  if (concerns.includes("Spam/Bot")) return "Bot/System";
  return "Other";
}

// Resolution → cost. Tag-based since IRG records actions as macros.
function resolution(tags: string | null): string | null {
  if (!tags) return null;
  const t = tags.toLowerCase();
  if (t.includes("partial reship")) return "partial reship";
  if (t.includes("reship") && t.includes("arrived warm")) return "partial reship";
  if (t.includes("reship")) return "full reship";
  if (t.includes("extra cheese")) return "extra cheese";
  if (t.includes("extra meat")) return "extra meat";
  if (t.includes("extra accompaniment")) return "extra accompaniment";
  if (t.includes("cancel/refund") || t.includes("cancel sub") || t.includes("cancel order")) return "cancellation";
  if (t.includes("refund")) return "full refund";
  if (t.includes("information") || t.includes("general")) return "information given";
  return null;
}

function parseJson<T>(v: unknown, fallback: T): T {
  if (v == null) return fallback;
  if (typeof v === "string") { try { return JSON.parse(v) as T; } catch { return fallback; } }
  return v as T;
}

export async function GET() {
  try {
    const since = new Date(Date.now() - 84 * 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 19).replace("T", " ");
    const [rows] = await pool.query(
      `SELECT ticket_id, ticket_created_at, subject, status, customer_email,
              tags, assignee_email, order_number, shopify_order_id, concerns
       FROM gorgias_tickets
       WHERE ticket_created_at IS NOT NULL AND ticket_created_at >= ?
       ORDER BY ticket_created_at DESC`,
      [since],
    );

    const ops = (rows as Record<string, unknown>[]).map((r) => {
      const concerns = parseJson<string[]>(r.concerns, []);
      const issueType = bucket(concerns);
      return {
        date: r.ticket_created_at,
        contactReason: r.subject,
        orderNumber: r.order_number ?? String(r.ticket_id),
        gorgiasLink: `https://appyhour.gorgias.com/app/ticket/${r.ticket_id}`,
        carrier: null,
        destinationState: null,
        fulfillmentCenter: null,
        issueType,
        resolution: resolution(r.tags as string | null),
        comment: r.tags,
      };
    });

    return NextResponse.json(ops);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
