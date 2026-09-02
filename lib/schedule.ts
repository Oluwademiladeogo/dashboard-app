import type { Pool } from "mysql2/promise";

// Canonical schedule statuses. Kept in sync with the Python collector's
// weighting (cs-metrics-report/cs_metrics/metrics.py days_worked_from_schedule)
// and the two DDL copies (this file + app/api/cs-schedule/route.ts historically).
export const STATUSES = new Set(["present", "absent", "leave", "sick", "half_day", "off"]);

export const SCHEDULE_DDL = `CREATE TABLE IF NOT EXISTS cs_agent_schedule (
  id INT AUTO_INCREMENT PRIMARY KEY,
  agent_email VARCHAR(255) NOT NULL,
  agent_name VARCHAR(128),
  date DATE NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'present',
  note VARCHAR(255),
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_agent_date (agent_email, date)
)`;

// Common spreadsheet words → canonical status. A bulk upload from a hand-kept
// schedule sheet won't use our internal tokens, so map the obvious synonyms.
const STATUS_ALIASES: Record<string, string> = {
  present: "present", working: "present", work: "present", wfh: "present",
  office: "present", onsite: "present", in: "present", on: "present", shift: "present",
  half_day: "half_day", "half day": "half_day", half: "half_day", halfday: "half_day",
  leave: "leave", pto: "leave", vacation: "leave", vac: "leave", holiday: "leave",
  annual: "leave", "annual leave": "leave", "paid leave": "leave",
  sick: "sick", "sick leave": "sick", medical: "sick", mc: "sick",
  absent: "absent", "no show": "absent", noshow: "absent", unplanned: "absent", awol: "absent",
  off: "off", "day off": "off", "rest day": "off", rest: "off", "week off": "off",
  rd: "off", "-": "off", "": "off",
};

export function normalizeStatus(raw: unknown): string | null {
  const s = String(raw ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!s) return null;
  if (STATUSES.has(s)) return s;
  const underscored = s.replace(/ /g, "_");
  if (STATUSES.has(underscored)) return underscored;
  return STATUS_ALIASES[s] ?? null;
}

// Accept ISO (YYYY-MM-DD) and US M/D/YYYY (what Gorgias/most sheets export).
export function normalizeDate(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return null;
}

export interface ScheduleInput {
  agent_email?: unknown;
  agent_name?: unknown;
  date?: unknown;
  status?: unknown;
  note?: unknown;
}

export interface RejectedRow {
  index: number;
  reason: string;
  value: Record<string, unknown>;
}

export interface UpsertResult {
  accepted: number;
  rejected: RejectedRow[];
}

const BATCH = 200;

/**
 * Validate and upsert schedule rows. Invalid rows are collected (with a reason)
 * rather than silently dropped, so a bulk upload can report what failed.
 * Upsert key is uq_agent_date; agent_name is preserved (COALESCE) so a nameless
 * bulk row never wipes a name already on file.
 */
export async function upsertScheduleRows(pool: Pool, rows: ScheduleInput[]): Promise<UpsertResult> {
  await pool.query(SCHEDULE_DDL);
  const rejected: RejectedRow[] = [];
  const valid: Array<[string, string | null, string, string, string | null]> = [];

  rows.forEach((raw, index) => {
    const email = String(raw.agent_email ?? "").trim().toLowerCase();
    const date = normalizeDate(raw.date);
    const status = normalizeStatus(raw.status);
    const value = raw as Record<string, unknown>;
    if (!email) {
      rejected.push({ index, reason: "missing agent email", value });
      return;
    }
    if (!date) {
      rejected.push({ index, reason: `unparseable date "${String(raw.date ?? "")}"`, value });
      return;
    }
    if (!status) {
      rejected.push({ index, reason: `unknown status "${String(raw.status ?? "")}"`, value });
      return;
    }
    valid.push([
      email,
      raw.agent_name ? String(raw.agent_name).slice(0, 128) : null,
      date,
      status,
      raw.note ? String(raw.note).slice(0, 255) : null,
    ]);
  });

  for (let i = 0; i < valid.length; i += BATCH) {
    const chunk = valid.slice(i, i + BATCH);
    const placeholders = chunk.map(() => "(?, ?, ?, ?, ?)").join(", ");
    await pool.query(
      `INSERT INTO cs_agent_schedule (agent_email, agent_name, date, status, note)
       VALUES ${placeholders}
       ON DUPLICATE KEY UPDATE agent_name=COALESCE(VALUES(agent_name), agent_name),
         status=VALUES(status), note=VALUES(note)`,
      chunk.flat(),
    );
  }

  return { accepted: valid.length, rejected };
}
