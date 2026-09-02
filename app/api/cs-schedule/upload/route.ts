import { NextRequest, NextResponse } from "next/server";
import pool from "../../../../lib/db";
import { upsertScheduleRows, type ScheduleInput } from "../../../../lib/schedule";

// Bulk schedule upload: accept a CSV (long format, one row per agent-date) and
// upsert into cs_agent_schedule via the shared helper. Column headers adapt to
// the team's sheet through a small alias map. Parsing is done in-route (no CSV
// dependency in package.json). Invalid rows are reported, not silently dropped.

const MAX_ROWS = 20000;
const MAX_BYTES = 5 * 1024 * 1024;

// header (lower-cased, trimmed) -> canonical field
const HEADER_ALIASES: Record<string, keyof ScheduleInput> = {
  "agent_email": "agent_email", "agent email": "agent_email", "email": "agent_email",
  "e-mail": "agent_email", "mail": "agent_email", "agent e-mail": "agent_email",
  "agent_name": "agent_name", "agent name": "agent_name", "name": "agent_name",
  "tm name": "agent_name", "team member": "agent_name", "agent": "agent_name",
  "date": "date", "day": "date", "shift date": "date", "work date": "date", "schedule date": "date",
  "status": "status", "shift": "status", "schedule": "status", "attendance": "status", "type": "status",
  "note": "note", "notes": "note", "remarks": "note", "remark": "note", "comment": "note",
};

/** Minimal RFC-4180-ish CSV parser: handles quoted fields, embedded commas and
 *  newlines, and "" escapes. Returns an array of string cell arrays. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/^﻿/, ""); // strip BOM
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field); field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((v) => v.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    if (row.some((v) => v.trim() !== "")) rows.push(row);
  }
  return rows;
}

export async function POST(req: NextRequest) {
  try {
    let text: string;
    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!file || typeof file === "string") {
        return NextResponse.json({ error: "no file uploaded (field 'file')" }, { status: 400 });
      }
      if (file.size > MAX_BYTES) {
        return NextResponse.json({ error: "file too large (max 5MB)" }, { status: 400 });
      }
      text = await file.text();
    } else {
      // fallback: raw CSV body
      text = await req.text();
    }

    const table = parseCsv(text);
    if (table.length < 2) {
      return NextResponse.json({ error: "CSV has no data rows (expected a header row plus data)" }, { status: 400 });
    }

    const header = table[0].map((h) => h.trim().toLowerCase());
    const fieldFor = header.map((h) => HEADER_ALIASES[h]);
    if (!fieldFor.includes("agent_email") || !fieldFor.includes("date") || !fieldFor.includes("status")) {
      return NextResponse.json({
        error: "CSV must have columns mapping to agent email, date and status",
        recognized_columns: header.map((h, i) => ({ header: h, mapped_to: fieldFor[i] ?? null })),
      }, { status: 400 });
    }

    const dataRows = table.slice(1);
    if (dataRows.length > MAX_ROWS) {
      return NextResponse.json({ error: `too many rows (${dataRows.length}); max ${MAX_ROWS}` }, { status: 400 });
    }

    const inputs: ScheduleInput[] = dataRows.map((cells) => {
      const rec: ScheduleInput = {};
      fieldFor.forEach((field, i) => {
        if (field && rec[field] === undefined) rec[field] = cells[i];
      });
      return rec;
    });

    const result = await upsertScheduleRows(pool, inputs);
    return NextResponse.json({
      accepted: result.accepted,
      rejected: result.rejected.length,
      total: inputs.length,
      // cap the detail so a huge bad upload can't return a giant payload
      errors: result.rejected.slice(0, 50),
    });
  } catch (err) {
    console.error("cs-schedule upload error:", err);
    return NextResponse.json({ error: "failed to process upload" }, { status: 500 });
  }
}
