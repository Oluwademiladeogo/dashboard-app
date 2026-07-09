import { NextRequest, NextResponse } from "next/server";
import pool from "../../../lib/db";

const STATUSES = new Set(["present", "absent", "leave", "sick", "half_day", "off"]);

const DDL = `CREATE TABLE IF NOT EXISTS cs_agent_schedule (
  id INT AUTO_INCREMENT PRIMARY KEY,
  agent_email VARCHAR(255) NOT NULL,
  agent_name VARCHAR(128),
  date DATE NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'present',
  note VARCHAR(255),
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_agent_date (agent_email, date)
)`;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const start = searchParams.get("start");
  const end = searchParams.get("end");
  if (!start || !end) {
    return NextResponse.json({ error: "start and end required" }, { status: 400 });
  }
  try {
    await pool.query(DDL);
    const [rows] = await pool.query(
      `SELECT agent_email, agent_name, DATE_FORMAT(date, '%Y-%m-%d') AS date, status, note
       FROM cs_agent_schedule WHERE date >= ? AND date < ? ORDER BY agent_email, date`,
      [start, end],
    );
    return NextResponse.json({ rows });
  } catch (err) {
    console.error("cs-schedule get error:", err);
    return NextResponse.json({ error: "failed to load schedule" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const rows: unknown[] = Array.isArray(body?.rows) ? body.rows : [];
    if (rows.length === 0 || rows.length > 500) {
      return NextResponse.json({ error: "rows must be a non-empty array" }, { status: 400 });
    }
    await pool.query(DDL);
    let saved = 0;
    for (const raw of rows) {
      const r = raw as Record<string, unknown>;
      const email = String(r.agent_email ?? "").trim().toLowerCase();
      const date = String(r.date ?? "").slice(0, 10);
      const status = String(r.status ?? "present").toLowerCase();
      if (!email || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !STATUSES.has(status)) continue;
      await pool.query(
        `INSERT INTO cs_agent_schedule (agent_email, agent_name, date, status, note)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE agent_name=VALUES(agent_name), status=VALUES(status), note=VALUES(note)`,
        [email, r.agent_name ? String(r.agent_name).slice(0, 128) : null, date, status,
         r.note ? String(r.note).slice(0, 255) : null],
      );
      saved += 1;
    }
    return NextResponse.json({ saved });
  } catch (err) {
    console.error("cs-schedule post error:", err);
    return NextResponse.json({ error: "failed to save schedule" }, { status: 500 });
  }
}
