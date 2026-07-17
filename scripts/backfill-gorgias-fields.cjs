#!/usr/bin/env node
// Deterministic backfill from Gorgias ticket detail fields.
//
// Uses:
// - custom_fields[13284] as the CS action / resolution field
// - custom_fields[69766] as the CS-selected order number
// - Gorgias Shopify integration order payload for order id, SKUs, refunds, dates

const fs = require("fs");
const mysql = require("mysql2/promise");

const ACTION_FIELD_ID = "13284";
const ORDER_FIELD_ID = "69766";
const ISSUE_FIELD_ID = "13282";

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[m[1]]) process.env[m[1]] = value;
  }
}

loadEnv(".env.local");
loadEnv("/opt/n8n/.env");

const write = process.argv.includes("--write");
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const limit = limitArg ? Math.max(1, Number(limitArg.split("=")[1]) || 100) : 250;

function envBool(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  return !["0", "false", "no", "off"].includes(raw.trim().toLowerCase());
}

async function gorgiasToken() {
  const res = await fetch(`https://${process.env.GORGIAS_DOMAIN}/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${process.env.GORGIAS_BASIC_AUTH}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(process.env.GORGIAS_REFRESH_TOKEN)}`,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Gorgias token ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text).access_token;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function gorgiasGet(path, token) {
  let lastText = "";
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const res = await fetch(`https://${process.env.GORGIAS_DOMAIN}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const text = await res.text();
    if (res.ok) return JSON.parse(text);
    lastText = text;
    if (![429, 500, 502, 503, 504].includes(res.status)) {
      throw new Error(`Gorgias ${res.status}: ${text.slice(0, 300)}`);
    }
    const retryAfter = Number(res.headers.get("retry-after"));
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : 1200 * Math.pow(2, attempt);
    await sleep(waitMs);
  }
  throw new Error(`Gorgias retry exhausted: ${lastText.slice(0, 300)}`);
}

async function ensureColumns(conn) {
  const specs = [
    ["gorgias_photo_urls", "JSON DEFAULT NULL"],
    ["reported_item_name", "VARCHAR(255) DEFAULT NULL"],
    ["gorgias_resolution_reference", "TEXT DEFAULT NULL"],
    ["gorgias_action_raw", "VARCHAR(255) DEFAULT NULL"],
    ["gorgias_order_field", "VARCHAR(64) DEFAULT NULL"],
  ];
  for (const [name, ddl] of specs) {
    const [rows] = await conn.query(
      "SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'gorgias_tickets' AND column_name = ?",
      [name],
    );
    if (Number(rows[0]?.n || 0) === 0) {
      await conn.query(`ALTER TABLE gorgias_tickets ADD COLUMN ${name} ${ddl}`);
      console.log(`added column ${name}`);
    }
  }
}

function customField(ticket, id) {
  const field = ticket?.custom_fields?.[id];
  if (field && typeof field === "object" && "value" in field) return field.value;
  return field ?? null;
}

function toMySQL(date) {
  return date ? new Date(date).toISOString().replace("T", " ").replace(/\.\d+Z$/, "") : null;
}

function orderNumber(order) {
  return String(order?.order_number || order?.name || "").replace(/[^0-9]/g, "") || null;
}

function fulfillmentDate(order) {
  const dates = (order?.fulfillments || [])
    .map((f) => f.created_at || f.updated_at)
    .filter(Boolean)
    .sort();
  return dates[0] || order?.closed_at || null;
}

function refundAmount(order) {
  return (order?.refunds || [])
    .flatMap((refund) => refund.transactions || [])
    .filter((tx) => tx.kind === "refund" && tx.status !== "failure")
    .reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0);
}

function shopifyOrders(ticket) {
  const integrations = ticket?.customer?.integrations || {};
  return Object.values(integrations)
    .filter((integration) => integration?.__integration_type__ === "shopify")
    .flatMap((integration) => integration.orders || []);
}

function chooseShopifyOrder(ticket) {
  const requested = customField(ticket, ORDER_FIELD_ID);
  const orders = shopifyOrders(ticket);
  if (requested) {
    const match = orders.find((order) => String(orderNumber(order)) === String(requested));
    if (match) return match;
  }
  return orders.length === 1 ? orders[0] : null;
}

function lineItems(order) {
  return (order?.line_items || [])
    .map((item) => ({
      sku: String(item.sku || item.title || "").trim(),
      productName: String(item.title || item.name || item.variant_title || item.sku || "").trim(),
      quantity: Number(item.quantity) || 1,
    }))
    .filter((item) => item.sku || item.productName);
}

function ticketMessagesText(messages) {
  return (messages?.data || [])
    .filter((message) => message && message.from_agent === false && message.channel !== "internal-note" && !message.is_internal)
    .map((message) => message.body_text || message.stripped_text || message.subject || "")
    .filter(Boolean)
    .join("\n");
}

function imageAttachments(messages) {
  return (messages?.data || [])
    .filter((message) => message && message.from_agent === false && message.channel !== "internal-note" && !message.is_internal)
    .flatMap((message) => message.attachments || [])
    .filter((attachment) => /^image\//i.test(String(attachment.content_type || attachment.contentType || "")))
    .map((attachment) => ({
      url: String(attachment.url || "").trim(),
      name: attachment.name || null,
      contentType: attachment.content_type || attachment.contentType || null,
    }))
    .filter((attachment) => attachment.url);
}

function itemCategory(name) {
  const s = String(name || "").toLowerCase();
  if (/appyhour box|free artisan|pairings for life|custom|curator/.test(s)) return "Multiple Item";
  if (/(salami|prosciutto|chorizo|sopressata|bresaola|lonza|capocollo|serrano|meat|charcuterie)/.test(s)) return "Meat";
  if (/(cracker|flatbread|almond|olive|fig|honey|jam|cherry|pecan|pretzel|preserve|sourdough)/.test(s)) return "Accompaniment";
  if (/(brie|cheddar|gouda|ricotta|comte|gruy[eè]re|feta|cheese|toma|fontal|tetilla|manchego|blossom|fleece)/.test(s)) return "Cheese";
  return "Multiple Item";
}

function words(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 4 && !["cheese", "meat", "tray", "item", "order", "mold", "moldy", "spoiled"].includes(word));
}

function relevantItems(items, issueText, messageText) {
  const text = `${issueText || ""} ${messageText || ""}`.toLowerCase();
  const target =
    /\b(meat|prosciutto|salami|charcuterie|tray)\b/.test(text) ? "Meat" :
    /\b(cheese|brie|cheddar|gouda|mold|mould)\b/.test(text) ? "Cheese" :
    /\b(accompaniment|cracker|jam|olive|honey|almond)\b/.test(text) ? "Accompaniment" :
    null;
  const nonWrapper = items.filter((item) => itemCategory(`${item.productName} ${item.sku}`) !== "Multiple Item");
  if (!target) return nonWrapper.length ? nonWrapper : items;
  const targeted = nonWrapper.filter((item) => itemCategory(`${item.productName} ${item.sku}`) === target);
  return targeted.length ? targeted : (nonWrapper.length ? nonWrapper : items);
}

function reportedItemName(items, messageText, issueText) {
  if (!items.length) return null;
  const candidates = relevantItems(items, issueText, messageText);
  if (candidates.length === 1) return candidates[0].productName || candidates[0].sku || null;

  const text = String(messageText || "").toLowerCase();
  let best = null;
  let bestScore = 0;
  for (const item of candidates) {
    const hay = `${item.productName || ""} ${item.sku || ""}`;
    const score = words(hay).reduce((sum, word) => sum + (text.includes(word) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }
  if (best && bestScore > 0) return best.productName || best.sku || null;
  return null;
}

function linkedItemSummary(items) {
  if (!items.length) return null;
  const names = Array.from(new Set(items
    .filter((item) => itemCategory(`${item.productName} ${item.sku}`) !== "Multiple Item")
    .map((item) => item.productName || item.sku)
    .filter(Boolean)));
  return names.join(", ").slice(0, 255) || null;
}

function resolutionReference(items, messageText, concerns) {
  const text = `${messageText || ""} ${(concerns || []).join(" ")} ${items.map((item) => `${item.productName} ${item.sku}`).join(" ")}`.toLowerCase();
  const categories = new Set(items.map((item) => itemCategory(`${item.productName} ${item.sku}`)));
  const isMeat = categories.has("Meat") || /\b(meat|charcuterie|prosciutto|salami|tray)\b/.test(text);
  const isBrokenSeal = /broken seal|seal|package.*open|open.*package|leak|leaking|damaged/.test(text);
  const isSoftCheese = /brie|ricotta|feta|soft|fresh|bloomy|triple creme|camembert/.test(text);
  const isInteriorOrSevere = /inside|interior|throughout|slimy|smell|odor|off smell|leaking|sick|ill|ate|consumed|entire order|all (of )?(it|them)/.test(text);
  const isHeavy = /covered|a lot|too much|large|heavy|multiple spots|whole/.test(text);
  const isExpired = /expired|expiration|exp date|best by|short dated|date/.test(text);

  if (isMeat || isBrokenSeal) {
    return "Mold Sheet: meat/tray, broken seal, off smell, or spoilage -> do not consume, discard affected item, collect photos/packaging/temp/expiration details, escalate food-safety review, and resolve with credit/refund/replacement or extra meat/tray equivalent.";
  }
  if (isExpired && !/mold|moldy|spoiled|bad/.test(text)) {
    return "Mold Sheet: short-dated but not spoiled -> explain best-by timing, ask for expiration photo if needed, and use a small credit baseline where appropriate.";
  }
  if (isInteriorOrSevere) {
    return "Mold Sheet: interior mold, slime/leaking, off smell, illness risk, or entire order affected -> discard item, collect photos, escalate to Tommy/Dan/Jess, and resolve with credit/replacement/reship depending on scope.";
  }
  if (isSoftCheese) {
    return "Mold Sheet: soft/fresh/bloomy-rind cheese with unexpected mold -> discard item, collect photo, and use credit plus extra cheese as the baseline resolution.";
  }
  if (isHeavy) {
    return "Mold Sheet: hard/firm cheese with heavy mold or too much to trim -> discard affected item, collect photo, and use credit plus extra cheese as the baseline resolution.";
  }
  return "Mold Sheet: hard/firm cheese with small surface mold -> explain trimming only when safe, collect photo, and use small credit/education baseline; escalate if risk signs are present.";
}

function parseAction(raw, order) {
  if (raw == null || raw === "") return null;
  const value = String(raw).trim();
  const text = value.toLowerCase();
  const refund = refundAmount(order);
  const amountMatch = text.match(/amount\s*\$(\d+(?:\.\d+)?)/) || text.match(/\$(\d+(?:\.\d+)?)/);
  const amount = amountMatch ? Number(amountMatch[1]) || 0 : 0;

  let label = value;
  let cost = amount;
  if (text.includes("full reship")) {
    label = "full reship";
    cost = 65;
  } else if (text.includes("partial reship")) {
    label = "partial reship";
    cost = 30;
  } else if (text.includes("full refund")) {
    label = "full refund";
    cost = refund || Number(order?.total_price) || 65;
  } else if (text.includes("$10 off") && text.includes("extra cheese")) {
    label = "$10 off + extra cheese";
    cost = 20;
  } else if (text.includes("$10 off") && text.includes("extra meat")) {
    label = "$10 off + extra meat";
    cost = 20;
  } else if (text.includes("$10 off") && text.includes("extra")) {
    label = "$10 off + extra accompaniment";
    cost = 16;
  } else if (text.includes("comp item") && text.includes("extra cheese")) {
    label = "extra cheese";
    cost = 10;
  } else if (text.includes("comp item") && text.includes("extra meat")) {
    label = "extra meat";
    cost = 10;
  } else if (text.includes("comp item") && text.includes("extra accompaniment")) {
    label = "extra accompaniment";
    cost = 6;
  } else if (text.includes("credit next box")) {
    label = `credit next box${amount ? ` $${amount}` : ""}`;
  } else if (text.includes("information given")) {
    label = "information given";
    cost = 0;
  } else if (text.includes("no action") || text.includes("did not respond")) {
    label = "no action / did not respond";
    cost = 0;
  } else if (text.includes("sub") && text.includes("cancel")) {
    label = "subscription/order canceled";
    cost = refund || 0;
  } else if (text.includes("refund")) {
    label = "refund";
    cost = refund || amount || 30;
  }

  return {
    label,
    cost,
    raw: value,
  };
}

async function main() {
  const ssl = envBool("DB_SSL", true)
    ? { rejectUnauthorized: envBool("DB_SSL_REJECT_UNAUTHORIZED", true) }
    : undefined;
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 25060,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl,
  });
  await ensureColumns(conn);
  const token = await gorgiasToken();

  const [tickets] = await conn.query(`
    SELECT ticket_id
    FROM gorgias_tickets
    WHERE is_food_safety = 1
      AND (
        order_number IS NULL OR order_number = ''
        OR shopify_order_id IS NULL OR shopify_order_id = ''
        OR resolution_applied IS NULL OR resolution_applied = ''
        OR resolution_cost IS NULL OR resolution_cost = 0
        OR gorgias_photo_urls IS NULL
        OR reported_item_name IS NULL OR reported_item_name = ''
        OR reported_item_name LIKE 'AppyHour Box%'
        OR gorgias_resolution_reference IS NULL OR gorgias_resolution_reference = ''
        OR gorgias_action_raw IS NULL OR gorgias_action_raw = ''
        OR gorgias_order_field IS NULL OR gorgias_order_field = ''
      )
    ORDER BY ticket_created_at DESC
    LIMIT ?
  `, [limit]);

  let scanned = 0;
  let orderMatched = 0;
  let actionMatched = 0;
  let updated = 0;
  let errors = 0;

  for (const row of tickets) {
    scanned += 1;
    let ticket;
    let messages;
    try {
      ticket = await gorgiasGet(`/api/tickets/${row.ticket_id}`, token);
      messages = await gorgiasGet(`/api/tickets/${row.ticket_id}/messages`, token);
    } catch (error) {
      errors += 1;
      console.error(`ERROR ticket=${row.ticket_id}: ${error.message}`);
      continue;
    }
    const order = chooseShopifyOrder(ticket);
    const rawAction = customField(ticket, ACTION_FIELD_ID);
    const rawOrderField = customField(ticket, ORDER_FIELD_ID);
    const rawIssueField = customField(ticket, ISSUE_FIELD_ID);
    const action = parseAction(rawAction, order);
    const items = lineItems(order);
    const customerText = ticketMessagesText(messages);
    const photos = imageAttachments(messages);
    const reportedItem = reportedItemName(items, customerText, rawIssueField) || linkedItemSummary(items);
    const reference = resolutionReference(items, customerText, rawIssueField ? [String(rawIssueField)] : []);
    if (order) orderMatched += 1;
    if (action) actionMatched += 1;

    console.log(`${write ? "WRITE" : "DRY"} ticket=${row.ticket_id} order=${orderNumber(order) || "-"} action=${action?.label || "-"} cost=${action?.cost ?? "-"} photos=${photos.length}`);
    if (!write) continue;

    await conn.execute(`
      UPDATE gorgias_tickets
      SET customer_email = COALESCE(NULLIF(customer_email, ''), ?),
          shopify_order_id = COALESCE(NULLIF(shopify_order_id, ''), ?),
          order_number = COALESCE(NULLIF(order_number, ''), ?),
          order_financial_status = COALESCE(order_financial_status, ?),
          order_fulfillment_status = COALESCE(order_fulfillment_status, ?),
          order_fulfilled_at = COALESCE(order_fulfilled_at, ?),
          order_total_price = COALESCE(order_total_price, ?),
          order_created_at = COALESCE(order_created_at, ?),
          total_orders_found = GREATEST(COALESCE(total_orders_found, 0), ?),
          sku_in_question = COALESCE(NULLIF(sku_in_question, ''), ?),
          order_source = COALESCE(order_source, ?),
          order_date_source = COALESCE(order_date_source, ?),
          resolution_applied = COALESCE(?, resolution_applied),
          resolution_components = COALESCE(?, resolution_components),
          resolution_cost = CASE WHEN ? IS NOT NULL THEN ? ELSE resolution_cost END,
          resolution_source = COALESCE(?, resolution_source),
          resolution_applied_at = COALESCE(resolution_applied_at, ticket_closed_at, NOW()),
          gorgias_action_raw = COALESCE(?, gorgias_action_raw),
          gorgias_order_field = COALESCE(?, gorgias_order_field),
          reported_item_name = COALESCE(?, reported_item_name),
          gorgias_photo_urls = COALESCE(?, gorgias_photo_urls),
          gorgias_resolution_reference = COALESCE(?, gorgias_resolution_reference)
      WHERE ticket_id = ?
    `, [
      ticket.customer?.email || null,
      order?.id ? String(order.id) : null,
      orderNumber(order),
      order?.financial_status || null,
      order?.fulfillment_status || null,
      toMySQL(fulfillmentDate(order)),
      order?.total_price != null ? Number(order.total_price) || null : null,
      toMySQL(order?.created_at),
      shopifyOrders(ticket).length,
      items[0]?.sku || null,
      order ? "gorgias_shopify_integration" : null,
      order ? "gorgias_shopify_fulfillment" : null,
      action?.label || null,
      action ? JSON.stringify([action.raw]) : null,
      action ? 1 : null,
      action?.cost ?? null,
      action ? "gorgias_custom_field" : null,
      rawAction ? String(rawAction) : null,
      rawOrderField ? String(rawOrderField) : orderNumber(order),
      reportedItem,
      JSON.stringify(photos),
      reference,
      String(row.ticket_id),
    ]);

    for (const item of items) {
      await conn.execute(`
        INSERT INTO shopify_order_skus (shopify_order_id, order_number, sku, product_name, quantity)
        VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          order_number = VALUES(order_number),
          product_name = VALUES(product_name),
          quantity = VALUES(quantity)
      `, [
        String(order.id),
        orderNumber(order),
        item.sku || item.productName,
        item.productName || item.sku,
        item.quantity,
      ]);
    }
    updated += 1;
  }

  console.log(JSON.stringify({ scanned, orderMatched, actionMatched, updated, errors, mode: write ? "write" : "dry-run" }, null, 2));
  await conn.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
