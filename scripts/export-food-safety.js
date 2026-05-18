#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const loadRootEnv = require('./load-root-env.cjs');
const rawArgs = process.argv.slice(2);
const argv = {};
for (let i = 0; i < rawArgs.length; i++) {
  const a = rawArgs[i];
  if (a === '--include-arrived-warm' || a === '-i') argv['include-arrived-warm'] = true;
  else if (a === '--out' && rawArgs[i + 1]) { argv.out = rawArgs[i + 1]; i++; }
}

// Load .env from repo root (simple parser to avoid external deps)
const envPath = path.resolve(__dirname, '../../../.env');
if (fs.existsSync(envPath)) {
  const raw = fs.readFileSync(envPath, 'utf8');
  raw.split(/\r?\n/).forEach((line) => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) {
      let val = m[2].trim();
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      if (!(m[1] in process.env)) process.env[m[1]] = val;
    }
  });
}

const includeArrived = argv['include-arrived-warm'] || false;
const out = argv.out || 'food_safety_export.csv';

async function main() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 25060,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: false },
    waitForConnections: true,
    connectionLimit: 5,
  });

  try {
    let where = 'WHERE t.is_food_safety = 1';
    if (!includeArrived) {
      where += " AND NOT (t.tags LIKE '%Arrived Warm%' OR t.tags LIKE '%Arrived warm%' OR t.concerns LIKE '%Arrived Warm%' OR t.concerns LIKE '%Arrived warm%')";
    }

    const sql = `
      SELECT t.ticket_id, t.ticket_created_at, t.customer_name, t.customer_email, t.order_number,
             t.tags, t.status, t.concerns, t.sku_categories, t.resolution_applied,
             t.resolution_cost, t.root_cause, t.needs_review,
             GROUP_CONCAT(DISTINCT COALESCE(s.product_name, s.sku) SEPARATOR ' || ') AS skus
      FROM gorgias_tickets t
      LEFT JOIN shopify_order_skus s ON s.shopify_order_id = t.shopify_order_id
        AND s.sku NOT LIKE 'AHB-%' AND s.sku NOT LIKE 'PK-%'
      ${where}
      GROUP BY t.ticket_id
      ORDER BY t.ticket_created_at DESC
    `;

    const [rows] = await pool.query(sql);

    const header = [
      'ticket_id','ticket_created_at','customer_name','customer_email','order_number','tags','status','concerns','sku_categories','resolution_applied','resolution_cost','root_cause','needs_review','skus'
    ];

    const outPath = path.resolve(process.cwd(), out);
    const stream = fs.createWriteStream(outPath, { encoding: 'utf8' });
    stream.write(header.join(',') + '\n');

    for (const r of rows) {
      const line = [
        r.ticket_id,
        r.ticket_created_at ? new Date(r.ticket_created_at).toISOString() : '',
        quote(r.customer_name),
        quote(r.customer_email),
        quote(r.order_number),
        quote(r.tags),
        quote(r.status),
        quote(typeof r.concerns === 'string' ? r.concerns : JSON.stringify(r.concerns)),
        quote(typeof r.sku_categories === 'string' ? r.sku_categories : JSON.stringify(r.sku_categories)),
        quote(r.resolution_applied),
        r.resolution_cost ?? '',
        quote(r.root_cause),
        r.needs_review ?? '',
        quote(r.skus),
      ].join(',');
      stream.write(line + '\n');
    }

    stream.end();
    console.log(`Wrote ${rows.length} rows to ${outPath}`);
  } catch (err) {
    console.error('Error:', err);
    process.exit(2);
  } finally {
    await pool.end();
  }
}

function quote(v) {
  if (v == null) return '';
  const s = String(v).replace(/"/g, '""');
  return '"' + s + '"';
}

main();
