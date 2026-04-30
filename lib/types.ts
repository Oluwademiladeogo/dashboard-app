export interface FoodSafetyTicket {
  idNumber: number | null;
  shopifyOrderNumber: string | null;
  dateOfComplaint: Date | null;
  customerName: string | null;
  skuInQuestion: string | null;
  packagingType: string | null;
  fulfillmentCenter: string | null;
  carrierTrackingNumber: string | null;
  perceivedConcern: string | null;
  gorgiasLink: string | null;
  ceoComments: string | null;
  direction: string | null;
  correctiveAction: string | null;
  dateResolved: Date | null;
  resolutionCost: number;
  isResolved: boolean;
}

export interface OpsTicket {
  date: Date | null;
  contactReason: string | null;
  orderNumber: string | null;
  gorgiasLink: string | null;
  carrier: string | null;
  destinationState: string | null;
  fulfillmentCenter: string | null;
  issueType: string | null;
  resolution: string | null;
  comment: string | null;
}

export interface CostLookupRow {
  resolution: string;
  unitCost: number;
}

export interface ShipmentWeek {
  weekStart: Date;
  weekEnd: Date;
  gripca: number;
  rmfg: number;
  cog: number;
  total: number;
}

export interface WeeklyCostPoint {
  weekLabel: string;
  weekStart: Date;
  costPerOrder: number;
}

export interface FilterState {
  dateFrom: Date | null;
  dateTo: Date | null;
  fulfillmentCenters: string[];
  packagingTypes: string[];
  carriers: string[];
  destinationStates: string[];
}

export type ShippingCategory = "Arrived Warm" | "Delayed in Transit" | "Lost in Transit";
