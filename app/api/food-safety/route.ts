import { NextResponse } from "next/server";
import pool from "../../../lib/db";

export async function GET() {
  try {
    const [rows] = await pool.query(`
      SELECT ticket_id, ticket_created_at, customer_name, customer_email,
             order_number, tags, status, subject, ticket_closed_at,
             order_total_price
      FROM gorgias_tickets
      WHERE tags LIKE '%spoil%' OR tags LIKE '%food%' OR tags LIKE '%quality%'
         OR tags LIKE '%expired%' OR tags LIKE '%mold%'
      ORDER BY ticket_created_at DESC
      LIMIT 200
    `);

    const tickets = (rows as Record<string, unknown>[]).map((r) => ({
      idNumber: r.ticket_id,
      shopifyOrderNumber: r.order_number ?? String(r.ticket_id),
      dateOfComplaint: r.ticket_created_at,
      customerName: r.customer_name ?? r.customer_email,
      skuInQuestion: null,
      packagingType: null,
      fulfillmentCenter: null,
      carrierTrackingNumber: null,
      perceivedConcern: r.tags,
      gorgiasLink: `https://appyhour.gorgias.com/app/ticket/${r.ticket_id}`,
      ceoComments: null,
      direction: null,
      correctiveAction: r.subject,
      dateResolved: r.ticket_closed_at,
      resolutionCost: Number(r.order_total_price) || 0,
      isResolved: r.status === "closed",
    }));

    return NextResponse.json(tickets);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
