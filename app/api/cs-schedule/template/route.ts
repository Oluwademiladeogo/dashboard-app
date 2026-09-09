import { NextResponse } from "next/server";

// Downloadable CSV template for the weekly CS schedule. Matches the headers the
// upload endpoint (and the Google-Sheet sync) expect; the team fills one row per
// agent per day. status is one of: present, half_day, leave, sick, absent, off.
const TEMPLATE = [
  "agent_email,agent_name,date,status,note",
  "agent@example.com,Agent Example,2026-01-05,present,",
  "agent@example.com,Agent Example,2026-01-06,half_day,leaves at noon",
  "agent@example.com,Agent Example,2026-01-07,leave,PTO",
].join("\r\n") + "\r\n";

export async function GET() {
  return new NextResponse(TEMPLATE, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="cs-schedule-template.csv"',
      "Cache-Control": "no-store",
    },
  });
}
