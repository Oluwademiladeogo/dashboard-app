#!/usr/bin/env node
// Deterministic backfill of resolution_applied / resolution_cost / resolution_source
// from gorgias_tickets.tags. Mirrors lib/resolution.ts.
//
// Run from the dashboard-app directory:
//   node scripts/with-root-env.cjs node scripts/backfill-resolutions.cjs            # dry-run
//   node scripts/with-root-env.cjs node scripts/backfill-resolutions.cjs --write    # apply

const mysql = require("mysql2/promise");
const fs = require("fs");

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

const RESHIP_COST = 65;
const PARTIAL_RESHIP_COST = 30;
const EXTRA_MEAT_OR_CHEESE_COST = 10;
const EXTRA_ACCOMPANIMENT_COST = 6;

const has = (s, arr) => arr.some((p) => s.includes(p));

function parseResolution(resolutionApplied, tags) {
  const explicit = (resolutionApplied || "").trim();
  const fallback = (tags || "").trim();
  const raw = explicit || fallback;
  if (!raw) return null;
  const text = raw.toLowerCase();
  const source = explicit ? "db" : "tags";

  const hasFullReship = has(text, ["full reship", "reship full", "complimentary reship"]) ||
    (text.includes("reship") && !text.includes("partial"));
  const hasPartialReship = has(text, ["partial reship"]);
  const hasFullRefund = has(text, ["full refund", "refund duplicate", "refund order::full refund"]);
  const hasExtraCheese = has(text, ["extra cheese", "free_cheese", "free cheese", "refund10_freecheese", "comp cheese"]);
  const hasExtraMeat = has(text, ["extra meat", "free_meat", "free meat", "refund10_freemeat", "comp meat"]);
  const hasExtraAcc = has(text, ["extra accompaniment", "extra acc", "free_acc", "free acc", "refund10_freeacc"]);
  const hasTenOff = has(text, ["$10", "10 off", "amount $10", "credit next box::amount $10", "refund10_"]);
  const hasCredit = text.includes("credit");
  const hasRefund = text.includes("refund");
  const hasAppliedCredit = has(text, ["applied credit", "credit applied", "store credit"]);
  const hasCancelSub = has(text, ["cancel sub", "cancelled sub", "subscription cancel"]);

  let normalized = null;
  let cost = 0;

  if (hasFullReship) { normalized = "full reship"; cost = RESHIP_COST; }
  else if (hasPartialReship) { normalized = "partial reship"; cost = PARTIAL_RESHIP_COST; }
  else if (hasFullRefund) { normalized = "full refund"; cost = RESHIP_COST; }
  else if (hasTenOff && hasExtraCheese) { normalized = "$10 off + extra cheese"; cost = 20; }
  else if (hasTenOff && hasExtraMeat) { normalized = "$10 off + extra meat"; cost = 20; }
  else if (hasTenOff && hasExtraAcc) { normalized = "$10 off + extra accompaniment"; cost = 16; }
  else if (hasExtraCheese) { normalized = "extra cheese"; cost = EXTRA_MEAT_OR_CHEESE_COST; }
  else if (hasExtraMeat) { normalized = "extra meat"; cost = EXTRA_MEAT_OR_CHEESE_COST; }
  else if (hasExtraAcc) { normalized = "extra accompaniment"; cost = EXTRA_ACCOMPANIMENT_COST; }
  else {
    const m = text.match(/\$(\d+(?:\.\d+)?)/);
    if (m) {
      const amt = Number.parseFloat(m[1]);
      normalized = hasRefund ? "refund" : hasCredit ? "credit" : "manual adjustment";
      cost = Number.isFinite(amt) ? amt : 0;
    } else if (hasAppliedCredit) { normalized = "applied credit"; cost = 10; }
    else if (hasRefund) { normalized = "refund"; cost = PARTIAL_RESHIP_COST; }
    else if (hasCredit) { normalized = "credit"; cost = 10; }
    else if (hasCancelSub) { normalized = "cancel subscription"; cost = 0; }
  }

  if (!normalized) return null;
  return { normalized, cost, source };
}

async function main() {
  const write = process.argv.includes("--write");
  const envBool = (n, d) => {
    const v = process.env[n];
    if (v == null || v === "") return d;
    return !["0", "false", "no", "off"].includes(v.trim().toLowerCase());
  };
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

  const [rows] = await conn.query(`
    SELECT ticket_id, tags, resolution_applied, resolution_cost, resolution_source
    FROM gorgias_tickets
    WHERE is_food_safety = 1
      AND (resolution_applied IS NULL OR resolution_cost IS NULL OR resolution_cost = 0)
  `);

  let matched = 0;
  let updated = 0;
  const sample = [];

  for (const r of rows) {
    const parsed = parseResolution(r.resolution_applied, r.tags);
    if (!parsed) continue;
    matched += 1;
    if (sample.length < 5) sample.push({ id: r.ticket_id, tags: r.tags, ...parsed });

    if (write) {
      await conn.execute(
        `UPDATE gorgias_tickets
         SET resolution_applied = COALESCE(resolution_applied, ?),
             resolution_cost = ?,
             resolution_source = COALESCE(resolution_source, ?),
             resolution_applied_at = COALESCE(resolution_applied_at, ticket_closed_at, NOW())
         WHERE ticket_id = ?`,
        [parsed.normalized, parsed.cost, parsed.source, r.ticket_id]
      );
      updated += 1;
    }
  }

  console.log(`scanned: ${rows.length}, matched: ${matched}, ${write ? `updated: ${updated}` : "DRY RUN (pass --write to apply)"}`);
  if (sample.length) {
    console.log("sample:");
    for (const s of sample) console.log(`  ${s.id}\t${s.normalized}\t$${s.cost}\t<- ${(s.tags || "").slice(0, 80)}`);
  }

  await conn.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
