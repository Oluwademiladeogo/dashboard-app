#!/usr/bin/env node
// Ingest historical Gorgias tickets into MySQL so the normal classifier and
// enrichment scripts can backfill food-safety reporting.
//
// Dry run:
//   node scripts/with-root-env.cjs node scripts/backfill-gorgias-history.cjs --since=2026-01-01
// Write:
//   node scripts/with-root-env.cjs node scripts/backfill-gorgias-history.cjs --since=2026-01-01 --write

const fs = require("fs");
const mysql = require("mysql2/promise");
const loadRootEnv = require("./load-root-env.cjs");

loadRootEnv();
loadEnv(".env.local");
loadEnv("/opt/n8n/.env");

const write = process.argv.includes("--write");
const sinceArg = argValue("--since") || "2026-01-01";
const maxPages = Number(argValue("--max-pages") || 250);
const orderBy = argValue("--order-by") || "created_datetime:desc";
const sinceMs = Date.parse(`${sinceArg}T00:00:00Z`);

if (!Number.isFinite(sinceMs)) {
  console.error(`Invalid --since date: ${sinceArg}`);
  process.exit(1);
}

function argValue(name) {
  const arg = process.argv.find((value) => value.startsWith(`${name}=`));
  return arg ? arg.slice(name.length + 1) : null;
}

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

function envBool(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  return !["0", "false", "no", "off"].includes(raw.trim().toLowerCase());
}

function toMySQL(value) {
  if (!value) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().slice(0, 19).replace("T", " ");
}

function cleanText(value, max = null) {
  const out = value == null ? null : String(value).trim();
  if (!out) return null;
  return max ? out.slice(0, max) : out;
}

function ticketTags(ticket) {
  return (ticket.tags || [])
    .map((tag) => typeof tag === "string" ? tag : tag?.name)
    .filter(Boolean)
    .join(",");
}

function isNoiseTicket(ticket) {
  const email = String(ticket.customer?.email || "").toLowerCase();
  const name = String(ticket.customer?.name || "").toLowerCase();
  const subject = String(ticket.subject || "").toLowerCase();
  if (!email && !subject) return true;
  if (email === "reply@notification.stamped.io" || email.includes("stamped.io")) return true;
  if (email.startsWith("bickerstethdemilade+")) return true;
  if (/(^|@)(no-reply|noreply|admin|support)\b/.test(email) && !email.includes("appyhour")) return true;
  if (/^(demilade test|test customer|stamped\.io|load round2|load \d+ customer|test[cd])/.test(name)) return true;
  if (subject.startsWith("product reviews - new ")) return true;
  return false;
}

function firstPageDate(rows) {
  const values = rows
    .map((ticket) => Date.parse(ticket.created_datetime || ticket.updated_datetime || ""))
    .filter(Number.isFinite);
  return values.length ? new Date(Math.max(...values)).toISOString() : null;
}

