import Link from "next/link";

const pages = [
  { href: "/leadership", label: "Leadership Rollup", desc: "KPI scorecards, weekly trends, cost summary" },
  { href: "/food-safety", label: "Food Safety", desc: "Complaint log, SKU pareto, concern breakdown, cost analysis" },
  { href: "/ops", label: "Ops", desc: "Arrived-warm map, carrier heatmap, transit anomalies" },
  { href: "/cs", label: "Customer Service", desc: "Issue tags, resolution mix, ticket trend" },
];

export default function Home() {
  return (
    <div className="px-6 py-12 max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold text-gray-900 mb-1">Elevate Foods — Ops Dashboard</h1>
      <p className="text-sm text-gray-500 mb-8">
        Internal reporting for customer service and operations. Data refreshes every 15 minutes from Google Sheets.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {pages.map((p) => (
          <Link
            key={p.href}
            href={p.href}
            className="block rounded-lg border border-gray-200 bg-white p-5 hover:border-gray-400 transition-colors"
          >
            <p className="font-medium text-gray-900 mb-1">{p.label}</p>
            <p className="text-xs text-gray-500">{p.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
