import type { FoodSafetyTicket, OpsTicket, WeeklyCostPoint, ShippingCategory, ShipmentWeek } from "./types";

// ── Resolution cost parser ───────────────────────────────────────────────────
// Parses free-text corrective action into a dollar cost.
// Reference unit costs from the Cost of Issues sheet.
const UNIT_COSTS: Record<string, number> = {
  "full reship": 65,
  "reship": 65,
  "partial reship": 30,
  "full refund": 65,
  "extra cheese": 5.5,
  "extra meat": 4,
  "extra accompaniment": 2.5,
  "information given": 0,
};

export function parseResolutionCost(action: string | null): number {
  if (!action) return 0;
  const ca = action.toLowerCase().trim();

  // Check named resolutions first
  for (const [key, cost] of Object.entries(UNIT_COSTS)) {
    if (ca === key) return cost;
  }
  if (ca.includes("full reship")) return 65;
  if (ca.includes("partial reship")) return 30;
  if (ca.includes("full refund")) return 65;
  if (ca.includes("information given")) return 0;

  // Extract dollar amount — handles "$10", "Amount $15", "Refund of $50", "$40+"
  const dollarMatch = ca.match(/\$(\d+(?:\.\d+)?)\+?/);
  const baseAmount = dollarMatch ? parseFloat(dollarMatch[1]) : 0;

  // "$40+" treated as $45 (Cost of Issues convention)
  const isFortyPlus = ca.includes("40+") || ca.includes("amount $40");
  const amount = isFortyPlus ? 45 : baseAmount;

  // Add comp item costs when present alongside a credit
  let compCost = 0;
  if (ca.includes("extra cheese") || ca.includes("cheese")) compCost += 5.5;
  if (ca.includes("extra meat") || (ca.includes("meat") && !ca.includes("cheese"))) compCost += 4;
  if (ca.includes("extra accompaniment") || ca.includes("accompaniment")) compCost += 2.5;

  // If only comp item, no explicit dollar
  if (amount === 0 && compCost > 0) return compCost;
  if (amount > 0) return amount + (dollarMatch && ca.includes("extra") ? compCost : 0);

  return 0;
}

// ── Perceived concern normaliser ─────────────────────────────────────────────
export function normaliseConcern(raw: string | null): string {
  if (!raw) return "Other";
  const s = raw.toLowerCase();
  if (s.includes("mold") || s.includes("mould")) return "Mold";
  if (s.includes("expir") || s.includes("best buy") || s.includes("best-before") || s.includes("past best")) return "Expired";
  if (s.includes("spoil")) return "Spoiled";
  if (s.includes("seal") || s.includes("vacuum") || s.includes("not sealed") || s.includes("broken seal") || s.includes("not properly sealed") || s.includes("already opened")) return "Broken Seal";
  if (s.includes("bug") || s.includes("insect")) return "Bugs/Insects";
  if (s.includes("leak")) return "Leaking";
  if (s.includes("taste") || s.includes("smell") || s.includes("off") || s.includes("awful")) return "Quality/Taste";
  if (s.includes("wrong") || s.includes("incorrect")) return "Wrong Item";
  if (s.includes("no expiration") || s.includes("unlabeled") || s.includes("missing")) return "Labelling Issue";
  return "Other";
}

