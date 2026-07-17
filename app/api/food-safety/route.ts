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
  order_fulfilled_at: Date | string | null;
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
  gorgias_photo_urls?: unknown;
  reported_item_name?: string | null;
  gorgias_resolution_reference?: string | null;
  classifier_reasoning?: string | null;
};

type SkuRow = {
  shopify_order_id: string | number | null;
  order_number: string | number | null;
  sku: string | null;
  product_name: string | null;
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

function isSkuCode(v: string | null): boolean {
  return Boolean(v && /^[A-Z0-9]+(?:-[A-Z0-9]+)+(?:\s*,\s*[A-Z0-9]+(?:-[A-Z0-9]+)+)*$/.test(v.trim()));
}

function extractOrderNumber(text: string | null): string | null {
  if (!text) return null;
  const match = text.match(/(?:order\s*#?\s*|#)(\d{5,})/i) ?? text.match(/\border\s+(\d{5,})\b/i);
  return match?.[1] ?? null;
}

function key(v: string | number | null | undefined): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
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
      has("order_fulfilled_at") ? "t.order_fulfilled_at" : "NULL AS order_fulfilled_at",
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
      has("gorgias_photo_urls") ? "t.gorgias_photo_urls" : "NULL AS gorgias_photo_urls",
      has("reported_item_name") ? "t.reported_item_name" : "NULL AS reported_item_name",
      has("gorgias_resolution_reference") ? "t.gorgias_resolution_reference" : "NULL AS gorgias_resolution_reference",
      has("classifier_reasoning") ? "t.classifier_reasoning" : "NULL AS classifier_reasoning",
    ];

    const isFoodSafetyClause = has("is_food_safety") ? "t.is_food_safety = 1" : "1 = 1";
    const testCustomerFilter = `
      AND (t.customer_email IS NULL OR t.customer_email <> 'reply@notification.stamped.io')
      AND (t.customer_name IS NULL OR t.customer_name NOT REGEXP '^(Demilade Test|Test Customer|Stamped\\\\.io)')
      AND (t.customer_email IS NULL OR t.customer_email NOT LIKE 'bickerstethdemilade+%@gmail.com')
    `.trim();
    let baseWhereClause = `WHERE ${isFoodSafetyClause} ${testCustomerFilter}`;
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
      ${baseWhereClause}
      ORDER BY t.ticket_created_at DESC
      LIMIT 5000
    `);

    const ticketRows = rows as Row[];
    const extractedOrderNumbers = new Map<string | number, string | null>();
    const shopifyOrderIds = Array.from(new Set(ticketRows.map((r) => key(r.shopify_order_id)).filter(Boolean)));
    const orderNumbers = Array.from(new Set(ticketRows
      .filter((r) => !key(r.shopify_order_id))
      .map((r) => key(r.order_number) ?? extractOrderNumber(r.message_excerpt))
      .filter(Boolean)));

    ticketRows.forEach((r) => {
      extractedOrderNumbers.set(r.ticket_id, extractOrderNumber(r.message_excerpt));
    });

    const skuConditions: string[] = [];
    const skuParams: (string[] | number[])[] = [];
    if (shopifyOrderIds.length) {
      skuConditions.push("shopify_order_id IN (?)");
      skuParams.push(shopifyOrderIds as string[]);
    }
    if (orderNumbers.length) {
      skuConditions.push("order_number IN (?)");
      skuParams.push(orderNumbers as string[]);
    }

    const [skuRows] = skuConditions.length
      ? await pool.query(`
          SELECT shopify_order_id, order_number, sku, product_name
          FROM shopify_order_skus
          WHERE (${skuConditions.join(" OR ")})
        `, skuParams)
      : [[]];

    const skusByShopifyId = new Map<string, SkuRow[]>();
    const skusByOrderNumber = new Map<string, SkuRow[]>();
    (skuRows as SkuRow[]).forEach((sku) => {
      const shopifyId = key(sku.shopify_order_id);
      const orderNumber = key(sku.order_number);
      if (shopifyId) skusByShopifyId.set(shopifyId, [...(skusByShopifyId.get(shopifyId) ?? []), sku]);
      if (orderNumber) skusByOrderNumber.set(orderNumber, [...(skusByOrderNumber.get(orderNumber) ?? []), sku]);
    });

    const tickets = ticketRows.map((r) => {
      const allConcerns = parseJson<string[]>(r.concerns, []);
      const concerns = allConcerns.filter((c) => FOOD_SAFETY_CONCERNS.has(c));
      const fallbackSku = isSkuCode(r.sku_in_question) ? r.sku_in_question : null;
      const extractedOrderNumber = extractedOrderNumbers.get(r.ticket_id) ?? null;
      const shopifyId = key(r.shopify_order_id);
      const linkedSkus = shopifyId
        ? skusByShopifyId.get(shopifyId) ?? []
        : skusByOrderNumber.get(key(r.order_number) ?? extractedOrderNumber ?? "") ?? [];
      const skuItems = Array.from(new Set(linkedSkus
        .map((s) => (s.product_name ?? s.sku ?? "").trim().replace(/\s*\*+\s*$/, ""))
        .filter(Boolean)));
      const skuCodes = Array.from(new Set(linkedSkus
        .map((s) => (s.sku ?? "").trim())
        .filter(Boolean)));
      const rawCategories = parseJson<string[]>(r.sku_categories, []);
      const skuCategories = inferCategories(rawCategories, skuItems, r.message_excerpt);

      const parsed = parseResolution(r.resolution_applied, r.tags);
      const dbResolutionCost = Number(r.resolution_cost ?? 0);
      const resolutionCost = dbResolutionCost > 0 ? dbResolutionCost : parsed.cost;
      const resolutionComponents = parseJson<string[]>(r.resolution_components, parsed.components);
      const resolutionSource = (r.resolution_source as "db" | "tags" | "derived" | "gorgias_custom_field" | null) ?? parsed.source;
      const rootCause = r.root_cause ?? deriveRootCause(allConcerns, r.tags);
      const needsReview = deriveNeedsReview(allConcerns, concerns, skuCategories, r);
      const explicitResolution = r.resolution_applied?.trim() || null;
      const hasAppliedResolution = Boolean(explicitResolution || parsed.hasAppliedResolution);
      const photoUrls = parseJson<{ url?: string; name?: string | null; contentType?: string | null; content_type?: string | null }[]>(
        r.gorgias_photo_urls,
        [],
      )
        .map((photo) => ({
          url: String(photo.url ?? "").trim(),
          name: photo.name ?? null,
          contentType: photo.contentType ?? photo.content_type ?? null,
        }))
        .filter((photo) => photo.url);

      return {
        idNumber: Number(r.ticket_id),
        shopifyOrderNumber: r.order_number ?? extractedOrderNumber,
        dateOfComplaint: r.ticket_created_at,
        orderFulfilledAt: r.order_fulfilled_at,
        customerName: r.customer_name ?? r.customer_email,
        skuInQuestion: skuCodes.length ? skuCodes.join(", ") : fallbackSku,
        reportedItemName: r.reported_item_name ?? null,
        skuItems,
        skuCodes,
        skuCategories,
        fulfillmentCenter: null,
        carrierTrackingNumber: null,
        perceivedConcern: concerns.length ? concerns.join(", ") : null,
        concerns,
        gorgiasLink: `https://appyhour.gorgias.com/app/ticket/${r.ticket_id}`,
        ceoComments: null,
        direction: null,
        correctiveAction: explicitResolution ?? parsed.label,
        resolutionApplied: explicitResolution ?? parsed.label,
        resolutionSource,
        resolutionComponents,
        dateResolved: r.resolution_applied_at ?? r.ticket_closed_at,
        resolutionCost: hasAppliedResolution ? resolutionCost : 0,
        hasAppliedResolution,
        isResolved: r.status === "closed",
        rootCause,
        needsReview,
        tags: r.tags,
        messageExcerpt: r.message_excerpt,
        photoUrls,
        resolutionReference: r.gorgias_resolution_reference ?? null,
        classifierReasoning: r.classifier_reasoning ?? null,
      };
    });

    return NextResponse.json(tickets);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
