"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { FilterState } from "./types";

const fourWeeksAgo = (): Date => {
  const d = new Date();
  d.setDate(d.getDate() - 28);
  d.setHours(0, 0, 0, 0);
  return d;
};

interface FilterStore extends FilterState {
  setDateFrom: (d: Date | null) => void;
  setDateTo: (d: Date | null) => void;
  setFulfillmentCenters: (fcs: string[]) => void;
  setPackagingTypes: (types: string[]) => void;
  setCarriers: (carriers: string[]) => void;
  setDestinationStates: (states: string[]) => void;
  resetFilters: () => void;
}

const defaultState: FilterState = {
  dateFrom: fourWeeksAgo(),
  dateTo: null,
  fulfillmentCenters: [],
  packagingTypes: [],
  carriers: [],
  destinationStates: [],
};

export const useFilterStore = create<FilterStore>()(
  persist(
    (set) => ({
      ...defaultState,
      setDateFrom: (d) => set({ dateFrom: d }),
      setDateTo: (d) => set({ dateTo: d }),
      setFulfillmentCenters: (fcs) => set({ fulfillmentCenters: fcs }),
      setPackagingTypes: (types) => set({ packagingTypes: types }),
      setCarriers: (carriers) => set({ carriers }),
      setDestinationStates: (states) => set({ destinationStates: states }),
      resetFilters: () => set(defaultState),
    }),
    {
      name: "dashboard-filters",
      // Dates don't survive JSON serialisation as Date objects
      storage: {
        getItem: (name) => {
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