// ── SKU Pareto ───────────────────────────────────────────────────────────────
export function skuPareto(
  tickets: FoodSafetyTicket[],
  topN = 10
): { sku: string; count: number }[] {
  const counts: Record<string, number> = {};
  for (const t of tickets) {
    const sku = t.skuInQuestion ?? "Unknown";
    counts[sku] = (counts[sku] ?? 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([sku, count]) => ({ sku, count }));
}

// ── Concern breakdown ────────────────────────────────────────────────────────
export function concernBreakdown(
  tickets: FoodSafetyTicket[]
): { concern: string; count: number }[] {
  const counts: Record<string, number> = {};
  for (const t of tickets) {
    const c = normaliseConcern(t.perceivedConcern);
    counts[c] = (counts[c] ?? 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([concern, count]) => ({ concern, count }));
}

// ── Cost by action type ───────────────────────────────────────────────────────
export function costByActionType(
  tickets: FoodSafetyTicket[]
): { action: string; totalCost: number; count: number }[] {
  const groups: Record<string, { totalCost: number; count: number }> = {};
  for (const t of tickets) {
    const action = normaliseAction(t.correctiveAction);
    if (!groups[action]) groups[action] = { totalCost: 0, count: 0 };
    groups[action].totalCost += t.resolutionCost;
    groups[action].count += 1;
  }
  return Object.entries(groups)
    .sort((a, b) => b[1].totalCost - a[1].totalCost)
    .map(([action, { totalCost, count }]) => ({ action, totalCost, count }));
}

function normaliseAction(action: string | null): string {
  if (!action) return "Unknown";
  const a = action.toLowerCase();
  if (a.includes("full reship") || a === "reship") return "Full Reship";
  if (a.includes("partial reship")) return "Partial Reship";
  if (a.includes("full refund")) return "Full Refund";
  if (a.includes("extra cheese") && (a.includes("$10") || a.includes("10 off"))) return "$10 + Extra Cheese";
  if (a.includes("extra meat") && (a.includes("$10") || a.includes("10 off"))) return "$10 + Extra Meat";
  if (a.includes("extra cheese")) return "Extra Cheese";
  if (a.includes("extra meat")) return "Extra Meat";
  if (a.includes("extra accompaniment")) return "Extra Accompaniment";
  if (a.includes("information given")) return "Information Given";
  // extract dollar amount pattern
  const m = a.match(/\$(\d+)/);
  if (m) {
    const amt = parseInt(m[1]);
    if (a.includes("40+")) return "$40+ Credit/Refund";
    if (amt >= 30) return `$${amt}+ Credit/Refund`;
    return `$${amt} Credit/Refund`;
  }
  return "Other";
}

// ── Weekly trend ─────────────────────────────────────────────────────────────
export function weeklyComplaintTrend(
  tickets: FoodSafetyTicket[]
): { week: string; count: number; cost: number }[] {
  const weeks: Record<string, { count: number; cost: number }> = {};
  for (const t of tickets) {
    if (!t.dateOfComplaint) continue;
    const d = new Date(t.dateOfComplaint);
    // Monday of that week
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d);
    monday.setDate(diff);
    monday.setHours(0, 0, 0, 0);
    const key = monday.toISOString().slice(0, 10);
    if (!weeks[key]) weeks[key] = { count: 0, cost: 0 };
    weeks[key].count += 1;
    weeks[key].cost += t.resolutionCost;
  }
  return Object.entries(weeks)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([week, { count, cost }]) => ({ week, count, cost }));
}

// ── Daily trend ───────────────────────────────────────────────────────────────
export function dailyComplaintTrend(
  tickets: FoodSafetyTicket[]
): { week: string; count: number; cost: number }[] {
  const days: Record<string, { count: number; cost: number }> = {};
  for (const t of tickets) {
    if (!t.dateOfComplaint) continue;
    const key = t.dateOfComplaint.toISOString().slice(0, 10);
    if (!days[key]) days[key] = { count: 0, cost: 0 };
    days[key].count += 1;
    days[key].cost += t.resolutionCost;
  }
  return Object.entries(days)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([week, { count, cost }]) => ({ week, count, cost }));
}

// ── Monthly trend ────────────────────────────────────────────────────────────
export function monthlyComplaintTrend(
  tickets: FoodSafetyTicket[]
): { week: string; count: number; cost: number }[] {
  const months: Record<string, { count: number; cost: number }> = {};
  for (const t of tickets) {
    if (!t.dateOfComplaint) continue;
    const key = t.dateOfComplaint.toISOString().slice(0, 7); // YYYY-MM
    if (!months[key]) months[key] = { count: 0, cost: 0 };
    months[key].count += 1;
    months[key].cost += t.resolutionCost;
  }
  return Object.entries(months)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([week, { count, cost }]) => ({ week, count, cost }));
}

