import { NextRequest, NextResponse } from "next/server";
import pool from "../../../lib/db";
import { getTableColumns } from "../../../lib/db-columns";
import { parseResolution } from "../../../lib/resolution";

const FOOD_SAFETY_CONCERNS = new Set([
  "Mold",
  "Spoiled",
  "Expired",
  "Broken Seal",
  "Contamination",
]);

const NON_FOOD_CONTEXT = new Set([
  "Arrived Warm",
  "Damaged",
  "Damaged in Transit",
  "Missing/Wrong Item",
  "Quality Issue",
  "Delayed",
  "Lost in Transit",
  "Misdelivered",
  "Not Received",
  "Wrong Address",
  "Cancellation",
  "Subscription Skip",
  "Subscription Change",
  "Billing Dispute",
  "Address Change",
  "Substitution Complaint",
  "Other",
]);

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
  sku_in_question: string | null;
  message_excerpt: string | null;
  classified_by: string | null;
  tag_audit: string | null;
  resolution_applied: string | null;
  resolution_components: unknown;
  resolution_cost: number | string | null;
  resolution_applied_at: Date | string | null;
  resolution_source: string | null;
  root_cause: string | null;
  needs_review: number | boolean | null;
};

function parseJson<T>(v: unknown, fallback: T): T {
  if (v == null) return fallback;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return v as T;
}

function itemCategory(name: string): string {
  const s = name.toLowerCase();
  if (/(salami|prosciutto|chorizo|sopressata|bresaola|lonza|capocollo|serrano|meat)/.test(s)) {
    return "Meat";
  }
  if (/(cracker|flatbread|almond|olive|fig|honey|jam|cherry|pecan|pretzel|preserve)/.test(s)) {
    return "Accompaniment";
  }
  if (/(brie|cheddar|gouda|ricotta|comte|gruy[eè]re|feta|cheese|toma|blossom|fleece)/.test(s)) {
    return "Cheese";
  }
  return "Multiple Item";
}

function inferCategories(
  rawCategories: string[],
  skuItems: string[],
  excerpt: string | null,
): string[] {
  const mapped = rawCategories.map((c) => {
    if (c === "Cheese" || c === "Meat" || c === "Accompaniment") return c;
    if (c === "Crackers" || c === "Treats") return "Accompaniment";
    if (c === "Cheese & Jam Pairing" || c === "Bundle Add-on" || c === "Box (overall)") {
      return "Multiple Item";
    }
    return c;
  });

  const unique = Array.from(new Set(mapped.filter(Boolean)));
  if (!unique.length || unique.every((c) => c === "Multiple Item")) {
    const haystack = (excerpt ?? "").toLowerCase();
    const inferred = skuItems
      .filter((item) => !haystack || haystack.includes(item.toLowerCase()))
      .map(itemCategory);
    const fallback = inferred.length ? inferred : skuItems.map(itemCategory);
    return Array.from(new Set(fallback.filter(Boolean)));
  }

  return unique;
}

function deriveRootCause(concerns: string[], tags: string | null): string {
  const tagText = (tags ?? "").toLowerCase();
  if (concerns.some((c) => ["Delayed", "Arrived Warm"].includes(c)) || tagText.includes("arrived warm")) {
    return "Carrier Delay/Temperature";
  }
  if (concerns.some((c) => ["Misdelivered", "Not Received", "Wrong Address", "Lost in Transit"].includes(c))) {
    return "Delivery Error";
  }
  if (concerns.some((c) => ["Damaged", "Damaged in Transit"].includes(c))) {
    return "Transit Damage";
  }
  if (concerns.some((c) => FOOD_SAFETY_CONCERNS.has(c))) {
    return "Product/Packaging";
  }
  return "Needs Review";
}

function deriveNeedsReview(
  allConcerns: string[],
  foodSafetyConcerns: string[],
  skuCategories: string[],
  row: Row,
): boolean {
  if (!foodSafetyConcerns.length) return true;
  if (!row.message_excerpt) return true;
  if (row.classified_by && row.classified_by !== "haiku") return true;
  if (row.tag_audit) return true;
  if (allConcerns.some((c) => NON_FOOD_CONTEXT.has(c))) return true;
  if (skuCategories.length !== 1 || skuCategories.includes("Multiple Item")) return true;
  if (row.needs_review != null) return Boolean(row.needs_review);
  return false;
}

