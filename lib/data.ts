"use client";

import type { FoodSafetyTicket, OpsTicket, CostLookupRow, ShipmentWeek, WeeklyCostPoint } from "./types";

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

type FoodSafetyApiRow = {
  idNumber?: number | null;
  shopifyOrderNumber?: string | null;
  dateOfComplaint?: string | null;
  customerName?: string | null;
  skuInQuestion?: string | null;
  packagingType?: string | null;
  fulfillmentCenter?: string | null;
  carrierTrackingNumber?: string | null;
  perceivedConcern?: string | null;
  gorgiasLink?: string | null;
  ceoComments?: string | null;
  direction?: string | null;
  correctiveAction?: string | null;
  dateResolved?: string | null;
  resolutionCost?: number;
  isResolved?: boolean;
};

type OpsApiRow = {
  date?: string | null;
  contactReason?: string | null;
  orderNumber?: string | null;
  gorgiasLink?: string | null;
  carrier?: string | null;
  destinationState?: string | null;
  fulfillmentCenter?: string | null;
  issueType?: string | null;
  resolution?: string | null;
  comment?: string | null;
};

type WeeklyCostApiRow = {
  weekLabel?: string;
  weekStart?: string | null;
  costPerOrder?: number;
};

type ShipmentApiRow = {
  weekStart?: string | null;
  weekEnd?: string | null;
  gripca?: number;
  rmfg?: number;
  cog?: number;
  total?: number;
};

export async function fetchFoodSafety(): Promise<FoodSafetyTicket[]> {
  const res = await fetch('/api/food-safety', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to fetch /api/food-safety: ${res.status}`);
  
  const json = (await res.json()) as unknown;
  if (!Array.isArray(json)) throw new Error("Invalid /api/food-safety response");
  return json.map((r: FoodSafetyApiRow) => ({
    idNumber: r.idNumber ?? null,
    shopifyOrderNumber: str(r.shopifyOrderNumber),
    dateOfComplaint: parseDate(r.dateOfComplaint),
    customerName: str(r.customerName),
    skuInQuestion: str(r.skuInQuestion),
    packagingType: str(r.packagingType),
    fulfillmentCenter: str(r.fulfillmentCenter),
    carrierTrackingNumber: str(r.carrierTrackingNumber),
    perceivedConcern: str(r.perceivedConcern),
    gorgiasLink: str(r.gorgiasLink),
    ceoComments: str(r.ceoComments),
    direction: str(r.direction),
    correctiveAction: str(r.correctiveAction),
    dateResolved: parseDate(r.dateResolved),
    resolutionCost: typeof r.resolutionCost === "number" ? r.resolutionCost : 0,
    isResolved: Boolean(r.isResolved),
  }));
}

// Ops Tickets
export async function fetchOpsTickets(): Promise<OpsTicket[]> {
  const res = await fetch('/api/ops', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to fetch /api/ops: ${res.status}`);
  const rows = (await res.json()) as unknown;
  if (!Array.isArray(rows)) throw new Error("Invalid /api/ops response");
  return rows.map((r: OpsApiRow) => ({
    date: parseDate(r.date),
    contactReason: str(r.contactReason),
    orderNumber: str(r.orderNumber),
    gorgiasLink: str(r.gorgiasLink),
    carrier: str(r.carrier),
    destinationState: str(r.destinationState),
    fulfillmentCenter: str(r.fulfillmentCenter),
    issueType: str(r.issueType),
    resolution: str(r.resolution),
    comment: str(r.comment),
  }));
}

// Cost lookup table (resolution type → unit $)
export async function fetchCostLookup(): Promise<CostLookupRow[]> {
  return [
    { resolution: "full reship", unitCost: 65 },
    { resolution: "partial reship", unitCost: 30 },
    { resolution: "full refund", unitCost: 65 },
    { resolution: "extra cheese", unitCost: 5.5 },
    { resolution: "extra meat", unitCost: 4 },
    { resolution: "extra accompaniment", unitCost: 2.5 },
    { resolution: "information given", unitCost: 0 },
  ];
}

// Weekly cost-per-order — pre-calculated section in Cost of Issues sheet.
// Year inferred from month sequence: May 2025 → Mar 2026.
export async function fetchWeeklyCostPerOrder(): Promise<WeeklyCostPoint[]> {
  const res = await fetch('/api/weekly-cost', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to fetch /api/weekly-cost: ${res.status}`);
  const rows = (await res.json()) as unknown;
  if (!Array.isArray(rows)) throw new Error("Invalid /api/weekly-cost response");
  return rows.map((r: WeeklyCostApiRow) => ({
    weekLabel: String(r.weekLabel),
    weekStart: parseDate(r.weekStart) ?? new Date(),
    costPerOrder: Number(r.costPerOrder) || 0,
  }));
}

// Shipments (weekly volume)
export async function fetchShipments(): Promise<ShipmentWeek[]> {
  const res = await fetch('/api/shipments', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to fetch /api/shipments: ${res.status}`);
  const rows = (await res.json()) as unknown;
  if (!Array.isArray(rows)) throw new Error("Invalid /api/shipments response");
  return rows
    .map((r: ShipmentApiRow) => {
      const weekStart = parseDate(r.weekStart);
      const weekEnd = parseDate(r.weekEnd);
      if (!weekStart || !weekEnd) return null;
      return {
        weekStart,
        weekEnd,
        gripca: Number(r.gripca) || 0,
        rmfg: Number(r.rmfg) || 0,
        cog: Number(r.cog) || 0,
        total: Number(r.total) || 0,
      };
    })
    .filter((row: ShipmentWeek | null): row is ShipmentWeek => row !== null);
}
