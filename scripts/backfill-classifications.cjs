#!/usr/bin/env node
// Bridges workflow_logs.category (written by the active n8n Ticket Automation
// workflow) into gorgias_tickets.is_food_safety + concerns + classified_at.
// Zero Anthropic API cost — re-uses classifications already performed.
//
//   node scripts/with-root-env.cjs node scripts/backfill-classifications.cjs           # dry-run
//   node scripts/with-root-env.cjs node scripts/backfill-classifications.cjs --write   # apply

const mysql = require("mysql2/promise");

// category prefix → { isFoodSafety, concern }
function mapCategory(category) {
  if (!category) return null;
  const c = category.trim();
  if (/^Order::Spoiled Item/i.test(c)) return { fs: 1, concern: "Spoiled" };
  if (/^Order::Quality Complaint/i.test(c)) return { fs: 1, concern: "Quality Issue" };
  if (/^Shipping::Damaged in transit::Arrived Warm/i.test(c)) return { fs: 1, concern: "Arrived Warm" };
  if (/Arrived Warm/i.test(c)) return { fs: 1, concern: "Arrived Warm" };
  if (/Mold|Moldy/i.test(c)) return { fs: 1, concern: "Mold" };
  if (/Expired/i.test(c)) return { fs: 1, concern: "Expired" };
  if (/Broken Seal|Contamination/i.test(c)) return { fs: 1, concern: "Contamination" };
  return { fs: 0, concern: null };
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

  // Latest workflow_logs row per ticket
  const [rows] = await conn.query(`
    SELECT t.ticket_id, t.is_food_safety, t.classified_at, t.concerns, w.category, w.created_at AS classified_at_src
    FROM gorgias_tickets t
    JOIN workflow_logs w
      ON w.id = (
        SELECT id FROM workflow_logs w2
        WHERE w2.ticket_id = t.ticket_id
        ORDER BY w2.id DESC LIMIT 1
      )
    WHERE t.classified_at IS NULL
  `);

  let fsCount = 0;
  let nonFs = 0;
  const buckets = {};

  for (const r of rows) {
    const m = mapCategory(r.category);
    if (!m) continue;
    buckets[r.category] = (buckets[r.category] || 0) + 1;
    if (m.fs) fsCount += 1;
    else nonFs += 1;

    if (write) {
      const concerns = m.concern ? JSON.stringify([m.concern]) : null;
      await conn.execute(
        `UPDATE gorgias_tickets
         SET is_food_safety = ?,
             concerns = COALESCE(concerns, ?),
             classified_by = COALESCE(classified_by, 'workflow_logs'),
             classified_at = COALESCE(classified_at, ?)
         WHERE ticket_id = ?`,
        [m.fs, concerns, r.classified_at_src, r.ticket_id]
      );
    }
  }

  console.log(`scanned: ${rows.length}, food-safety: ${fsCount}, non-fs: ${nonFs}, ${write ? "WRITTEN" : "DRY RUN (--write to apply)"}`);
  const top = Object.entries(buckets).sort((a, b) => b[1] - a[1]).slice(0, 12);
  for (const [cat, c] of top) console.log(`  ${c}\t${cat}`);

  await conn.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