export async function GET(request: NextRequest) {
  try {
    const columns = await getTableColumns("gorgias_tickets");
    const has = (name: string) => columns.has(name);
    const p = request.nextUrl.searchParams.get("includeArrivedWarm");
    const includeArrived = p === "1" || p === "true";

    const selectFields = [
      "t.ticket_id",
      "t.ticket_created_at",
      "t.ticket_closed_at",
      "t.customer_name",
      "t.customer_email",
      "t.order_number",
      "t.tags",
      "t.status",
      "t.subject",
      "t.assignee_email",
      "t.shopify_order_id",
      has("sku_in_question") ? "t.sku_in_question" : "NULL AS sku_in_question",
      has("concerns") ? "t.concerns" : "NULL AS concerns",
      has("sku_categories") ? "t.sku_categories" : "NULL AS sku_categories",
      has("message_excerpt") ? "t.message_excerpt" : "NULL AS message_excerpt",
      has("classified_by") ? "t.classified_by" : "NULL AS classified_by",
      has("tag_audit") ? "t.tag_audit" : "NULL AS tag_audit",
      has("resolution_applied") ? "t.resolution_applied" : "NULL AS resolution_applied",
      has("resolution_components") ? "t.resolution_components" : "NULL AS resolution_components",
      has("resolution_cost") ? "t.resolution_cost" : "NULL AS resolution_cost",
      has("resolution_applied_at") ? "t.resolution_applied_at" : "NULL AS resolution_applied_at",
      has("resolution_source") ? "t.resolution_source" : "NULL AS resolution_source",
      has("root_cause") ? "t.root_cause" : "NULL AS root_cause",
      has("needs_review") ? "t.needs_review" : "NULL AS needs_review",
      "GROUP_CONCAT(DISTINCT COALESCE(s.product_name, s.sku) ORDER BY COALESCE(s.product_name, s.sku) SEPARATOR ' || ') AS skus",
    ];

    const isFoodSafetyClause = has("is_food_safety") ? "t.is_food_safety = 1" : "1 = 1";
    let baseWhereClause = `WHERE ${isFoodSafetyClause}`;
    if (!includeArrived) {
      const arrivedWarmChecks = [
        "t.tags LIKE '%Arrived Warm%'",
        "t.tags LIKE '%Arrived warm%'",
      ];
      if (has("concerns")) {
        arrivedWarmChecks.push("t.concerns LIKE '%Arrived Warm%'", "t.concerns LIKE '%Arrived warm%'");
      }
      baseWhereClause += ` AND NOT (${arrivedWarmChecks.join(" OR ")})`;
    }

    const [rows] = await pool.query(`
      SELECT ${selectFields.join(",\n             ")}
      FROM gorgias_tickets t
      LEFT JOIN shopify_order_skus s
        ON s.shopify_order_id = t.shopify_order_id
        AND s.sku NOT LIKE 'AHB-%' AND s.sku NOT LIKE 'PK-%'
        AND s.product_name NOT LIKE '%Tasting Guide%'
        AND s.product_name NOT LIKE '%Custom Box%'
        AND s.product_name NOT LIKE '%Monthly Curation%'
        AND s.product_name NOT LIKE '%AppyHour Box%'
      ${baseWhereClause}
      GROUP BY t.ticket_id
      ORDER BY t.ticket_created_at DESC
      LIMIT 1000
    `);

    const tickets = (rows as Row[]).map((r) => {
      const allConcerns = parseJson<string[]>(r.concerns, []);
      const concerns = allConcerns.filter((c) => FOOD_SAFETY_CONCERNS.has(c));
      const skuItems = r.skus
        ? r.skus.split(" || ").map((s) => s.trim().replace(/\s*\*+\s*$/, "")).filter(Boolean)
        : [];
      const rawCategories = parseJson<string[]>(r.sku_categories, []);
      const skuCategories = inferCategories(rawCategories, skuItems, r.message_excerpt);

      const parsed = parseResolution(r.resolution_applied, r.tags);
      const dbResolutionCost = Number(r.resolution_cost ?? 0);
      const resolutionCost = dbResolutionCost > 0 ? dbResolutionCost : parsed.cost;
      const resolutionComponents = parseJson<string[]>(r.resolution_components, parsed.components);
      const resolutionSource = (r.resolution_source as "db" | "tags" | "derived" | null) ?? parsed.source;
      const rootCause = r.root_cause ?? deriveRootCause(allConcerns, r.tags);
      const needsReview = deriveNeedsReview(allConcerns, concerns, skuCategories, r);

      return {
        idNumber: Number(r.ticket_id),
        shopifyOrderNumber: r.order_number ?? String(r.ticket_id),
        dateOfComplaint: r.ticket_created_at,
        customerName: r.customer_name ?? r.customer_email,
        skuInQuestion: skuItems.length ? skuItems.join(", ") : (r.sku_in_question ?? (skuCategories.join(", ") || null)),
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
        correctiveAction: parsed.label,
        resolutionApplied: r.resolution_applied ?? parsed.label,
        resolutionSource,
        resolutionComponents,
        dateResolved: r.resolution_applied_at ?? r.ticket_closed_at,
        resolutionCost: parsed.hasAppliedResolution ? resolutionCost : 0,
        hasAppliedResolution: parsed.hasAppliedResolution,
        isResolved: r.status === "closed",
        rootCause,
        needsReview,
        tags: r.tags,
        messageExcerpt: r.message_excerpt,
      };
    });

    return NextResponse.json(tickets);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