// ── SKU trend over time ───────────────────────────────────────────────────────
export function skuTrendOverTime(
  tickets: FoodSafetyTicket[],
  period: "daily" | "weekly" | "monthly" | "quarterly"
): { sku: string; periods: { period: string; count: number }[] }[] {
  // Get period key function
  const getPeriodKey = (d: Date): string => {
    switch (period) {
      case "daily":
        return d.toISOString().slice(0, 10);
      case "weekly": {
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
        const monday = new Date(d);
        monday.setDate(diff);
        return monday.toISOString().slice(0, 10);
      }
      case "monthly":
        return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
      case "quarterly": {
        const q = Math.floor(d.getMonth() / 3) + 1;
        return `Q${q} ${d.getFullYear()}`;
      }
      default:
        return d.toISOString().slice(0, 10);
    }
  };

  // Get all unique periods
  const allPeriodsSet = new Set<string>();
  for (const t of tickets) {
    if (t.dateOfComplaint) allPeriodsSet.add(getPeriodKey(t.dateOfComplaint));
  }
  const allPeriods = Array.from(allPeriodsSet).sort();

  // Get top 15 SKUs by complaint count
  const skuCounts: Record<string, number> = {};
  for (const t of tickets) {
    const sku = t.skuInQuestion ?? "Unknown";
    skuCounts[sku] = (skuCounts[sku] ?? 0) + 1;
  }
  const topSkus = Object.entries(skuCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([sku]) => sku);

  // Build trend data for top SKUs
  const result: { sku: string; periods: { period: string; count: number }[] }[] = [];

  for (const sku of topSkus) {
    const periodCounts: Record<string, number> = {};
    for (const t of tickets) {
      if (t.skuInQuestion === sku && t.dateOfComplaint) {
        const key = getPeriodKey(t.dateOfComplaint);
        periodCounts[key] = (periodCounts[key] ?? 0) + 1;
      }
    }

    result.push({
      sku,
      periods: allPeriods.map((p) => ({
        period: p,
        count: periodCounts[p] ?? 0,
      })),
    });
  }

  return result;
}

// ── FC breakdown ──────────────────────────────────────────────────────────────
export function fcBreakdown(
  tickets: FoodSafetyTicket[]
): { fc: string; count: number; cost: number }[] {
  const groups: Record<string, { count: number; cost: number }> = {};
  for (const t of tickets) {
    const fc = t.fulfillmentCenter ?? "Unknown";
    if (!groups[fc]) groups[fc] = { count: 0, cost: 0 };
    groups[fc].count += 1;
    groups[fc].cost += t.resolutionCost;
  }
  return Object.entries(groups)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([fc, { count, cost }]) => ({ fc, count, cost }));
}

// ══════════════════════════════════════════════════════════════════════════════
// OPS / COST TRANSFORMS
// ══════════════════════════════════════════════════════════════════════════════

export const SHIPPING_CATEGORIES: ShippingCategory[] = [
  "Arrived Warm",
  "Delayed in Transit",
  "Lost in Transit",
];

export function classifyIssueType(issueType: string | null): string {
  if (!issueType) return "Other";
  const s = issueType.toLowerCase();
  if (s.includes("arrived warm")) return "Arrived Warm";
  if (s.includes("lost in transit") || s.includes("misdelivered")) return "Lost in Transit";
  if (s.includes("delayed")) return "Delayed in Transit";
  if (s.includes("missing item") || s.includes("damaged")) return "Missing Item";
  if (s.includes("sub_") || s.includes("subscription")) return "Subscription/Account";
  if (s.includes("cancel") || s.includes("billing")) return "Cancellation/Billing";
  if (s.includes("order")) return "Order Issue";
  return "Other";
}

export function matchesShippingFilter(
  issueType: string | null,
  activeCategories: ShippingCategory[]
): boolean {
  if (activeCategories.length === 0) return true;
  const cat = classifyIssueType(issueType);
  return activeCategories.includes(cat as ShippingCategory);
}

// Estimate resolution cost from the Ops sheet resolution field (no dollar amounts there,
// so we map from resolution type strings to the Cost of Issues unit cost table).
export function estimateOpsCost(resolution: string | null): number {
  if (!resolution) return 0;
  const r = resolution.toLowerCase();
  // Reship variants
  if (r === "full reship") return 65;
  if (r.includes("::reship") || r === "order::reship") return 65;
  if (r.includes("partial reship")) return 30;
  // Refunds
  if (r.includes("full refund")) return 65;
  if (r.includes("partial refund")) return 30;
  if (r.includes("refund")) return 20;
  // Credits / comps
  if (r.includes("free item")) return 5.5;
  if (r.includes("credit")) return 10;
  return 0;
}

// Cost by issue category from Ops tickets
export function opsCostByCategory(
  tickets: OpsTicket[],
  shippingFilter: ShippingCategory[] = []
): { category: string; count: number; totalCost: number; avgCost: number }[] {
  const groups: Record<string, { count: number; totalCost: number }> = {};
  for (const t of tickets) {
    if (!matchesShippingFilter(t.issueType, shippingFilter)) continue;
    const cat = classifyIssueType(t.issueType);
    if (!groups[cat]) groups[cat] = { count: 0, totalCost: 0 };
    groups[cat].count += 1;
    groups[cat].totalCost += estimateOpsCost(t.resolution);
  }
  return Object.entries(groups)
    .sort((a, b) => b[1].totalCost - a[1].totalCost)
    .map(([category, { count, totalCost }]) => ({
      category,
      count,
      totalCost,
      avgCost: count > 0 ? totalCost / count : 0,
    }));
}

