"use client";

import {
  ComposedChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, ReferenceLine, Legend,
} from "recharts";

interface Point {
  weekLabel: string;
  costPerOrder: number;
  rollingAvg: number | null;
}

interface Props {
  data: Point[];
  periodAvg: number;
}

function fmtLabel(label: string) {
  // "6/30 - 7/6" → "6/30"
  return label.split(" - ")[0] ?? label;
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
    <div className="bg-white border border-slate-200 rounded-lg shadow-sm px-3 py-2.5 text-xs space-y-1.5">
      <p className="font-semibold text-slate-600 mb-1">Week of {label}</p>
      {payload.map((p) => p.value != null && (
        <div key={p.name} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
          <span className="text-slate-500">{p.name}</span>
          <span className="font-bold text-slate-900 ml-auto">${p.value.toFixed(2)}</span>
        </div>
      ))}
    </div>
  );
};

export default function CostTrendLine({ data, periodAvg }: Props) {
  // Only show weeks with actual cost data (suppress zero-cost early weeks in labels)
  const firstNonZero = data.findIndex((d) => d.costPerOrder > 0);
  const visible = data.slice(firstNonZero >= 0 ? firstNonZero : 0);

  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={visible} margin={{ top: 8, right: 20, bottom: 4, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
        <XAxis
          dataKey="weekLabel"
          tickFormatter={fmtLabel}
          tick={{ fontSize: 10, fill: "#94a3b8" }}
          axisLine={false}
          tickLine={false}
          interval={Math.floor(visible.length / 8)}
        />
        <YAxis
          tick={{ fontSize: 10, fill: "#94a3b8" }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => `$${v}`}
          width={40}
          domain={[0, "auto"]}
        />
        <Tooltip content={<CustomTooltip />} />
        <Legend
          wrapperStyle={{ fontSize: 11, paddingTop: 12 }}
          iconType="circle"
          iconSize={7}
        />
        <ReferenceLine
          y={periodAvg}
          stroke="#94a3b8"
          strokeDasharray="6 3"
          strokeWidth={1}
          label={{ value: `Avg $${periodAvg.toFixed(0)}`, position: "insideTopRight", fontSize: 10, fill: "#94a3b8" }}
        />
        {/* Area fill — manual via two lines */}
        <Line
          type="monotone"
          dataKey="costPerOrder"
          stroke="#3b82f6"
          strokeWidth={2.5}
          dot={false}
          activeDot={{ r: 5, fill: "#3b82f6", strokeWidth: 0 }}
          name="Cost / order"
          connectNulls
        />
        <Line
          type="monotone"
          dataKey="rollingAvg"
          stroke="#f59e0b"
          strokeWidth={1.5}
          strokeDasharray="5 3"
          dot={false}
          name="4-wk avg"
          connectNulls
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
