import { NextResponse } from "next/server";
import pool from "../../../lib/db";

// Cost mapping mirrors the Issue Resolution Guide. Indexed by canonical concern.
const COST_BY_CONCERN: Record<string, number> = {
  "Mold": 65,                    // Full reship
  "Spoiled": 65,                 // Full reship
  "Expired": 65,                 // Full reship — past best-before
  "Broken Seal": 30,             // Partial reship of compromised item
  "Contamination": 65,           // Full reship — escalate to Dan
};

// Only product-condition concerns belong on the food-safety page, per the
// "UPDATE_Food Safety" sheet in the Issue Resolution Guide workbook.
// Operational concerns (Arrived Warm, Missing/Wrong Item, Damaged in transit,
// Quality/taste complaints, Substitution complaints) live on the cost page,
// not here — they are tracked in the "UPDATE_Operational Issues" sheet.
const FOOD_SAFETY_CONCERNS = new Set([
  "Mold", "Spoiled", "Expired", "Broken Seal", "Contamination",
]);

function inferResolutionCost(concerns: string[]): number {
  // Take the worst-case (highest) cost among the present concerns; never sum
  // — one ticket = one resolution.
  let max = 0;
  for (const c of concerns) {
    const v = COST_BY_CONCERN[c] ?? 0;
    if (v > max) max = v;
  }
  return max;
}

type Row = {
  ticket_id: string | number;
  ticket_created_at: Date | string | null;
  ticket_closed_at: Date | string | null;
  customer_name: string | null;
  customer_email: string | null;
  order_number: string | null;
  tags: string | null;
  status: string | null;
  subject: string | null;
  assignee_email: string | null;
  shopify_order_id: string | null;
  concerns: unknown;
  sku_categories: unknown;
  skus: string | null;
  message_excerpt: string | null;
};

function parseJson<T>(v: unknown, fallback: T): T {
  if (v == null) return fallback;
  if (typeof v === "string") {
    try { return JSON.parse(v) as T; } catch { return fallback; }
  }
  return v as T;
}

export async function GET() {
  try {
    // Source of truth: is_food_safety + concerns columns populated by the
    // Haiku classifier (see _classifier.mjs / reporting-sync workflow).
    // No more LIKE-tag parsing in dashboard SQL.
    const [rows] = await pool.query(`
      SELECT t.ticket_id, t.ticket_created_at, t.ticket_closed_at, t.customer_name,
             t.customer_email, t.order_number, t.tags, t.status, t.subject,
             t.assignee_email, t.shopify_order_id,
             t.concerns, t.sku_categories, t.message_excerpt,
             GROUP_CONCAT(DISTINCT COALESCE(s.product_name, s.sku) ORDER BY COALESCE(s.product_name, s.sku) SEPARATOR ' || ') AS skus
      FROM gorgias_tickets t
      LEFT JOIN shopify_order_skus s
        ON s.shopify_order_id = t.shopify_order_id
        AND s.sku NOT LIKE 'AHB-%' AND s.sku NOT LIKE 'PK-%'
        AND s.product_name NOT LIKE '%Tasting Guide%'
        AND s.product_name NOT LIKE '%Custom Box%'
        AND s.product_name NOT LIKE '%Monthly Curation%'
        AND s.product_name NOT LIKE '%AppyHour Box%'
      WHERE t.is_food_safety = 1
      GROUP BY t.ticket_id
      ORDER BY t.ticket_created_at DESC
      LIMIT 1000
    `);

    const tickets = (rows as Row[]).map((r) => {
      const allConcerns = parseJson<string[]>(r.concerns, []);
      // Restrict to food-safety concerns only — Cancellation / Billing /
      // Subscription belong on the cost page, not in this donut.
      const concerns = allConcerns.filter((c) => FOOD_SAFETY_CONCERNS.has(c));

      // Collapse Haiku's SKU categories down to the 4 buckets used by the
      // food-safety sheet: Cheese / Meat / Accompaniment / Multiple Item.
      // Crackers and Treats are accompaniments; Pairings/Bundles/Box span
      // multiple categories.
      const SHEET_CATEGORY: Record<string, string> = {
        "Cheese": "Cheese",
        "Meat": "Meat",
        "Accompaniment": "Accompaniment",
        "Crackers": "Accompaniment",
        "Treats": "Accompaniment",
        "Cheese & Jam Pairing": "Multiple Item",
        "Bundle Add-on": "Multiple Item",
        "Box (overall)": "Multiple Item",
      };
      const rawCategories = parseJson<string[]>(r.sku_categories, []);
      const skuCategories = Array.from(new Set(
        rawCategories.map((c) => SHEET_CATEGORY[c] ?? c)
      ));
      const rawSkus = r.skus;
      const skuItems = rawSkus
        ? rawSkus.split(" || ").map((s) => s.trim().replace(/\s*\*+\s*$/, "")).filter(Boolean)
        : [];
      return {
        idNumber: r.ticket_id,
        shopifyOrderNumber: r.order_number ?? String(r.ticket_id),
        dateOfComplaint: r.ticket_created_at,
        customerName: r.customer_name ?? r.customer_email,
        skuInQuestion: skuCategories.length ? skuCategories.join(", ") : (skuItems.length ? skuItems.join(", ") : null),
        skuItems,
        skuCategories,
        packagingType: null,
        fulfillmentCenter: null,
        carrierTrackingNumber: null,
        perceivedConcern: concerns.length ? concerns.join(", ") : null,
        concerns,
        gorgiasLink: `https://appyhour.gorgias.com/app/ticket/${r.ticket_id}`,
        ceoComments: null,
        direction: null,
        correctiveAction: r.assignee_email ?? null,
        dateResolved: r.ticket_closed_at,
        resolutionCost: inferResolutionCost(concerns),
        isResolved: r.status === "closed",
      };
    });

    return NextResponse.json(tickets);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