// Weekly ops issue volume, split by shipping vs. non-shipping
export function weeklyOpsVolume(
  tickets: OpsTicket[],
  shippingFilter: ShippingCategory[] = []
): { week: string; arrivedWarm: number; delayed: number; lostInTransit: number; other: number; total: number }[] {
  const weeks: Record<string, { arrivedWarm: number; delayed: number; lostInTransit: number; other: number }> = {};

  for (const t of tickets) {
    if (!t.date) continue;
    if (!matchesShippingFilter(t.issueType, shippingFilter)) continue;

    const d = new Date(t.date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d);
    monday.setDate(diff);
    monday.setHours(0, 0, 0, 0);
    const key = monday.toISOString().slice(0, 10);

    if (!weeks[key]) weeks[key] = { arrivedWarm: 0, delayed: 0, lostInTransit: 0, other: 0 };
    const cat = classifyIssueType(t.issueType);
    if (cat === "Arrived Warm") weeks[key].arrivedWarm += 1;
    else if (cat === "Delayed in Transit") weeks[key].delayed += 1;
    else if (cat === "Lost in Transit") weeks[key].lostInTransit += 1;
    else weeks[key].other += 1;
  }

  return Object.entries(weeks)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([week, counts]) => ({
      week,
      ...counts,
      total: counts.arrivedWarm + counts.delayed + counts.lostInTransit + counts.other,
    }));
}

// Rolling N-week average for cost-per-order trend
export function withRollingAvg(
  points: WeeklyCostPoint[],
  n = 4
): (WeeklyCostPoint & { rollingAvg: number | null })[] {
  return points.map((p, i) => {
    const window = points.slice(Math.max(0, i - n + 1), i + 1).filter((x) => x.costPerOrder > 0);
    const rollingAvg =
      window.length >= 2
        ? window.reduce((s, x) => s + x.costPerOrder, 0) / window.length
        : null;
    return { ...p, rollingAvg };
  });
}

// KPIs for Kurt's dashboard
export function costKpis(points: WeeklyCostPoint[], tickets: OpsTicket[]) {
  const nonZero = points.filter((p) => p.costPerOrder > 0);
  const latest = nonZero[nonZero.length - 1];
  const last4 = nonZero.slice(-4);
  const avg4w = last4.length > 0
    ? last4.reduce((s, p) => s + p.costPerOrder, 0) / last4.length
    : 0;
  const periodAvg = nonZero.length > 0
    ? nonZero.reduce((s, p) => s + p.costPerOrder, 0) / nonZero.length
    : 0;
  const periodPeak = nonZero.length > 0 ? Math.max(...nonZero.map((p) => p.costPerOrder)) : 0;
  const periodLow = nonZero.length > 0 ? Math.min(...nonZero.map((p) => p.costPerOrder)) : 0;
  const totalIssues = tickets.length;
  return { latest: latest?.costPerOrder ?? 0, latestLabel: latest?.weekLabel ?? "—", avg4w, periodAvg, periodPeak, periodLow, totalIssues };
}

// ── Shipments aggregation ────────────────────────────────────────────────────
// shipments.csv has mixed shape: some weeks are aggregate rows (Total=1374),
// others are expanded per-shipment rows (Total=1 each, many duplicates).
// SUM by week works for both — single-row weeks sum to themselves; multi-row
// weeks of "1"s sum to the actual shipment count.
export function aggregateShipmentsByWeek(
  shipments: ShipmentWeek[]
): { weekStart: Date; weekEnd: Date; total: number }[] {
  const byWeek: Record<string, { weekStart: Date; weekEnd: Date; total: number }> = {};
  for (const s of shipments) {
    const key = s.weekStart.toISOString().slice(0, 10);
    if (!byWeek[key]) {
      byWeek[key] = { weekStart: s.weekStart, weekEnd: s.weekEnd, total: 0 };
    }
    byWeek[key].total += s.total;
  }
  return Object.values(byWeek).sort((a, b) => a.weekStart.getTime() - b.weekStart.getTime());
}

