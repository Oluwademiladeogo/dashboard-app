import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

// Generated report files (xlsx/pdf/md) live where the collector cron writes
// them on the droplet; CS_REPORTS_DIR points there.
const REPORTS_DIR = process.env.CS_REPORTS_DIR ?? "/opt/cs-metrics/reports";
const ALLOWED_EXT = new Set([".xlsx", ".pdf", ".md"]);
const CONTENT_TYPES: Record<string, string> = {
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pdf": "application/pdf",
  ".md": "text/markdown; charset=utf-8",
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const file = searchParams.get("file");
  try {
    if (!file) {
      const entries = await fs.readdir(REPORTS_DIR).catch(() => [] as string[]);
      const files = [];
      for (const name of entries) {
        if (!ALLOWED_EXT.has(path.extname(name))) continue;
        const stat = await fs.stat(path.join(REPORTS_DIR, name));
        files.push({ name, size: stat.size, modified: stat.mtime.toISOString() });
      }
      files.sort((a, b) => b.modified.localeCompare(a.modified));
      return NextResponse.json({ files });
    }

    const safe = path.basename(file);
    const ext = path.extname(safe);
    if (safe !== file || !ALLOWED_EXT.has(ext)) {
      return NextResponse.json({ error: "invalid file" }, { status: 400 });
    }
    const data = await fs.readFile(path.join(REPORTS_DIR, safe));
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": CONTENT_TYPES[ext],
        "Content-Disposition": `attachment; filename="${safe}"`,
      },
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    console.error("cs-reports api error:", err);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
