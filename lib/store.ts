"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { FilterState } from "./types";

interface FilterStore extends FilterState {
  setDateFrom: (d: Date | null) => void;
  setDateTo: (d: Date | null) => void;
  setCarriers: (carriers: string[]) => void;
  setDestinationStates: (states: string[]) => void;
  setIncludeArrivedWarm: (v: boolean) => void;
  resetFilters: () => void;
}

const defaultState = (): FilterState => ({
  dateFrom: null,
  dateTo: null,
  fulfillmentCenters: [],
  carriers: [],
  destinationStates: [],
  includeArrivedWarm: false,
});

export const useFilterStore = create<FilterStore>()(
  persist(
    (set) => ({
      ...defaultState(),
      setDateFrom: (d) => set({ dateFrom: d }),
      setDateTo: (d) => set({ dateTo: d }),
      setCarriers: (carriers) => set({ carriers }),
      setDestinationStates: (states) => set({ destinationStates: states }),
      setIncludeArrivedWarm: (v) => set({ includeArrivedWarm: v }),
      resetFilters: () => set(defaultState()),
    }),
    {
      name: "dashboard-filters-v4",
      // Dates don't survive JSON serialisation as Date objects
      storage: {
        getItem: (name) => {
          // Clear old filter keys
          if (typeof window !== 'undefined') {
            ['dashboard-filters-v2', 'dashboard-filters-v3'].forEach(k => localStorage.removeItem(k));
          }
          const raw = localStorage.getItem(name);
          if (!raw) return null;
          const parsed = JSON.parse(raw);
          const state = parsed?.state ?? {};
          if (state.dateFrom) state.dateFrom = new Date(state.dateFrom);
          if (state.dateTo) state.dateTo = new Date(state.dateTo);
          return { ...parsed, state };
        },
        setItem: (name, value) => localStorage.setItem(name, JSON.stringify(value)),
        removeItem: (name) => localStorage.removeItem(name),
      },
    }
  )
);
