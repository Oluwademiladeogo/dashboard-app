import { NextResponse } from "next/server";
import pool from "../../../lib/db";

function inferIssueType(tags: string | null, subject: string | null): string {
  const text = `${tags ?? ""} ${subject ?? ""}`.toLowerCase();
  if (text.includes("arrived warm")) return "Arrived Warm";
  if (text.includes("not-shipped") || text.includes("not shipped")) return "Not Shipped";
  if (text.includes("reship") || text.includes("order issue")) return "Order Issue / Reship";
  if (text.includes("cancel")) return "Cancellation";
  if (text.includes("refund")) return "Refund";
  if (text.includes("edit-address") || text.includes("address")) return "Address Change";
  if (text.includes("spoil") || text.includes("mold") || text.includes("quality") || text.includes("product issue")) return "Product Quality";
  if (text.includes("account")) return "Account";
  if (text.includes("general")) return "General Inquiry";
  if (text.includes("top priority")) return "Escalation";
  return "Other";
}

function inferResolution(tags: string | null, subject: string | null): string | null {
  const text = `${tags ?? ""} ${subject ?? ""}`.toLowerCase();
  if (text.includes("partial reship")) return "partial reship";
  if (text.includes("reship")) return "full reship";
  if (text.includes("refund")) return "full refund";
  if (text.includes("extra cheese")) return "extra cheese";
  if (text.includes("extra meat")) return "extra meat";
  if (text.includes("extra accompaniment")) return "extra accompaniment";
  if (text.includes("information") || text.includes("general")) return "information given";
  return null;
}

export async function GET() {
  try {
    const [rows] = await pool.query(`
      SELECT ticket_id, ticket_created_at, subject, status, customer_email,
             tags, assignee_email, order_number, shopify_order_id
      FROM gorgias_tickets
      WHERE ticket_created_at IS NOT NULL
      ORDER BY ticket_created_at DESC
      LIMIT 1000
    `);

    const ops = (rows as Record<string, unknown>[]).map((r) => ({
      date: r.ticket_created_at,
      contactReason: r.subject,
      orderNumber: r.order_number ?? String(r.ticket_id),
      gorgiasLink: `https://appyhour.gorgias.com/app/ticket/${r.ticket_id}`,
      carrier: null,
      destinationState: null,
      fulfillmentCenter: null,
      issueType: inferIssueType(r.tags as string, r.subject as string),
      resolution: inferResolution(r.tags as string, r.subject as string),
      comment: r.tags,
    }));

    return NextResponse.json(ops);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
