#!/usr/bin/env node
// Backfill missing Shopify order links/SKUs for food-safety tickets using Recharge.
//
// Dry run:
//   node scripts/with-root-env.cjs node scripts/backfill-recharge-orders.cjs
// Write:
//   node scripts/with-root-env.cjs node scripts/backfill-recharge-orders.cjs --write
//
// On the Droplet this also loads /opt/n8n/.env, where the Recharge token lives.

const fs = require("fs");
const mysql = require("mysql2/promise");

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
const refreshAll = process.argv.includes("--all");
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const limit = limitArg ? Math.max(1, Number(limitArg.split("=")[1]) || 100) : 250;
let lastRechargeCallAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function envBool(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  return !["0", "false", "no", "off"].includes(raw.trim().toLowerCase());
}

function orderNumberFromText(text) {
  if (!text) return null;
  const match = String(text).match(/(?:order\s*#?\s*|#)(\d{5,})/i);
  return match?.[1] ?? null;
}

function explicitOrderNumber(ticket) {
  return String(ticket.gorgias_order_field || "").replace(/[^0-9]/g, "") ||
    orderNumberFromText(`${ticket.subject || ""}\n${ticket.message_excerpt || ""}`);
}

function rechargeToken() {
  return process.env.RECHARGE_API_TOKEN || process.env.RECHARGE_API_KEY;
}

async function rechargeGet(path) {
  const token = rechargeToken();
  if (!token) throw new Error("RECHARGE_API_TOKEN/RECHARGE_API_KEY is missing");
  let lastText = "";
  let lastError = null;
  for (let attempt = 0; attempt < 7; attempt += 1) {
    const wait = Math.max(0, 750 - (Date.now() - lastRechargeCallAt));
    if (wait) await sleep(wait);
    lastRechargeCallAt = Date.now();
    try {
      const res = await fetch(`https://api.rechargeapps.com${path}`, {
        headers: {
          "X-Recharge-Access-Token": token,
          "X-Recharge-Version": "2021-11",
          "Content-Type": "application/json",
        },
      });
      const text = await res.text();
      if (res.ok) return JSON.parse(text);
      lastText = text;
      if (![429, 500, 502, 503, 504].includes(res.status)) {
        throw new Error(`Recharge ${res.status}: ${text.slice(0, 300)}`);
      }
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1500 * Math.pow(2, attempt));
    } catch (error) {
      lastError = error;
      const message = String(error?.message || error);
      if (!/fetch failed|UND_ERR|socket|ECONN|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|429|500|502|503|504/i.test(message)) {
        throw error;
      }
      await sleep(1500 * Math.pow(2, attempt));
    }
  }
  if (lastError) throw lastError;
  throw new Error(`Recharge retry exhausted: ${lastText.slice(0, 300)}`);
}

function externalOrderNumber(order) {
  return String(order.external_order_number?.ecommerce || order.external_order_name?.ecommerce || "")
    .replace(/[^0-9]/g, "") || null;
}

function externalOrderId(order) {
  return order.external_order_id?.ecommerce ? String(order.external_order_id.ecommerce) : null;
}

function shipDate(order) {
  const prop = (order.line_items || [])
    .flatMap((item) => item.properties || [])
    .find((p) => p.name === "_SHIP" && p.value);
  return prop?.value || order.scheduled_at || order.processed_at || order.created_at || null;
}

function chooseOrder(ticket, orders) {
  const explicit = explicitOrderNumber(ticket);
  if (explicit) {
    return orders.find((order) => externalOrderNumber(order) === explicit) || null;
  }
  if (orders.length === 1) return orders[0];
  const ticketMs = Date.parse(ticket.ticket_created_at || "");
  if (!Number.isFinite(ticketMs)) return null;
  return [...orders]
    .filter((order) => {
      const orderMs = Date.parse(order.processed_at || order.created_at || order.scheduled_at || "");
      return Number.isFinite(orderMs) && orderMs <= ticketMs;
    })
    .sort((a, b) => {
      const aMs = Date.parse(a.processed_at || a.created_at || a.scheduled_at || "");
      const bMs = Date.parse(b.processed_at || b.created_at || b.scheduled_at || "");
      return bMs - aMs;
    })[0] || null;
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

  const [tickets] = await conn.query(`
    SELECT ticket_id, ticket_created_at, customer_name, customer_email, subject, message_excerpt, gorgias_order_field
    FROM gorgias_tickets
    WHERE is_food_safety = 1
      AND (
        ? = 1
        OR order_number IS NULL OR order_number = ''
        OR shopify_order_id IS NULL OR shopify_order_id = ''
        OR order_source IS NULL OR order_source <> 'recharge'
      )
      AND customer_email IS NOT NULL
      AND customer_email <> ''
      AND customer_email <> 'reply@notification.stamped.io'
      AND customer_email NOT LIKE '%stamped.io%'
      AND customer_email NOT LIKE 'bickerstethdemilade+%@gmail.com'
      AND (customer_name IS NULL OR customer_name NOT REGEXP '^(Demilade Test|Test Customer|Stamped\\\\.io|Load Round2|Load [0-9]+ Customer|Test[CD])')
      AND (subject IS NULL OR subject NOT LIKE 'Product Reviews - New % review by %')
    ORDER BY ticket_created_at DESC
    LIMIT ?
  `, [refreshAll ? 1 : 0, limit]);

  const byEmail = new Map();
  const byOrderNumber = new Map();
  let matched = 0;
  let skipped = 0;
  let errors = 0;

  for (const ticket of tickets) {
    try {
      const email = String(ticket.customer_email || "").trim().toLowerCase();
      if (!email) {
        skipped += 1;
        continue;
      }

      const explicit = explicitOrderNumber(ticket);
      let order = null;

      if (explicit) {
        if (!byOrderNumber.has(explicit)) {
          const result = await rechargeGet(`/orders?external_order_number=${encodeURIComponent(explicit)}&limit=5`);
          const exact = (result.orders || []).find((candidate) => externalOrderNumber(candidate) === explicit) || null;
          byOrderNumber.set(explicit, exact);
        }
        order = byOrderNumber.get(explicit);
      }

      if (!order) {
        let customerData = byEmail.get(email);
        if (!customerData) {
          const customers = await rechargeGet(`/customers?email=${encodeURIComponent(email)}`);
          const customer = (customers.customers || [])[0];
          if (!customer) {
            customerData = { orders: [] };
          } else {
            const orders = await rechargeGet(`/orders?customer_id=${customer.id}&limit=100`);
            customerData = { orders: orders.orders || [] };
          }
          byEmail.set(email, customerData);
        }
        order = chooseOrder(ticket, customerData.orders);
      }
      const orderNumber = order ? externalOrderNumber(order) : null;
      const shopifyOrderId = order ? externalOrderId(order) : null;
      if (!order || !orderNumber || !shopifyOrderId) {
        skipped += 1;
        continue;
      }

      const lineItems = (order.line_items || [])
        .map((item) => ({
          sku: String(item.sku || "").trim(),
          productName: String(item.title || item.name || item.variant_title || item.sku || "").trim(),
          quantity: Number(item.quantity) || 1,
        }))
        .filter((item) => item.sku || item.productName);

      matched += 1;
      console.log(`${write ? "WRITE" : "DRY"} ticket=${ticket.ticket_id} email=${email} explicit=${ticket.gorgias_order_field || "-"} order=${orderNumber} shopify_id=${shopifyOrderId} skus=${lineItems.map((i) => i.sku || i.productName).join("|")}`);

      if (!write) continue;

      await conn.execute(`
        UPDATE gorgias_tickets
        SET order_number = ?,
            shopify_order_id = ?,
            order_fulfilled_at = ?,
            order_source = 'recharge',
            order_date_source = 'recharge_ship_property',
            recharge_order_id = ?,
            recharge_charge_id = ?,
            recharge_customer_id = ?
        WHERE ticket_id = ?
      `, [
        orderNumber,
        shopifyOrderId,
        shipDate(order),
        String(order.id || ""),
        String(order.charge?.id || ""),
        String(order.customer?.id || ""),
        ticket.ticket_id,
      ]);

      for (const item of lineItems) {
        await conn.execute(`
          INSERT INTO shopify_order_skus (shopify_order_id, order_number, sku, product_name, quantity)
          VALUES (?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            order_number = VALUES(order_number),
            product_name = VALUES(product_name),
            quantity = VALUES(quantity)
        `, [shopifyOrderId, orderNumber, item.sku || item.productName, item.productName || item.sku, item.quantity]);
      }
    } catch (error) {
      errors += 1;
      console.error(`ERROR ticket=${ticket.ticket_id}: ${error.message}`);
    }
  }

  console.log(JSON.stringify({
    scanned: tickets.length,
    matched,
    skipped,
    errors,
    mode: write ? "write" : "dry-run",
  }, null, 2));

  await conn.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
