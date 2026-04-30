"use client";

import {
  AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";

interface DataPoint {
  week: string;
  arrivedWarm: number;
  delayed: number;
  lostInTransit: number;
  other: number;
}

interface Props {
  data: DataPoint[];
}

function fmtWeek(iso: string) {
  const d = new Date(iso + "T12:00:00Z");
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

const CustomTooltip = ({
  active, payload, label,
}: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
}) => {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s, p) => s + (p.value ?? 0), 0);
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-sm px-3 py-2.5 text-xs space-y-1">
      <p className="font-semibold text-slate-600">Week of {fmtWeek(label ?? "")}</p>
      <p className="text-slate-400 text-[10px]">{total} total issues</p>
      {[...payload].reverse().map((p) => (
        <div key={p.name} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
          <span className="text-slate-500">{p.name}</span>
          <span className="font-bold text-slate-900 ml-auto">{p.value}</span>
        </div>
      ))}
    </div>
  );
};

export default function StackedAreaChart({ data }: Props) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="gArrivedWarm" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.5} />
            <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.05} />
          </linearGradient>
          <linearGradient id="gDelayed" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.5} />
            <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.05} />
          </linearGradient>
          <linearGradient id="gLost" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#ef4444" stopOpacity={0.5} />
            <stop offset="95%" stopColor="#ef4444" stopOpacity={0.05} />
          </linearGradient>
          <linearGradient id="gOther" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#94a3b8" stopOpacity={0.4} />
            <stop offset="95%" stopColor="#94a3b8" stopOpacity={0.05} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
        <XAxis dataKey="week" tickFormatter={fmtWeek} tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
        <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} allowDecimals={false} width={28} />
        <Tooltip content={<CustomTooltip />} />
        <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} iconType="circle" iconSize={7} />
        <Area type="monotone" dataKey="other" stackId="1" stroke="#94a3b8" fill="url(#gOther)" name="Other" strokeWidth={0} />
        <Area type="monotone" dataKey="lostInTransit" stackId="1" stroke="#ef4444" fill="url(#gLost)" name="Lost in Transit" strokeWidth={1} />
        <Area type="monotone" dataKey="delayed" stackId="1" stroke="#8b5cf6" fill="url(#gDelayed)" name="Delayed in Transit" strokeWidth={1} />
        <Area type="monotone" dataKey="arrivedWarm" stackId="1" stroke="#f59e0b" fill="url(#gArrivedWarm)" name="Arrived Warm" strokeWidth={1} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
