"use client";

import { useFilterStore } from "@/lib/store";
import { PACKAGING_TYPES } from "@/lib/config";

function fmt(d: Date | null) {
  if (!d) return "";
  return d.toISOString().slice(0, 10);
}

function ToggleChip({
  label, active, onClick,
}: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
        active
          ? "bg-blue-600 text-white border-blue-600 shadow-sm"
          : "bg-white text-slate-600 border-slate-300 hover:border-slate-400"
      }`}
    >
      {label}
    </button>
  );
}

export default function FilterBar() {
  const {
    dateFrom, dateTo, packagingTypes,
    setDateFrom, setDateTo, setPackagingTypes, resetFilters,
  } = useFilterStore();

  function toggleMulti<T extends string>(current: T[], value: T, setter: (v: T[]) => void) {
    setter(current.includes(value) ? current.filter((v) => v !== value) : [...current, value]);
  }

  const hasActiveFilters = dateFrom !== null || dateTo !== null || packagingTypes.length > 0;

  return (
    <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-6 py-2.5 flex flex-wrap items-center gap-4">
      <span className="text-xs font-medium text-slate-400 uppercase tracking-wide shrink-0">Filters</span>

      <div className="flex items-center gap-2">
        <label className="text-xs text-slate-500">From</label>
        <input
          type="date"
          value={fmt(dateFrom)}
          onChange={(e) => setDateFrom(e.target.value ? new Date(e.target.value) : null)}
          className="border border-slate-300 rounded-md px-2 py-1 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
        />
        <label className="text-xs text-slate-500">To</label>
        <input
          type="date"
          value={fmt(dateTo)}
          onChange={(e) => setDateTo(e.target.value ? new Date(e.target.value) : null)}
          className="border border-slate-300 rounded-md px-2 py-1 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
        />
      </div>

      <div className="h-4 w-px bg-slate-200 hidden sm:block" />

      <div className="flex items-center gap-1.5">
        <span className="text-xs text-slate-400 mr-1">Packaging</span>
        {PACKAGING_TYPES.map((p) => (
          <ToggleChip
            key={p}
            label={p === "Cheese Paper and Vac Seal" ? "Both" : p}
            active={packagingTypes.includes(p)}
            onClick={() => toggleMulti(packagingTypes, p, setPackagingTypes)}
          />
        ))}
      </div>

      {hasActiveFilters && (
        <button
          onClick={resetFilters}
          className="ml-auto text-xs text-slate-400 hover:text-slate-600"
        >
          Reset filters
        </button>
      )}
    </div>
  );
}
