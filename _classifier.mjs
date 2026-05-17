// Haiku-based ticket classifier — root-cause fix for tag-quality.
//
// For each unclassified ticket in the window:
//   1. Fetch first customer message from Gorgias (cache excerpt to message_excerpt)
//   2. Ask Haiku 4.5 to map it to canonical IRG concerns + SKU categories
//   3. Write concerns, sku_categories, is_food_safety, tag_audit to gorgias_tickets
//
// Usage:
//   node _classifier.mjs                    # backfill all unclassified
//   node _classifier.mjs --limit 50         # cap (testing)
//   node _classifier.mjs --reclassify       # redo even already-classified
import mysql from "mysql2/promise";
import fs from "fs";

const env = fs.readFileSync(".env.local", "utf8").split("\n").filter((l) => l && !l.startsWith("#"));
for (const l of env) { const [k, ...r] = l.split("="); if (k && r.length) process.env[k] = r.join("=").trim(); }

const ARGS = process.argv.slice(2);
const LIMIT = (() => { const i = ARGS.indexOf("--limit"); return i >= 0 ? Number(ARGS[i + 1]) : Infinity; })();
const RECLASSIFY = ARGS.includes("--reclassify");
const CONCURRENCY = 6;

const SINCE = "2026-04-01";

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_KEY) throw new Error("ANTHROPIC_API_KEY missing in .env.local");

