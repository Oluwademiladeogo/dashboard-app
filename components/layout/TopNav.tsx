"use client";

import Link from "next/link";

export default function TopNav() {
  return (
    <nav className="border-b border-slate-200 bg-white px-6 py-0 flex items-center h-12 gap-6">
      <Link href="/food-safety" className="flex items-center gap-2 shrink-0">
        <span className="text-xs font-bold tracking-widest text-slate-400 uppercase">Elevate Foods</span>
      </Link>
      <div className="h-4 w-px bg-slate-200" />
      <Link
        href="/food-safety"
        className="text-sm font-medium text-slate-600 hover:text-slate-900 h-12 flex items-center"
      >
        Food Safety
      </Link>
      <Link
        href="/cost"
        className="text-sm font-medium text-slate-600 hover:text-slate-900 h-12 flex items-center"
      >
        Cost of Issues
      </Link>
    </nav>
  );
}
