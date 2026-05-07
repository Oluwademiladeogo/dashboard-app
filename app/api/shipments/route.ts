import { NextResponse } from "next/server";

const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN ?? "504ac4.myshopify.com";
const SHOPIFY_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

type ShopifyOrder = { created_at: string };

async function fetchShopifyOrdersForPeriod(createdAtMin: string): Promise<ShopifyOrder[]> {
  const orders: ShopifyOrder[] = [];
  let url: string | null =
    `https://${SHOPIFY_DOMAIN}/admin/api/2024-01/orders.json?limit=250&status=any&created_at_min=${createdAtMin}&fields=created_at`;

  while (url) {
    const res: Response = await fetch(url, {
      headers: { "X-Shopify-Access-Token": SHOPIFY_TOKEN! },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Shopify orders fetch failed: ${res.status}`);
    const data = (await res.json()) as { orders: ShopifyOrder[] };
    orders.push(...data.orders);

    // Follow Link header pagination
    const link = res.headers.get("link") ?? "";
    const next = link.match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? null;
    url = next;
  }
  return orders;
}

export async function GET() {
  try {
    if (!SHOPIFY_TOKEN) {
      return NextResponse.json({ error: "SHOPIFY_ACCESS_TOKEN not configured" }, { status: 500 });
    }

    // Fetch last 12 weeks of orders
    const since = new Date(Date.now() - 84 * 24 * 60 * 60 * 1000).toISOString();
    const orders = await fetchShopifyOrdersForPeriod(since);

    // Group by ISO week (Monday)
    const weekMap = new Map<string, number>();
    for (const o of orders) {
      const dt = new Date(o.created_at);
      const day = dt.getUTCDay(); // 0=Sun
      const daysToMon = day === 0 ? 6 : day - 1;
      const mon = new Date(dt);
      mon.setUTCDate(mon.getUTCDate() - daysToMon);
      mon.setUTCHours(0, 0, 0, 0);
      const key = mon.toISOString().slice(0, 10);
      weekMap.set(key, (weekMap.get(key) ?? 0) + 1);
    }

    const payload = Array.from(weekMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([ws, total]) => {
        const weekStart = new Date(`${ws}T00:00:00Z`);
        const weekEnd = new Date(weekStart);
        weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
        return {
          weekStart: weekStart.toISOString(),
          weekEnd: weekEnd.toISOString(),
          gripca: 0,
          rmfg: total,
          cog: 0,
          total,
        };
      });

    return NextResponse.json(payload);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
