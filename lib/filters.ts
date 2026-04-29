import type { FoodSafetyTicket, FilterState } from "./types";

export function applyFoodSafetyFilters(
  tickets: FoodSafetyTicket[],
  filters: FilterState
): FoodSafetyTicket[] {
  return tickets.filter((t) => {
    if (filters.dateFrom && t.dateOfComplaint && t.dateOfComplaint < filters.dateFrom)
      return false;
    if (filters.dateTo && t.dateOfComplaint && t.dateOfComplaint > filters.dateTo)
      return false;
    if (
      filters.packagingTypes.length > 0 &&
      !filters.packagingTypes.some((p) =>
        (t.packagingType ?? "").toLowerCase().includes(p.toLowerCase())
      )
    )
      return false;
    return true;
  });
}