// ── Weekly issues + orders (paired bars) ──────────────────────────────────────
export function weeklyIssuesAndOrders(
  tickets: OpsTicket[],
  shipments: ShipmentWeek[],
  shippingFilter: ShippingCategory[] = []
): { week: string; weekLabel: string; issues: number; orders: number; ratePer1k: number }[] {
  const orders = aggregateShipmentsByWeek(shipments);
  const orderByWeek: Record<string, number> = {};
  for (const o of orders) {
    orderByWeek[o.weekStart.toISOString().slice(0, 10)] = o.total;
  }

  const issuesByWeek: Record<string, number> = {};
  for (const t of tickets) {
    if (!t.date) continue;
    if (!matchesShippingFilter(t.issueType, shippingFilter)) continue;
    const d = new Date(t.date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d);
    monday.setDate(diff);
    monday.setHours(0, 0, 0, 0);
    const key = monday.toISOString().slice(0, 10);
    issuesByWeek[key] = (issuesByWeek[key] ?? 0) + 1;
  }

  const allWeeks = new Set([...Object.keys(orderByWeek), ...Object.keys(issuesByWeek)]);
  const rows = Array.from(allWeeks)
    .sort()
    .map((week) => {
      const issues = issuesByWeek[week] ?? 0;
      const ord = orderByWeek[week] ?? 0;
      const d = new Date(week + "T12:00:00Z");
      const weekLabel = `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
      return {
        week,
        weekLabel,
        issues,
        orders: ord,
        ratePer1k: ord > 0 ? (issues / ord) * 1000 : 0,
      };
    });

  // Trim trailing partial weeks: any week with < 50% of the prior 4-week
  // median order count is treated as a mid-export cutoff and dropped.
  while (rows.length >= 5) {
    const last = rows[rows.length - 1];
    const prior = rows.slice(-5, -1).map((r) => r.orders).sort((a, b) => a - b);
    const median = (prior[1] + prior[2]) / 2;
    if (median > 0 && last.orders < 0.5 * median) {
      rows.pop();
    } else {
      break;
    }
  }
  return rows;
}

// ── Avg box cost impact ───────────────────────────────────────────────────────
// Total resolution $ ÷ total orders for the period = $ per box added by issues.
// Returns current period and prior period for delta.
export function boxCostImpact(
  tickets: OpsTicket[],
  shipments: ShipmentWeek[],
  shippingFilter: ShippingCategory[] = []
): { currentImpact: number; priorImpact: number; totalIssueCost: number; totalOrders: number } {
  const orders = aggregateShipmentsByWeek(shipments);
  if (orders.length === 0) {
    return { currentImpact: 0, priorImpact: 0, totalIssueCost: 0, totalOrders: 0 };
  }

  const totalOrders = orders.reduce((s, o) => s + o.total, 0);
  let totalIssueCost = 0;
  for (const t of tickets) {
    if (!matchesShippingFilter(t.issueType, shippingFilter)) continue;
    totalIssueCost += estimateOpsCost(t.resolution);
  }
  const currentImpact = totalOrders > 0 ? totalIssueCost / totalOrders : 0;

  // Prior period = first half, current = second half
  const mid = Math.floor(orders.length / 2);
  const cutoff = orders[mid]?.weekStart;
  if (!cutoff) return { currentImpact, priorImpact: 0, totalIssueCost, totalOrders };

  let priorOrders = 0, priorCost = 0;
  for (const o of orders.slice(0, mid)) priorOrders += o.total;
  for (const t of tickets) {
    if (!t.date || t.date >= cutoff) continue;
    if (!matchesShippingFilter(t.issueType, shippingFilter)) continue;
    priorCost += estimateOpsCost(t.resolution);
  }
  const priorImpact = priorOrders > 0 ? priorCost / priorOrders : 0;

  return { currentImpact, priorImpact, totalIssueCost, totalOrders };
}

// ── KPI summaries ─────────────────────────────────────────────────────────────
export function foodSafetyKpis(tickets: FoodSafetyTicket[]) {
  const totalComplaints = tickets.length;
  const totalCost = tickets.reduce((s, t) => s + t.resolutionCost, 0);
  const resolved = tickets.filter((t) => t.isResolved).length;
  const unresolved = totalComplaints - resolved;
  const avgCost = totalComplaints > 0 ? totalCost / totalComplaints : 0;
  const mostCommonConcern = (() => {
    const counts: Record<string, number> = {};
    for (const t of tickets) {
      const c = normaliseConcern(t.perceivedConcern);
      counts[c] = (counts[c] ?? 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";
  })();
  return { totalComplaints, totalCost, resolved, unresolved, avgCost, mostCommonConcern };
}
