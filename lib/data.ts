"use client";

import Papa from "papaparse";
import { CSV_URLS, CACHE_TTL_MS } from "./config";
import type { FoodSafetyTicket, OpsTicket, CostLookupRow, ShipmentWeek, WeeklyCostPoint } from "./types";
import { parseResolutionCost } from "./transforms";

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}
const cache: Record<string, CacheEntry<unknown>> = {};

async function fetchCsv(url: string): Promise<string[][]> {
  const cached = cache[url] as CacheEntry<string[][]> | undefined;
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.data;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  const text = await res.text();
  const result = Papa.parse<string[]>(text, { skipEmptyLines: true });
  const rows = result.data as string[][];
  cache[url] = { data: rows, fetchedAt: Date.now() };
  return rows;
}

function parseDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function str(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().replace(/^\n+|\n+$/g, "");
  return s === "" || s === "null" ? null : s;
}

function num(v: string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = parseFloat(String(v).replace(/[^0-9.-]/g, ""));
  return isNaN(n) ? null : n;
}

// Food Safety: fixed column indices, no offset detection
export async function fetchFoodSafety(): Promise<FoodSafetyTicket[]> {
  const rows = await fetchCsv(CSV_URLS.foodSafety);
  return rows.slice(1).flatMap((r) => {
    if (!str(r[2]) && !str(r[1])) return [];
    const correctiveAction = str(r[12]);
    const dateResolvedRaw = str(r[13]);
    const isResolved =
      dateResolvedRaw !== null &&
      dateResolvedRaw !== "NOT RESOLVED" &&
      parseDate(dateResolvedRaw) !== null;
    return [{
      idNumber: num(r[0]),
      shopifyOrderNumber: str(r[1]),
      dateOfComplaint: parseDate(str(r[2])),
      customerName: str(r[3]),
      skuInQuestion: str(r[4]),
      packagingType: str(r[5]),
      fulfillmentCenter: str(r[6]),
      carrierTrackingNumber: str(r[7]),
      perceivedConcern: str(r[8]),
      gorgiasLink: str(r[9]),
      ceoComments: str(r[10]),
      direction: str(r[11]),
      correctiveAction,
      dateResolved: isResolved ? parseDate(dateResolvedRaw) : null,
      resolutionCost: parseResolutionCost(correctiveAction),
      isResolved,
    }];
  });
}

// Ops Tickets
export async function fetchOpsTickets(): Promise<OpsTicket[]> {
  const rows = await fetchCsv(CSV_URLS.opsTickets);
  return rows.slice(1).flatMap((r) => {
    if (!str(r[0])) return [];
    return [{
      date: parseDate(str(r[0])),
      contactReason: str(r[1]),
      orderNumber: str(r[2]),
      gorgiasLink: str(r[3]),
      carrier: str(r[4]),
      destinationState: str(r[5]),
      fulfillmentCenter: str(r[6]),
      issueType: str(r[7]),
      resolution: str(r[8]),
      comment: str(r[9]),
    }];
  });
}

// Cost lookup table (resolution type → unit $)
export async function fetchCostLookup(): Promise<CostLookupRow[]> {
  const rows = await fetchCsv(CSV_URLS.costOfIssues);
  const results: CostLookupRow[] = [];
  for (const r of rows.slice(1)) {
    const resolution = str(r[0]);
    const cost = num(r[1]);
    if (resolution && cost !== null && cost > 0 && !resolution.match(/^\d+\//) && resolution !== "Week") {
      results.push({ resolution, unitCost: cost });
    }
  }
  return results;
}

// Weekly cost-per-order — pre-calculated section in Cost of Issues sheet.
// Year inferred from month sequence: May 2025 → Mar 2026.
export async function fetchWeeklyCostPerOrder(): Promise<WeeklyCostPoint[]> {
  const rows = await fetchCsv(CSV_URLS.costOfIssues);

  // Find the "Week | Cost per Order" header row
  const headerIdx = rows.findIndex((r) => str(r[0]) === "Week" && str(r[1]) === "Cost per Order");
  if (headerIdx === -1) return [];

  const results: WeeklyCostPoint[] = [];
  let year = 2025;
  let prevMonth = -1;

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const label = str(r[0]);
    const costRaw = num(r[1]);
    if (!label || costRaw === null) continue;
    if (label === "Summary") break;

    // Parse "M/D - M/D"
    const m = label.match(/^(\d{1,2})\/(\d{1,2})/);
    if (!m) continue;
    const month = parseInt(m[1]);
    const day = parseInt(m[2]);

    // Year flip when month resets (Dec → Jan)
    if (prevMonth > 0 && month < prevMonth && month <= 3) year = 2026;
    prevMonth = month;

    const weekStart = new Date(year, month - 1, day);
    results.push({ weekLabel: label, weekStart, costPerOrder: costRaw });
  }

  return results;
}

// Shipments (weekly volume)
export async function fetchShipments(): Promise<ShipmentWeek[]> {
  const rows = await fetchCsv(CSV_URLS.shipments);
  return rows.slice(1).flatMap((r) => {
    const weekStart = parseDate(str(r[0]));
    const weekEnd = parseDate(str(r[1]));
    if (!weekStart || !weekEnd) return [];
    return [{
      weekStart, weekEnd,
      gripca: num(r[2]) ?? 0,
      rmfg: num(r[3]) ?? 0,
      cog: num(r[4]) ?? 0,
      total: num(r[5]) ?? 0,
    }];
  });
}
