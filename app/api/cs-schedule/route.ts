import { NextRequest, NextResponse } from "next/server";
import pool from "../../../lib/db";
import { SCHEDULE_DDL as DDL, upsertScheduleRows } from "../../../lib/schedule";

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
    if (rows.length === 0 || rows.length > 10000) {
      return NextResponse.json({ error: "rows must be a non-empty array (max 10000)" }, { status: 400 });
    }
    const result = await upsertScheduleRows(pool, rows as never[]);
    return NextResponse.json({ saved: result.accepted, rejected: result.rejected.length });
  } catch (err) {
    console.error("cs-schedule post error:", err);
    return NextResponse.json({ error: "failed to save schedule" }, { status: 500 });
  }
}
