"use client";

import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
} from "recharts";

const COLORS = ["#3b82f6", "#06b6d4", "#8b5cf6", "#f59e0b", "#10b981", "#ef4444", "#64748b", "#ec4899"];

interface Props {
  data: { name: string; value: number }[];
}

const CustomTooltip = ({
  active, payload,
}: {
  active?: boolean;
  payload?: { name: string; value: number; payload: { name: string; value: number } }[];
}) => {
  if (!active || !payload?.length) return null;
  const total = payload[0]?.payload?.value;
  return (
    <div className="bg-white border border-slate-200 rounded-md shadow-sm px-3 py-2 text-xs">
      <p className="font-medium text-slate-700">{payload[0]?.name}</p>
      <p className="text-slate-900 font-semibold">{total} complaints</p>
    </div>
  );
};

export default function DonutChart({ data }: Props) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="46%"
            innerRadius={58}
            outerRadius={85}
            dataKey="value"
            paddingAngle={2}
            strokeWidth={0}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
          <Legend
            iconType="circle"
            iconSize={7}
            wrapperStyle={{ fontSize: 11, paddingTop: 4 }}
            formatter={(value: string) => <span style={{ color: "#475569" }}>{value}</span>}
          />
        </PieChart>
      </ResponsiveContainer>
      {/* centre label */}
      <div className="absolute" style={{ top: "42%", left: "50%", transform: "translate(-50%, -50%)", textAlign: "center", pointerEvents: "none" }}>
        <p className="text-xl font-bold text-slate-900 leading-none">{total}</p>
        <p className="text-[10px] text-slate-400 mt-0.5">total</p>
      </div>
    </div>
  );
}
