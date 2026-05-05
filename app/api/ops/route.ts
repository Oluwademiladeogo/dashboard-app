import { NextResponse } from "next/server";
import pool from "../../../lib/db";

function inferResolution(tags: string | null, subject: string | null): string | null {
  const text = `${tags ?? ""} ${subject ?? ""}`.toLowerCase();
  if (text.includes("partial reship")) return "partial reship";
  if (text.includes("full reship") || text.includes("reship")) return "full reship";
  if (text.includes("refund")) return "full refund";
  if (text.includes("extra cheese")) return "extra cheese";
  if (text.includes("extra meat")) return "extra meat";
  if (text.includes("extra accompaniment")) return "extra accompaniment";
  if (text.includes("information")) return "information given";
  return null;
}

export async function GET() {
  try {
    const [rows] = await pool.query(`
      SELECT ticket_id, ticket_created_at, subject, status, customer_email,
             tags, assignee_email, order_number, shopify_order_id
      FROM gorgias_tickets
      ORDER BY ticket_created_at DESC
      LIMIT 500
    `);

    const ops = (rows as Record<string, unknown>[]).map((r) => ({
      date: r.ticket_created_at,
      contactReason: r.subject,
      orderNumber: r.order_number ?? String(r.ticket_id),
      gorgiasLink: `https://appyhour.gorgias.com/app/ticket/${r.ticket_id}`,
      carrier: null,
      destinationState: null,
      fulfillmentCenter: null,
      issueType: "See Gorgias tag",
      resolution: inferResolution(r.tags as string, r.subject as string),
      comment: null,
    }));

    return NextResponse.json(ops);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
