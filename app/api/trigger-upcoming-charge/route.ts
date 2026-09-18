import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const KLAVIYO_METRIC = "ENG-7 Test Upcoming Charge";
const KLAVIYO_EVENTS_URL = "https://a.klaviyo.com/api/events/";
const KLAVIYO_REVISION = "2024-10-15";

// Safety wall: only these profiles may ever be fired at from this test button.
// Overridable via TEST_SMS_ALLOWLIST (comma-separated emails).
const DEFAULT_ALLOWLIST = ["demi@elevatefoods.co", "anik08.work@gmail.com"];

function getAllowlist(): string[] {
  const raw = process.env.TEST_SMS_ALLOWLIST;
  if (!raw) return DEFAULT_ALLOWLIST;
  return raw.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
}

// Derive an arrival window from the charge date when no explicit shipping date exists.
function deliveryWindow(scheduledRaw: string | null | undefined): string {
  if (!scheduledRaw) return "";
  const base = new Date(String(scheduledRaw).slice(0, 10));
  if (isNaN(base.getTime())) return "";
  const start = new Date(base); start.setDate(start.getDate() + 2);
  const end = new Date(base); end.setDate(end.getDate() + 4);
  const startStr = start.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const endStr = end.toLocaleDateString("en-US", { day: "numeric" });
  return `${startStr}–${endStr}`;
}

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.KLAVIYO_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { success: false, message: "KLAVIYO_API_KEY is not configured on the server." },
        { status: 500 }
      );
    }

    const body = await req.json();
    const email = String(body.email || "").trim();
    if (!email) {
      return NextResponse.json({ success: false, message: "email is required" }, { status: 400 });
    }

    // Test-profile restriction — mirrors the Klaviyo flow filter so nothing leaks to real customers.
    if (!getAllowlist().includes(email.toLowerCase())) {
      return NextResponse.json(
        {
          success: false,
          message: `Blocked: ${email} is not a test profile. Only ${getAllowlist().join(", ")} can receive the test SMS.`,
        },
        { status: 403 }
      );
    }

    const scheduledRaw = body.scheduled_at ?? body.current_charge_date ?? null;
    // Send the raw date (YYYY-MM-DD) so the SMS template's format_date_string|date filter parses it.
    const scheduled_at = scheduledRaw ? String(scheduledRaw).slice(0, 10) : "";
    const delivery_window = String(body.delivery_window || "").trim() || deliveryWindow(scheduledRaw);
    const customer_portal_link =
      String(body.customer_portal_link || body.recharge_customer_url || "").trim() ||
      "https://appyhourbox.com/account";

    const properties = {
      scheduled_at,
      delivery_window,
      customer_portal_link,
      customer_id: body.customer_id ?? null,
      subscription_id: body.subscription_id ?? null,
      charge_id: body.charge_id ?? null,
      unique_id: `eng7-test-${body.ticket_id || "manual"}-${Date.now()}`,
    };

    const eventData = {
      data: {
        type: "event",
        attributes: {
          profile: { data: { type: "profile", attributes: { email } } },
          metric: { data: { type: "metric", attributes: { name: KLAVIYO_METRIC } } },
          properties,
          time: new Date().toISOString(),
        },
      },
    };

    const res = await fetch(KLAVIYO_EVENTS_URL, {
      method: "POST",
      headers: {
        Authorization: `Klaviyo-API-Key ${apiKey}`,
        "Content-Type": "application/json",
        revision: KLAVIYO_REVISION,
      },
      body: JSON.stringify(eventData),
    });

    if (res.status === 202) {
      return NextResponse.json({
        success: true,
        message: `Fired "${KLAVIYO_METRIC}" for ${email}. SMS will send if the flow is Live.`,
        properties,
      });
    }

    const detail = await res.text();
    return NextResponse.json(
      { success: false, message: `Klaviyo returned ${res.status}: ${detail.slice(0, 300)}` },
      { status: 502 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
