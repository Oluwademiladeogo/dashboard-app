"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function TopNav() {
  const pathname = usePathname();
  if (pathname?.startsWith("/login")) return null;
  return (
    <nav className="border-b border-slate-200 bg-white px-6 py-0 flex items-center h-12 gap-6">
      <Link href="/food-safety" className="flex items-center gap-2 shrink-0">
        <span className="text-xs font-bold tracking-widest text-slate-400 uppercase">Elevate Foods</span>
      </Link>
      <div className="h-4 w-px bg-slate-200" />
      {[
        { href: "/food-safety", label: "Food Safety" },
        { href: "/cost", label: "Cost of Issues" },
        { href: "/cs", label: "CS Metrics" },
        { href: "/sub-changes", label: "Sub Changes" },
      ].map((tab) => {
        const isActive = pathname === tab.href || pathname?.startsWith(tab.href + "/");
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`text-sm h-12 flex items-center border-b-2 px-1 transition-all ${
              isActive
                ? "border-indigo-600 text-indigo-600 font-semibold"
                : "border-transparent text-slate-600 hover:text-slate-900 font-medium"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
