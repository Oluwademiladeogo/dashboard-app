"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const dashboards = [
  {
    href: "/food-safety",
    label: "Food Safety",
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    color: "emerald",
    stats: ["Complaint trends", "SKU analysis", "Resolution tracking"],
  },
  {
    href: "/cost",
    label: "Cost of Issues",
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    color: "blue",
    stats: ["Cost per order", "Issue type costs", "Box cost impact"],
  },
];

const colorClasses: Record<string, { bg: string; text: string; border: string; hover: string }> = {
  emerald: {
    bg: "bg-emerald-50",
    text: "text-emerald-600",
    border: "border-emerald-200",
    hover: "hover:border-emerald-300 hover:bg-emerald-50/80",
  },
  blue: {
    bg: "bg-blue-50",
    text: "text-blue-600",
    border: "border-blue-200",
    hover: "hover:border-blue-300 hover:bg-blue-50/80",
  },
};

export default function Home() {
  const [lastUpdated, setLastUpdated] = useState<string>("");

  useEffect(() => {
    // Try to get last updated from localStorage (set by the dashboard pages)
    const stored = localStorage.getItem("dashboard-last-updated");
    if (stored) {
      setLastUpdated(stored);
    }
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Header */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-6 py-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-slate-900 rounded-lg flex items-center justify-center">
              <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-slate-900">Elevate Foods Dashboard</h1>
          </div>
          <p className="text-slate-600 max-w-xl">
            Internal reporting for customer service and operations. Track complaints, analyze costs, and monitor quality metrics.
          </p>
        </div>
      </div>

      {/* Main content */}
      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* Info card */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-8 flex items-start gap-3">
          <svg className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div className="text-sm text-blue-800">
            <p className="font-medium">Data Source</p>
            <p className="text-blue-700/80">
              Data refreshes from Google Sheets every 15 minutes. The Food Safety and Cost dashboards pull from your published CSV exports.
            </p>
          </div>
        </div>

        {/* Dashboard cards */}
        <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-4">Available Dashboards</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          {dashboards.map((d) => {
            const colors = colorClasses[d.color];
            return (
              <Link
                key={d.href}
                href={d.href}
                className={`group block rounded-xl border-2 bg-white p-6 transition-all ${colors.border} ${colors.hover}`}
              >
                <div className="flex items-start justify-between mb-4">
                  <div className={`w-12 h-12 ${colors.bg} rounded-lg flex items-center justify-center ${colors.text}`}>
                    {d.icon}
                  </div>
                  <svg className="w-5 h-5 text-slate-300 group-hover:text-slate-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-slate-900 mb-2">{d.label}</h3>
                <ul className="space-y-1">
                  {d.stats.map((stat, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm text-slate-600">
                      <span className={`w-1.5 h-1.5 rounded-full ${d.color === "emerald" ? "bg-emerald-400" : "bg-blue-400"}`} />
                      {stat}
                    </li>
                  ))}
                </ul>
              </Link>
            );
          })}
        </div>

        {/* Quick stats placeholder */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-lg border border-slate-200 p-4">
            <p className="text-xs text-slate-500 mb-1">Food Safety Tickets</p>
            <p className="text-2xl font-bold text-slate-900">169</p>
            <p className="text-xs text-slate-400 mt-1">All time</p>
          </div>
          <div className="bg-white rounded-lg border border-slate-200 p-4">
            <p className="text-xs text-slate-500 mb-1">Total Resolution Cost</p>
            <p className="text-2xl font-bold text-slate-900">~$2,400</p>
            <p className="text-xs text-slate-400 mt-1">Estimated</p>
          </div>
          <div className="bg-white rounded-lg border border-slate-200 p-4">
            <p className="text-xs text-slate-500 mb-1">Top Concern</p>
            <p className="text-2xl font-bold text-slate-900">Mold</p>
            <p className="text-xs text-slate-400 mt-1">Most frequent</p>
          </div>
          <div className="bg-white rounded-lg border border-slate-200 p-4">
            <p className="text-xs text-slate-500 mb-1">Data Updated</p>
            <p className="text-2xl font-bold text-slate-900">Live</p>
            <p className="text-xs text-slate-400 mt-1">15 min cache</p>
          </div>
        </div>
      </div>
    </div>
  );
}
