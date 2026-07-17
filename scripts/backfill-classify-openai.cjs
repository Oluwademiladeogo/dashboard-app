#!/usr/bin/env node
// One-shot OpenAI (gpt-5-mini) classification of unclassified gorgias_tickets.
// Step 1: for each ticket without gorgias_messages rows, fetch them from Gorgias
//         and persist (so reruns are cheap).
// Step 2: classify on subject + tags + first customer message body.
//
// Required env: OPENAI_API_KEY, GORGIAS_BASIC_AUTH, GORGIAS_REFRESH_TOKEN,
//   DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME (optional DB_SSL, DB_SSL_REJECT_UNAUTHORIZED)
// Optional: OPENAI_MODEL (default gpt-5-mini), SINCE (default 2026-05-10),
//           GORGIAS_DOMAIN (default appyhour.gorgias.com), MAX_TICKETS.
//
//   node scripts/backfill-classify-openai.cjs            # dry-run
//   node scripts/backfill-classify-openai.cjs --write    # apply

const mysql = require("mysql2/promise");

const MODEL = process.env.OPENAI_MODEL || "gpt-5-mini";
const SINCE = process.env.SINCE || "2026-05-10";
const GORGIAS_DOMAIN = process.env.GORGIAS_DOMAIN || "appyhour.gorgias.com";
const MAX_TICKETS = process.env.MAX_TICKETS ? Number(process.env.MAX_TICKETS) : null;
const BATCH_SIZE = 10;

const VALID_CONCERNS = new Set([
  "Mold", "Spoiled", "Expired", "Broken Seal", "Contamination", "Arrived Warm",
]);

const SYSTEM_PROMPT = `You classify Gorgias customer-service tickets for a charcuterie box company.
Return JSON: {"is_food_safety": boolean, "concern": "Mold"|"Spoiled"|"Expired"|"Broken Seal"|"Contamination"|"Arrived Warm"|null}.

is_food_safety = true ONLY when the customer reports one of:
- mold or moldy product
- spoiled/rotten/off-smelling product
- product past expiry / expired
- broken vacuum seal / damaged packaging exposing food
- contamination (foreign objects, mislabeling allergens)
- product arrived warm / melted / temperature failure

NOT food safety: subscription cancels, refunds, address changes, missing items, login issues,
feedback, marketing, shipping delays without warmth, wrong items, billing.

Pick the single best concern when food_safety=true, else null.`;

async function gorgiasToken() {
  const res = await fetch(`https://${GORGIAS_DOMAIN}/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${process.env.GORGIAS_BASIC_AUTH}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(process.env.GORGIAS_REFRESH_TOKEN)}`,
  });
  if (!res.ok) throw new Error(`Gorgias token ${res.status}: ${await res.text()}`);
  const j = await res.json();
  return j.access_token;
}

async function fetchTicketMessages(token, ticketId) {
  const res = await fetch(`https://${GORGIAS_DOMAIN}/api/tickets/${ticketId}/messages`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Gorgias messages ${res.status}: ${await res.text()}`);
  const j = await res.json();
  return j.data || [];
}

async function persistMessages(conn, ticketId, messages) {
  for (const m of messages) {
    await conn.execute(
      `INSERT IGNORE INTO gorgias_messages (message_id, ticket_id, from_agent, channel, body_text, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        String(m.id),
        String(ticketId),
        m.from_agent ? 1 : 0,
        m.channel || null,
        m.body_text || null,
        m.created_datetime ? new Date(m.created_datetime).toISOString().slice(0, 19).replace("T", " ") : null,
      ],
    );
  }
}

async function classifyOne(apiKey, ticket, firstBody) {
  const userMsg = [
    `Subject: ${ticket.subject || "(none)"}`,
    `Tags: ${ticket.tags || "(none)"}`,
    `Customer message:\n${(firstBody || "").slice(0, 2500)}`,
  ].join("\n");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMsg },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  let parsed = {};
  try { parsed = JSON.parse(j.choices[0].message.content); } catch {}
  const fs = Boolean(parsed.is_food_safety);
  const concern = parsed.concern && VALID_CONCERNS.has(parsed.concern) ? parsed.concern : null;
  return { fs, concern, usage: j.usage };
}

async function main() {
  const write = process.argv.includes("--write");
  for (const k of ["OPENAI_API_KEY", "GORGIAS_BASIC_AUTH", "GORGIAS_REFRESH_TOKEN", "DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME"]) {
    if (!process.env[k]) { console.error(`missing env: ${k}`); process.exit(1); }
  }

  const envBool = (n, d) => {
    const v = process.env[n];
    if (v == null || v === "") return d;
    return !["0","false","no","off"].includes(v.trim().toLowerCase());
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

  console.log("getting Gorgias OAuth token…");
  const gToken = await gorgiasToken();
  console.log("token ok.");

  let q = `SELECT ticket_id, subject, tags
           FROM gorgias_tickets
           WHERE classified_at IS NULL AND ticket_created_at >= ?
           ORDER BY ticket_created_at`;
  const params = [SINCE];
  if (MAX_TICKETS) { q += ` LIMIT ${Number(MAX_TICKETS)}`; }
  const [rows] = await conn.query(q, params);

  console.log(`scanned: ${rows.length} unclassified since ${SINCE}, model=${MODEL}, write=${write}`);

  let fsCount = 0, errors = 0, fetched = 0;
  let totalIn = 0, totalOut = 0;

  async function processOne(r) {
    // Get first customer message body (existing or fetch)
    const [msgs] = await conn.query(
      `SELECT body_text FROM gorgias_messages WHERE ticket_id=? AND from_agent=0 ORDER BY created_at LIMIT 1`,
      [r.ticket_id],
    );
    let firstBody = msgs[0]?.body_text || null;
    if (!firstBody) {
      const fetched_msgs = await fetchTicketMessages(gToken, r.ticket_id);
      if (fetched_msgs.length) {
        await persistMessages(conn, r.ticket_id, fetched_msgs);
        fetched += 1;
        const cust = fetched_msgs.find((m) => !m.from_agent);
        firstBody = cust?.body_text || null;
      }
    }

    const { fs, concern, usage } = await classifyOne(process.env.OPENAI_API_KEY, r, firstBody);
    if (usage) { totalIn += usage.prompt_tokens || 0; totalOut += usage.completion_tokens || 0; }
    if (fs) fsCount += 1;
    if (write) {
      const concerns = concern ? JSON.stringify([concern]) : null;
      await conn.execute(
        `UPDATE gorgias_tickets
         SET is_food_safety = ?, concerns = COALESCE(concerns, ?),
             message_excerpt = COALESCE(message_excerpt, ?),
             classified_by = COALESCE(classified_by, ?),
             classified_at = COALESCE(classified_at, NOW())
         WHERE ticket_id = ?`,
        [fs ? 1 : 0, concerns, firstBody ? firstBody.slice(0, 1000) : null, MODEL, r.ticket_id],
      );
    }
  }

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(batch.map(processOne));
    for (const r of results) if (r.status === "rejected") { errors += 1; console.error(" ", String(r.reason).slice(0, 160)); }
    if ((i + BATCH_SIZE) % 50 === 0 || i + BATCH_SIZE >= rows.length) {
      console.log(`  progress ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length}  fs=${fsCount} fetched=${fetched} errors=${errors} tok_in=${totalIn} tok_out=${totalOut}`);
    }
  }

  console.log(`done. food-safety=${fsCount}/${rows.length}, gorgias fetches=${fetched}, errors=${errors}, tokens in=${totalIn} out=${totalOut}`);
  await conn.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
