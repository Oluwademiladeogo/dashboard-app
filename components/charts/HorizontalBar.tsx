"use client";

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";

interface Props {
  data: { label: string; value: number }[];
  formatter?: (v: number) => string;
  color?: string;
}

const CustomTooltip = ({
  active, payload, label, formatter,
}: {
  active?: boolean;
  payload?: { value: number }[];
  label?: string;
  formatter?: (v: number) => string;
}) => {
  if (!active || !payload?.length) return null;
  const v = payload[0].value;
  return (
    <div className="bg-white border border-slate-200 rounded-md shadow-sm px-3 py-2 text-xs">
      <p className="font-medium text-slate-700 mb-0.5">{label}</p>
      <p className="text-slate-900 font-semibold">{formatter ? formatter(v) : v}</p>
    </div>
  );
};

export default function HorizontalBar({ data, formatter, color = "#3b82f6" }: Props) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <ResponsiveContainer width="100%" height={Math.max(180, data.length * 34)}>
      <BarChart
        layout="vertical"
        data={data}
        margin={{ top: 0, right: 48, bottom: 0, left: 8 }}
      >
        <XAxis
          type="number"
          tick={{ fontSize: 10, fill: "#94a3b8" }}
          tickFormatter={formatter}
          axisLine={false}
          tickLine={false}
          domain={[0, max * 1.1]}
        />
        <YAxis
          type="category"
          dataKey="label"
          width={155}
          tick={{ fontSize: 11, fill: "#475569" }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip content={<CustomTooltip formatter={formatter} />} cursor={{ fill: "#f1f5f9" }} />
        <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={20}>
          {data.map((_, i) => (
            <Cell key={i} fill={color} opacity={0.9 - i * 0.04} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