// Refresh Gorgias OAuth on each run (24h expiry)
async function freshGorgiasToken() {
  const res = await fetch("https://appyhour.gorgias.com/oauth/token", {
    method: "POST",
    headers: {
      Authorization: "Basic NjllZmE5ZmZlMzFjOTkxODM3N2UzN2VlOjMxeXcwMDlzbTg4NmJ3NDVqbnVsbHJ3dHNtc24wMjhmNmRpM2x1Y3Y=",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=refresh_token&refresh_token=5OO2pv2DM84NyXaaqB6KDNLQhBPXKqQCVhGc9z1U9XjMMc7m",
  });
  if (!res.ok) throw new Error("Gorgias token refresh failed: " + res.status);
  return (await res.json()).access_token;
}
const GORGIAS_TOKEN = await freshGorgiasToken();

const pool = mysql.createPool({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
  user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, ssl: { rejectUnauthorized: false },
  connectionLimit: 8,
});

// Canonical concern + category vocabulary. Drawn from IRG categories.
// Vocabulary mirrors the IRG workbook columns. Food-safety concerns come from
// the "UPDATE_Food Safety" sheet; operational ones from "UPDATE_Operational
// Issues"; shipping from "Arrived Warm Data" / "Lost in Transit Data".
const CONCERN_VOCAB = [
  // Food safety (UPDATE_Food Safety sheet)
  "Mold", "Spoiled", "Expired", "Broken Seal", "Contamination",
  // Operational (UPDATE_Operational Issues sheet)
  "Arrived Warm", "Damaged in Transit", "Missing/Wrong Item",
  "Quality Issue", "Substitution Complaint",
  // Shipping
  "Delayed", "Lost in Transit", "Misdelivered", "Not Received", "Wrong Address",
  // Subscription / billing
  "Cancellation", "Subscription Skip", "Subscription Change",
  "Billing Dispute", "Address Change",
  // Catch-alls
  "General Inquiry", "Spam/Bot", "Other",
];
const SKU_VOCAB = ["Cheese", "Meat", "Accompaniment", "Cheese & Jam Pairing", "Crackers", "Treats", "Bundle Add-on", "Box (overall)"];
const FOOD_SAFETY_CONCERNS = new Set([
  "Mold", "Spoiled", "Expired", "Broken Seal", "Contamination",
]);
const NON_FOOD_CONTEXT = new Set([
  "Arrived Warm", "Damaged in Transit", "Missing/Wrong Item", "Quality Issue",
  "Substitution Complaint", "Delayed", "Lost in Transit", "Misdelivered",
  "Not Received", "Wrong Address", "Cancellation", "Subscription Skip",
  "Subscription Change", "Billing Dispute", "Address Change", "Other",
]);

const SYSTEM = `You classify customer-service tickets for AppyHour, an artisan cheese & charcuterie box subscription. You apply the Issue Resolution Guide taxonomy. Be conservative: only emit a concern if the customer's words clearly imply it. Tags applied by CS are unreliable hints — use the message body as ground truth.

Output STRICT JSON, no prose:
{
  "concerns": [<one or more from: ${CONCERN_VOCAB.join(", ")}>],
  "sku_categories": [<zero or more from: ${SKU_VOCAB.join(", ")}>],
  "is_food_safety": <true only if any concern is Mold | Spoiled | Expired | Broken Seal | Contamination, else false>,
  "reasoning": "<one short sentence>"
}

Rules — food-safety concerns are product-condition only:
- "mold", "mould", "moldy" → Mold.
- "spoiled", "slimy", "off smell", "foul smell", "rotten" → Spoiled.
- "expired", "past best before", "best by", "about to expire", "will expire" → Expired.
- "not sealed", "broken seal", "not properly sealed", "already opened", "vacuum compromised" → Broken Seal.
- "bugs", "insects", "foreign object", "hair in" → Contamination.

Operational / shipping concerns (NOT food safety):
- "room temperature" / "warm" / "ice melted" → Arrived Warm.
- "damaged", "broken packaging", "crushed", "leaking" (not seal) → Damaged in Transit.
- "missing", "wrong item", "not what I ordered" → Missing/Wrong Item.
- "tastes off", "weird taste", "tastes awful" → Quality Issue.
- "substituted", "swap I didn't want" → Substitution Complaint.
- "tracking shows returned" / "didn't arrive" → Not Received or Lost in Transit.

Other:
- Cancellation/skip/billing tickets → non-food concerns and is_food_safety=false.
- Spam, no-reply bot emails, recharge notifications → Spam/Bot.
- "Reship" or "Order Issue" in tags alone is NOT a concern.
- If the complaint is mainly delay, misdelivery, wrong address, or customer handling, do NOT add Spoiled unless the message clearly says the box was delivered correctly, on time, and still unsafe.
- If Mold or Spoiled applies to the same item, do not also add generic Quality Issue for that same item.
- If unclear, emit ["Other"].

Set is_food_safety=true ONLY if a concern is in {Mold, Spoiled, Expired, Broken Seal, Contamination}.`;

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function inferRootCause(concerns, excerpt) {
  const text = (excerpt || "").toLowerCase();
  if (concerns.some((c) => ["Delayed", "Arrived Warm"].includes(c)) || text.includes("melted")) return "Carrier Delay/Temperature";
  if (concerns.some((c) => ["Misdelivered", "Not Received", "Wrong Address", "Lost in Transit"].includes(c))) return "Delivery Error";
  if (concerns.includes("Damaged in Transit")) return "Transit Damage";
  if (concerns.some((c) => FOOD_SAFETY_CONCERNS.has(c))) return "Product/Packaging";
  return "Needs Review";
}

function normalizeClassification(concerns, skuCategories, excerpt) {
  const text = (excerpt || "").toLowerCase();
  let nextConcerns = unique(concerns);
  let nextSkuCategories = unique(skuCategories);

  if (nextConcerns.includes("Mold") || nextConcerns.includes("Spoiled")) {
    nextConcerns = nextConcerns.filter((c) => c !== "Quality Issue");
  }

  const hasTransitContext = nextConcerns.some((c) =>
    ["Delayed", "Misdelivered", "Not Received", "Wrong Address", "Arrived Warm"].includes(c)
  );
  if (hasTransitContext) {
    nextConcerns = nextConcerns.filter((c) => c !== "Spoiled");
  }

  if (text.includes("gel pack") || text.includes("ice pack")) {
    nextConcerns = nextConcerns.filter((c) => c !== "Contamination");
  }

  if (text.includes("customer mistake") || text.includes("wrong address") || text.includes("entered the wrong")) {
    nextConcerns = nextConcerns.filter((c) => c !== "Spoiled");
  }

  if (nextConcerns.includes("Mold") && nextSkuCategories.length > 1) {
    nextSkuCategories = nextSkuCategories.filter((c) => c === "Cheese" || c === "Meat");
  }

  const rootCause = inferRootCause(nextConcerns, excerpt);
  const needsReview =
    !nextConcerns.some((c) => FOOD_SAFETY_CONCERNS.has(c)) ||
    nextConcerns.some((c) => NON_FOOD_CONTEXT.has(c)) ||
    nextSkuCategories.length !== 1 ||
    nextSkuCategories.includes("Box (overall)") ||
    nextSkuCategories.includes("Treats");

  return {
    concerns: nextConcerns,
    sku_categories: nextSkuCategories,
    is_food_safety: nextConcerns.some((c) => FOOD_SAFETY_CONCERNS.has(c)),
    root_cause: rootCause,
    needs_review: needsReview,
  };
}

async function classifyMessage(excerpt) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 400,
      system: SYSTEM,
      messages: [{ role: "user", content: excerpt.slice(0, 4000) }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const j = await res.json();
  const text = j.content?.[0]?.text ?? "";
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("no JSON in Haiku response: " + text.slice(0, 200));
  return JSON.parse(m[0]);
}

// Strip Stamped.io review email boilerplate — header, star rating markup, product
// title/URL, and footer — leaving only the review Title + body text.
// Stamped emails follow a fixed structure: header block → star line → product link
// → Title: ... → body text → reviewer name/email → footer.
function stripStampedBoilerplate(body) {
  if (!body) return "";
  const lines = body.split(/\r?\n/);
  const out = [];
  let inReview = false;
  for (const raw of lines) {
    const line = raw.trim();
    // Start capturing at "Title:" — everything before is header/product metadata.
    if (!inReview && /^Title:/i.test(line)) { inReview = true; }
    if (!inReview) continue;
    // Stop at the reviewer byline (name + email link) or "View" action link.
    if (/^View\s+\(https?:/i.test(line)) break;
    out.push(raw);
  }
  return out.join("\n").trim();
}

// Strip auto-reply quotes, internal-note text, and signature blocks so we never
// store or send agent/bot text to Claude. Leaves the customer's actual words.
function stripQuotedReply(body) {
  if (!body) return "";
  const cutMarkers = [
    /^On\s.{0,200}wrote:\s*$/i,
    /^Le\s.{0,200}écrit\s*:?\s*$/i,
    /^On\s.+,\s.+\sat\s.+,\s.+<.+>\swrote:/i,
    /^[-_]{3,}\s*Original Message/i,
    /^From:\s/i,
    /^Sent from my\s/i,
    /^Sent from Yahoo/i,
    /^Get Outlook for /i,
    /^##-\s*Please type your reply above this line/i,
    /^>+\s/,
    /^Thanks for reaching out!?\s*Our team strives/i,    // Our own CS auto-reply
    /^This is an automatic email confirming/i,
    /^This is an automated/i,
  ];
  const out = [];
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (cutMarkers.some((re) => re.test(line))) break;
    out.push(raw);
  }
  return out.join("\n").trim();
}

async function fetchFirstCustomerMessage(ticketId) {
  const res = await fetch(`https://appyhour.gorgias.com/api/tickets/${ticketId}/messages`, {
    headers: { Authorization: `Bearer ${GORGIAS_TOKEN}` },
  });
  if (!res.ok) throw new Error(`Gorgias messages ${ticketId}: ${res.status}`);
  const j = await res.json();
  const msgs = j.data || [];
  // STRICT filter: customer-side only. Never fall back to agent messages or
  // internal notes (those are Gorgias/automation bot output).
  const customerMsgs = msgs.filter((m) =>
    m.from_agent === false &&
    m.channel !== "internal-note" &&
    !m.is_internal,
  );
  if (customerMsgs.length === 0) return "";
  const first = customerMsgs[0];
  const raw = first.body_text || first.stripped_text || "";
  // Stamped.io review emails need their header/product-title boilerplate stripped
  // first; then run the standard quoted-reply stripper on the result.
  const deStamped = first.from_address?.includes("stamped.io") || first.sender?.email?.includes("stamped.io")
    ? stripStampedBoilerplate(raw)
    : raw;
  return stripQuotedReply(deStamped).trim();
}

function diff(tagsRaw, concerns) {
  // Compare CS-applied tags vs Haiku concerns. Return audit object if disagreement.
  if (!tagsRaw) return null;
  const tagLow = tagsRaw.toLowerCase();
  const expectedFromTags = [];
  if (tagLow.includes("arrived warm") || tagLow.includes("arrivedwarm")) expectedFromTags.push("Arrived Warm");
  if (tagLow.includes("mold") || tagLow.includes("mould")) expectedFromTags.push("Mold");
  if (tagLow.includes("spoil")) expectedFromTags.push("Spoiled");
  if (tagLow.includes("expir")) expectedFromTags.push("Expired");
  if (tagLow.includes("damaged") || tagLow.includes("broken") || tagLow.includes("crushed")) expectedFromTags.push("Damaged");
  if (tagLow.includes("missing") || tagLow.includes("wrong item")) expectedFromTags.push("Missing/Wrong Item");
  if (tagLow.includes("quality") || tagLow.includes("product issue")) expectedFromTags.push("Quality Issue");

  const tagSet = new Set(expectedFromTags);
  const haikuSet = new Set(concerns.filter((c) => FOOD_SAFETY_CONCERNS.has(c)));
  const missingFromTags = [...haikuSet].filter((c) => !tagSet.has(c));
  const extraInTags = [...tagSet].filter((c) => !haikuSet.has(c));
  if (missingFromTags.length === 0 && extraInTags.length === 0) return null;
  return {
    cs_tags_missing: missingFromTags,  // CS should have applied these
    cs_tags_extra: extraInTags,        // CS applied these but Haiku disagrees
  };
}

// Recharge/Klaviyo/system bots — auto-classify without spending an API call.
const BOT_EMAIL_RE = /@(rechargeapps|sendgrid|klaviyo|passivesales|smartstreaming|expertrise)/i;
const BOT_SUBJECT_RE = /(Cancelled Subscription Item|Subscription Charge Failed|Customer .* Cancelled|Pre-charge|upcoming subscription)/i;
function tryFastPath(t) {
  const email = (t.customer_email || "").toLowerCase();
  const subj = (t.subject || "").toLowerCase();
  if (BOT_EMAIL_RE.test(email) || BOT_SUBJECT_RE.test(t.subject || "")) {
    return { concerns: ["Spam/Bot"], sku_categories: [], is_food_safety: false, reasoning: "bot/system notification (fast-path)" };
  }
  // Pure "spam" tag with no human reply
  if ((t.tags || "").toLowerCase() === "spam") {
    return { concerns: ["Spam/Bot"], sku_categories: [], is_food_safety: false, reasoning: "tagged spam (fast-path)" };
  }
  return null;
}

async function processTicket(t) {
  // Fast-path bot tickets
  const fast = tryFastPath(t);
  if (fast) {
    await pool.query(
      `UPDATE gorgias_tickets
         SET concerns = ?, sku_categories = ?, is_food_safety = 0,
             classified_by = 'fast-path', classified_at = NOW(),
             tag_audit = NULL, message_excerpt = ?, root_cause = 'Needs Review', needs_review = 1
       WHERE ticket_id = ?`,
      [JSON.stringify(fast.concerns), JSON.stringify(fast.sku_categories),
       (t.subject || "").slice(0, 500), t.ticket_id]
    );
    return;
  }

  let excerpt = "";
  try { excerpt = (await fetchFirstCustomerMessage(t.ticket_id)).slice(0, 2000); }
  catch (_) { excerpt = ""; }

  // No customer-authored content at all → system-only ticket, fast-path it
  // so we don't waste a Claude call on auto-notes / Gorgias internals.
  if (!excerpt) {
    await pool.query(
      `UPDATE gorgias_tickets
         SET concerns = ?, sku_categories = ?, is_food_safety = 0,
             classified_by = 'no-customer-content', classified_at = NOW(),
             tag_audit = NULL, message_excerpt = NULL, root_cause = 'Needs Review', needs_review = 1
       WHERE ticket_id = ?`,
      [JSON.stringify(["Spam/Bot"]), JSON.stringify([]), t.ticket_id]
    );
    return;
  }

  const cls = await classifyMessage(`Subject: ${t.subject || "(none)"}\nCS tags: ${t.tags || "(none)"}\n\nCustomer message:\n${excerpt}`);
  const concerns = Array.isArray(cls.concerns) ? cls.concerns.filter((c) => CONCERN_VOCAB.includes(c)) : [];
  const skuCats = Array.isArray(cls.sku_categories) ? cls.sku_categories.filter((c) => SKU_VOCAB.includes(c)) : [];
  const normalized = normalizeClassification(concerns, skuCats, excerpt);
  const audit = diff(t.tags, normalized.concerns);

  await pool.query(
    `UPDATE gorgias_tickets
       SET concerns = ?, sku_categories = ?, is_food_safety = ?,
           classified_by = 'haiku', classified_at = NOW(),
           tag_audit = ?, message_excerpt = ?, root_cause = ?, needs_review = ?
     WHERE ticket_id = ?`,
    [JSON.stringify(normalized.concerns), JSON.stringify(normalized.sku_categories), normalized.is_food_safety ? 1 : 0,
     audit ? JSON.stringify(audit) : null, excerpt.slice(0, 2000), normalized.root_cause, normalized.needs_review ? 1 : 0, t.ticket_id]
  );
}

async function main() {
  const where = RECLASSIFY
    ? `ticket_created_at >= '${SINCE}'`
    : `ticket_created_at >= '${SINCE}' AND classified_at IS NULL`;
  const [tickets] = await pool.query(
    `SELECT ticket_id, subject, tags, message_excerpt, customer_email FROM gorgias_tickets WHERE ${where} ORDER BY ticket_created_at DESC`
  );
  const queue = tickets.slice(0, LIMIT);
  console.log(`Classifying ${queue.length} tickets, ${CONCURRENCY} in parallel...`);

  let done = 0, errs = 0;
  const t0 = Date.now();
  async function worker() {
    while (queue.length) {
      const t = queue.shift();
      try { await processTicket(t); done++; }
      catch (e) { errs++; if (errs < 6) console.error(`  err ticket=${t.ticket_id}: ${e.message.slice(0, 200)}`); }
      if (done % 50 === 0) {
        const rate = done / ((Date.now() - t0) / 1000);
        console.log(`  ${done} done, ${errs} errs, ${rate.toFixed(1)}/s, ${queue.length} left`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  console.log(`\nFinished. ${done} classified, ${errs} errors in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const [stats] = await pool.query(
    `SELECT COUNT(*) total,
            SUM(CASE WHEN classified_at IS NOT NULL THEN 1 ELSE 0 END) classified,
            SUM(is_food_safety) food_safety,
            SUM(CASE WHEN tag_audit IS NOT NULL THEN 1 ELSE 0 END) with_audit
     FROM gorgias_tickets WHERE ticket_created_at >= '${SINCE}'`
  );
  console.log("Window stats:", stats[0]);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
