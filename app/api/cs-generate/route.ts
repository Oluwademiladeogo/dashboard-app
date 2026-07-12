import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";

// On-demand report generation. POST kicks off run_ondemand.sh on the droplet
// (detached, background) and returns a jobId; GET ?job=<id> reports its status
// from the job file the script writes. Files land in CS_REPORTS_DIR and are
// served by /api/cs-reports.
export const dynamic = "force-dynamic";

const CS_DIR = process.env.CS_METRICS_DIR ?? "/opt/cs-metrics";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 62;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const start = String(body?.start ?? "");
    const end = String(body?.end ?? ""); // exclusive
    const surveys = body?.surveys === false ? "0" : "1";

    if (!DATE_RE.test(start) || !DATE_RE.test(end)) {
      return NextResponse.json({ error: "start and end must be YYYY-MM-DD" }, { status: 400 });
    }
    const s = Date.parse(`${start}T00:00:00Z`);
    const e = Date.parse(`${end}T00:00:00Z`);
    if (!(s < e)) {
      return NextResponse.json({ error: "start must be before end" }, { status: 400 });
    }
    if ((e - s) / 86400000 > MAX_DAYS) {
      return NextResponse.json({ error: `range must be ${MAX_DAYS} days or less` }, { status: 400 });
    }

    const jobId = `${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
    const script = path.join(CS_DIR, "run_ondemand.sh");
    // args passed as an array (not a shell string); start/end are regex-validated
    const child = spawn("bash", [script, jobId, start, end, surveys], {
      cwd: CS_DIR,
      detached: true,
      stdio: "ignore",
    });
    child.unref();

    return NextResponse.json({ jobId, status: "running", start, end });
  } catch (err) {
    console.error("cs-generate post error:", err);
    return NextResponse.json({ error: "failed to start generation" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const job = req.nextUrl.searchParams.get("job") ?? "";
  if (!/^[0-9a-f-]{1,64}$/.test(job)) {
    return NextResponse.json({ error: "invalid job" }, { status: 400 });
  }
  try {
    const raw = await fs.readFile(path.join(CS_DIR, "jobs", `${job}.json`), "utf8");
    return NextResponse.json(JSON.parse(raw));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json({ status: "unknown" }, { status: 404 });
    }
    console.error("cs-generate get error:", err);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
