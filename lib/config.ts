// Swap these URLs to your published Google Sheet CSV links.
// Sheet > Share > Publish to web > select sheet > CSV > Copy link
export const CSV_URLS = {
  foodSafety:
    process.env.NEXT_PUBLIC_FOOD_SAFETY_URL ?? "/data/food-safety.csv",
  opsTickets:
    process.env.NEXT_PUBLIC_OPS_TICKETS_URL ?? "/data/ops-tickets.csv",
  costOfIssues:
    process.env.NEXT_PUBLIC_COST_OF_ISSUES_URL ?? "/data/cost-of-issues.csv",
  shipments:
    process.env.NEXT_PUBLIC_SHIPMENTS_URL ?? "/data/shipments.csv",
  arrivedWarm:
    process.env.NEXT_PUBLIC_ARRIVED_WARM_URL ?? "/data/arrived-warm.csv",
  shippingIssues:
    process.env.NEXT_PUBLIC_SHIPPING_ISSUES_URL ?? "/data/shipping-issues.csv",
} as const;

export const CACHE_TTL_MS = 15 * 60 * 1000;

export const FULFILLMENT_CENTERS = ["RMFG", "COG", "GRIPCA"] as const;
export const PACKAGING_TYPES = ["Vac Seal", "Cheese Paper", "Cheese Paper and Vac Seal"] as const;
