import type { FoodSafetyTicket } from "./types";

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
