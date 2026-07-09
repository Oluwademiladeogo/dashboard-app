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
    return true;
  });
}
