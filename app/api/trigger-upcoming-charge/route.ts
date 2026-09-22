import { NextRequest, NextResponse } from "next/server";
import fs from "fs";

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

function getEnvValue(key: string): string | null {
  if (process.env[key]) return process.env[key] as string;
  const candidates = ["/opt/n8n/.env", "/Users/demilade/Downloads/AdminApp/backend/.env"];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) {
        const text = fs.readFileSync(c, "utf8");
        for (const line of text.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("#") && trimmed.includes("=")) {
            const [k, ...v] = trimmed.split("=");
            if (k.trim() === key) {
              const val = v.join("=").trim().replace(/^["']|["']$/g, "");
              if (val) return val;
            }
          }
        }
      }
    } catch {}
  }
  return null;
}

// Derive an arrival window from the charge date matching AppyHour weekly fulfillment.
function deliveryWindow(scheduledRaw: string | null | undefined): string {
  if (!scheduledRaw) return "";
  const base = new Date(String(scheduledRaw).slice(0, 10) + "T12:00:00Z");
  if (isNaN(base.getTime())) return "";

  const dayOfWeek = base.getUTCDay(); // 5 = Friday, 4 = Thursday
  if (dayOfWeek === 5) {
    // Friday billing: delivers Tuesday to Friday of following week
    const start = new Date(base);
    start.setUTCDate(start.getUTCDate() + 4);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 3);
    const startStr = start.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    const endStr = end.toLocaleDateString("en-US", {
      month: start.getUTCMonth() === end.getUTCMonth() ? undefined : "short",
      day: "numeric",
      timeZone: "UTC",
    });
    return `${startStr}–${endStr}`;
  } else if (dayOfWeek === 4) {
    // Thursday billing: delivers Tuesday to Friday of following week
    const start = new Date(base);
    start.setUTCDate(start.getUTCDate() + 5);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 3);
    const startStr = start.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    const endStr = end.toLocaleDateString("en-US", {
      month: start.getUTCMonth() === end.getUTCMonth() ? undefined : "short",
      day: "numeric",
      timeZone: "UTC",
    });
    return `${startStr}–${endStr}`;
  } else {
    // Fallback +2 to +4 days
    const start = new Date(base);
    start.setUTCDate(start.getUTCDate() + 2);
    const end = new Date(base);
    end.setUTCDate(end.getUTCDate() + 4);
    const startStr = start.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    const endStr = end.toLocaleDateString("en-US", { day: "numeric", timeZone: "UTC" });
    return `${startStr}–${endStr}`;
  }
}

async function fetchLiveRechargeDetails(email: string): Promise<{
  customer_id: number | null;
  subscription_id: number | null;
  charge_id: number | null;
  scheduled_at: string | null;
} | null> {
  const token =
    getEnvValue("RECHARGE_API_TOKEN") ||
    getEnvValue("RECHARGE_ACCESS_TOKEN") ||
    getEnvValue("RECHARGE_API_KEY");
  if (!token) return null;

  const headers = {
    "X-Recharge-Access-Token": token,
    "X-Recharge-Version": "2021-11",
    "Content-Type": "application/json",
  };

  try {
    const custRes = await fetch(
      `https://api.rechargeapps.com/customers?email=${encodeURIComponent(email)}`,
      { headers }
    );
    if (!custRes.ok) return null;
    const custData = await custRes.json();
    const customer = (custData?.customers || [])[0];
    if (!customer?.id) return null;

    const subRes = await fetch(
      `https://api.rechargeapps.com/subscriptions?customer_id=${customer.id}&status=ACTIVE&limit=5`,
      { headers }
    );
    if (!subRes.ok) return null;
    const subData = await subRes.json();
    const subscription = (subData?.subscriptions || [])[0];
    if (!subscription?.id) return null;

    const chargeRes = await fetch(
      `https://api.rechargeapps.com/charges?customer_id=${customer.id}&status=QUEUED&sort_by=scheduled_at-asc&limit=10`,
      { headers }
    );
    if (!chargeRes.ok) return null;
    const chargeData = await chargeRes.json();
    // Recharge does not guarantee ordering, so sort by scheduled_at and take the
    // soonest queued charge — that is the "upcoming" charge the reminder is about.
    const queuedCharges = ((chargeData?.charges || []) as Array<{ id?: number; scheduled_at?: string }>)
      .filter((c) => c?.scheduled_at)
      .sort((a, b) => String(a.scheduled_at).localeCompare(String(b.scheduled_at)));
    const charge = queuedCharges[0] || null;

    const scheduledDate =
      charge?.scheduled_at?.slice(0, 10) ||
      subscription?.next_charge_scheduled_at?.slice(0, 10) ||
      null;

    return {
      customer_id: customer.id,
      subscription_id: subscription.id,
      charge_id: charge?.id ?? null,
      scheduled_at: scheduledDate,
    };
  } catch (err) {
    console.error("Failed to fetch live Recharge data:", err);
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const apiKey = getEnvValue("KLAVIYO_API_KEY");
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

    let customer_id = body.customer_id ?? null;
    let subscription_id = body.subscription_id ?? null;
    let charge_id = body.charge_id ?? null;
    let scheduledRaw = body.scheduled_at ?? body.current_charge_date ?? null;
    let resolvedLive = false;

    // If no explicit date provided or live lookup requested, fetch fresh live date from Recharge
    if (!scheduledRaw || body.use_live_recharge) {
      const live = await fetchLiveRechargeDetails(email);
      if (live?.scheduled_at) {
        scheduledRaw = live.scheduled_at;
        customer_id = live.customer_id;
        subscription_id = live.subscription_id;
        charge_id = live.charge_id;
        resolvedLive = true;
      }
    }

    if (!scheduledRaw) {
      return NextResponse.json(
        {
          success: false,
          message: `Could not find an active subscription or scheduled charge in Recharge for ${email}. No test event was sent.`,
        },
        { status: 400 }
      );
    }

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
      customer_id,
      subscription_id,
      charge_id,
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
        message: `Fired "${KLAVIYO_METRIC}" for ${email} with bill date ${scheduled_at} (${delivery_window}).`,
        properties,
        resolved_live: resolvedLive,
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
