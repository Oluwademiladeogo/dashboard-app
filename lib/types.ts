export interface FoodSafetyTicket {
  idNumber: number | null;
  shopifyOrderNumber: string | null;
  dateOfComplaint: Date | null;
  orderFulfilledAt: Date | null;
  customerName: string | null;
  skuInQuestion: string | null;
  reportedItemName: string | null;
  skuItems: string[];
  skuCodes: string[];
  skuCategories: string[];
  fulfillmentCenter: string | null;
  carrierTrackingNumber: string | null;
  perceivedConcern: string | null;
  concerns: string[];
  gorgiasLink: string | null;
  ceoComments: string | null;
  direction: string | null;
  correctiveAction: string | null;
  resolutionApplied: string | null;
  resolutionSource: "db" | "derived" | "gorgias_custom_field" | null;
  resolutionComponents: string[];
  dateResolved: Date | null;
  resolutionCost: number;
  hasAppliedResolution: boolean;
  isResolved: boolean;
  rootCause: string | null;
  messageExcerpt: string | null;
  firstAgentResponse: string | null;
  firstAgentName: string | null;
  firstAgentResponseAt: Date | null;
  photoUrls: {
    url: string;
    name: string | null;
    contentType: string | null;
  }[];
  resolutionReference: string | null;
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
  carriers: string[];
  destinationStates: string[];
  includeArrivedWarm?: boolean;
}

export type ShippingCategory = "Arrived Warm" | "Delayed in Transit" | "Lost in Transit";
