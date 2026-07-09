"use client";

import { useFilterStore } from "@/lib/store";

function ToggleChip({
  label, active, onClick,
}: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`cursor-pointer px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
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
  const { includeArrivedWarm, setIncludeArrivedWarm } = useFilterStore();

  return (
    <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-6 py-2.5 flex flex-wrap items-center gap-4">
      <span className="text-xs font-medium text-slate-400 uppercase tracking-wide shrink-0">Filters</span>

      <div className="ml-auto">
        <ToggleChip
          label="Include Arrived Warm"
          active={Boolean(includeArrivedWarm)}
          onClick={() => setIncludeArrivedWarm(!includeArrivedWarm)}
        />
      </div>
    </div>
  );
}
