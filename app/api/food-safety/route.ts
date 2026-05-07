import { NextResponse } from "next/server";
import pool from "../../../lib/db";

// Resolution cost lookup based on tags
function inferResolutionCost(tags: string | null): number {
  if (!tags) return 0;
  const t = tags.toLowerCase();
  if (t.includes("reship")) return 65;
  if (t.includes("refund")) return 65;
  if (t.includes("extra cheese")) return 5.5;
  if (t.includes("extra meat")) return 4;
  if (t.includes("extra accompaniment")) return 2.5;
  return 0;
}

// Infer concern from tags
function inferConcern(tags: string | null, subject: string | null): string | null {
  const text = `${tags ?? ""} ${subject ?? ""}`.toLowerCase();
  if (text.includes("spoiled") || text.includes("spoil")) return "Spoiled";
  if (text.includes("mold") || text.includes("mould")) return "Mold";
  if (text.includes("expired")) return "Expired";
  if (text.includes("quality") || text.includes("product issue")) return "Quality Issue";
  if (text.includes("food") || text.includes("contamina")) return "Food Safety";
  if (text.includes("arrived warm") || text.includes("warm")) return "Arrived Warm";
  if (text.includes("missing") || text.includes("wrong item")) return "Missing/Wrong Item";
  return tags ?? null;
}

export async function GET() {
  try {
    const [rows] = await pool.query(`
      SELECT t.ticket_id, t.ticket_created_at, t.ticket_closed_at, t.customer_name,
             t.customer_email, t.order_number, t.tags, t.status, t.subject,
             t.order_total_price, t.assignee_email, t.shopify_order_id,
             t.sku_in_question,
             GROUP_CONCAT(DISTINCT s.sku ORDER BY s.sku SEPARATOR ', ') AS skus
      FROM gorgias_tickets t
      LEFT JOIN shopify_order_skus s ON s.shopify_order_id = t.shopify_order_id
      GROUP BY t.ticket_id
      ORDER BY t.ticket_created_at DESC
      LIMIT 500
    `);

    const tickets = (rows as Record<string, unknown>[]).map((r) => {
      const tags = r.tags as string | null;
      const subject = r.subject as string | null;
      return {
        idNumber: r.ticket_id,
        shopifyOrderNumber: r.order_number ?? String(r.ticket_id),
        dateOfComplaint: r.ticket_created_at,
        customerName: r.customer_name ?? r.customer_email,
        skuInQuestion: (r.sku_in_question as string | null) ?? (r.skus as string | null) ?? null,
        packagingType: null,
        fulfillmentCenter: null,
        carrierTrackingNumber: null,
        perceivedConcern: inferConcern(tags, subject),
        gorgiasLink: `https://appyhour.gorgias.com/app/ticket/${r.ticket_id}`,
        ceoComments: null,
        direction: null,
        correctiveAction: r.assignee_email ?? null,
        dateResolved: r.ticket_closed_at,
        resolutionCost: inferResolutionCost(tags),
        isResolved: r.status === "closed",
      };
    });

    return NextResponse.json(tickets);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
