"use client";

import {
  ComposedChart, Line, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";

interface DataPoint {
  week: string;
  count: number;
  cost: number;
}

interface Props {
  data: DataPoint[];
}

function shortWeek(iso: string) {
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
  return (
    <div className="bg-white border border-slate-200 rounded-md shadow-sm px-3 py-2 text-xs space-y-1">
      <p className="font-medium text-slate-500">Week of {shortWeek(label ?? "")}</p>
      {payload.map((p) => (
        <p key={p.name} style={{ color: p.color }} className="font-semibold">
          {p.name === "cost" ? `$${p.value.toFixed(0)}` : p.value} {p.name === "cost" ? "cost" : "complaints"}
        </p>
      ))}
    </div>
  );
};

export default function WeeklyTrend({ data }: Props) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart data={data} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
        <XAxis
          dataKey="week"
          tickFormatter={shortWeek}
          tick={{ fontSize: 10, fill: "#94a3b8" }}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis yAxisId="left" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} allowDecimals={false} width={28} />
        <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v}`} width={40} />
        <Tooltip content={<CustomTooltip />} />
        <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} iconType="circle" iconSize={7} />
        <Bar yAxisId="left" dataKey="count" fill="#bfdbfe" radius={[3, 3, 0, 0]} maxBarSize={24} name="count" />
        <Line
          yAxisId="left"
          type="monotone"
          dataKey="count"
          stroke="#3b82f6"
          strokeWidth={2}
          dot={{ r: 3, fill: "#3b82f6", strokeWidth: 0 }}
          activeDot={{ r: 5 }}
          name="complaints"
          legendType="none"
        />
        <Line
          yAxisId="right"
          type="monotone"
          dataKey="cost"
          stroke="#f59e0b"
          strokeWidth={1.5}
          strokeDasharray="4 3"
          dot={false}
          name="cost"
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