function lastPageDate(rows) {
  const values = rows
    .map((ticket) => Date.parse(ticket.created_datetime || ticket.updated_datetime || ""))
    .filter(Number.isFinite);
  return values.length ? new Date(Math.min(...values)).toISOString() : null;
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function gorgiasToken() {
  for (const key of ["GORGIAS_DOMAIN", "GORGIAS_BASIC_AUTH", "GORGIAS_REFRESH_TOKEN"]) {
    if (!process.env[key]) throw new Error(`Missing env: ${key}`);
  }
  const res = await fetch(`https://${process.env.GORGIAS_DOMAIN}/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${process.env.GORGIAS_BASIC_AUTH}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(process.env.GORGIAS_REFRESH_TOKEN)}`,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Gorgias token ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text).access_token;
}

async function gorgiasGet(path, token) {
  let lastText = "";
  let lastError = null;
  for (let attempt = 0; attempt < 7; attempt += 1) {
    try {
      const res = await fetch(`https://${process.env.GORGIAS_DOMAIN}${path}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
      const text = await res.text();
      if (res.ok) return JSON.parse(text);
      lastText = text;
      if (![429, 500, 502, 503, 504].includes(res.status)) {
        throw new Error(`Gorgias ${res.status}: ${text.slice(0, 500)}`);
      }
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * Math.pow(2, attempt));
    } catch (error) {
      lastError = error;
      const message = String(error?.message || error);
      if (!/fetch failed|UND_ERR|socket|ECONN|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|429|500|502|503|504/i.test(message)) {
        throw error;
      }
      await sleep(1000 * Math.pow(2, attempt));
    }
  }
  if (lastError) throw lastError;
  throw new Error(`Gorgias retry exhausted: ${lastText.slice(0, 500)}`);
}

async function connect() {
  for (const key of ["DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME"]) {
    if (!process.env[key]) throw new Error(`Missing env: ${key}`);
  }
  const ssl = envBool("DB_SSL", true)
    ? { rejectUnauthorized: envBool("DB_SSL_REJECT_UNAUTHORIZED", true) }
    : undefined;
  return await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 25060,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl,
  });
}

async function upsertTicket(conn, ticket) {
  await conn.execute(`
    INSERT INTO gorgias_tickets (
      ticket_id, ticket_external_id, subject, status, channel, customer_email,
      customer_name, tags, assignee_email, message_count, ticket_created_at,
      ticket_updated_at, ticket_closed_at, synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    ON DUPLICATE KEY UPDATE
      ticket_external_id = COALESCE(VALUES(ticket_external_id), ticket_external_id),
      subject = VALUES(subject),
      status = VALUES(status),
      channel = VALUES(channel),
      customer_email = COALESCE(VALUES(customer_email), customer_email),
      customer_name = COALESCE(VALUES(customer_name), customer_name),
      tags = VALUES(tags),
      assignee_email = VALUES(assignee_email),
      message_count = VALUES(message_count),
      ticket_created_at = COALESCE(ticket_created_at, VALUES(ticket_created_at)),
      ticket_updated_at = VALUES(ticket_updated_at),
      ticket_closed_at = VALUES(ticket_closed_at),
      synced_at = NOW()
  `, [
    String(ticket.id),
    cleanText(ticket.external_id, 128),
    cleanText(ticket.subject),
    cleanText(ticket.status, 32),
    cleanText(ticket.channel, 64),
    cleanText(ticket.customer?.email, 255)?.toLowerCase() || null,
    cleanText(ticket.customer?.name, 255),
    ticketTags(ticket),
    cleanText(ticket.assignee_user?.email, 255),
    Number(ticket.messages_count) || 0,
    toMySQL(ticket.created_datetime),
    toMySQL(ticket.updated_datetime),
    toMySQL(ticket.closed_datetime),
  ]);
}

async function main() {
  const token = await gorgiasToken();
  const conn = write ? await connect() : null;
  const seen = new Set();
  let cursor = null;
  let pages = 0;
  let fetched = 0;
  let eligible = 0;
  let noise = 0;
  let inserted = 0;
  let oldest = null;
  let newest = null;
  let stoppedByDate = false;

  try {
    for (let page = 0; page < maxPages; page += 1) {
      const params = new URLSearchParams({ limit: "100", order_by: orderBy });
      if (cursor) params.set("cursor", cursor);
      const resp = await gorgiasGet(`/api/tickets?${params.toString()}`, token);
      const rows = Array.isArray(resp.data) ? resp.data : [];
      pages += 1;
      fetched += rows.length;
      if (!rows.length) break;

      const pageNewest = firstPageDate(rows);
      const pageOldest = lastPageDate(rows);
      if (pageNewest && (!newest || Date.parse(pageNewest) > Date.parse(newest))) newest = pageNewest;
      if (pageOldest && (!oldest || Date.parse(pageOldest) < Date.parse(oldest))) oldest = pageOldest;

      for (const ticket of rows) {
        if (!ticket?.id || seen.has(String(ticket.id))) continue;
        seen.add(String(ticket.id));
        const createdMs = Date.parse(ticket.created_datetime || "");
        if (Number.isFinite(createdMs) && createdMs < sinceMs) {
          stoppedByDate = true;
          continue;
        }
        if (!Number.isFinite(createdMs)) continue;
        if (isNoiseTicket(ticket)) {
          noise += 1;
          continue;
        }
        eligible += 1;
        if (write) {
          await upsertTicket(conn, ticket);
          inserted += 1;
        }
      }

      console.log(JSON.stringify({
        event: "page",
        page: page + 1,
        rows: rows.length,
        eligible,
        noise,
        pageNewest,
        pageOldest,
        inserted,
      }));

      cursor = resp.meta?.next_cursor || null;
      if (!cursor || stoppedByDate) break;
      await sleep(600);
    }

    if (write && conn) {
      await conn.execute(`
        INSERT INTO sync_log (workflow, sync_from, sync_to, tickets_pulled, records_upserted, status, completed_at)
        VALUES ('gorgias-history-backfill', ?, NOW(), ?, ?, 'success', NOW())
      `, [toMySQL(`${sinceArg}T00:00:00Z`), fetched, inserted]);
    }

    console.log(JSON.stringify({
      event: "complete",
      mode: write ? "write" : "dry-run",
      since: sinceArg,
      orderBy,
      pages,
      fetched,
      eligible,
      noise,
      inserted,
      newest,
      oldest,
      stoppedByDate,
    }, null, 2));
  } finally {
    if (conn) await conn.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
