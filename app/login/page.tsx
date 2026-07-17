"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

function LoginForm() {
  const searchParams = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        setError("Incorrect password. Please try again.");
        setBusy(false);
        return;
      }
      const next = searchParams.get("next");
      // Only follow same-site relative paths to avoid an open redirect.
      window.location.href = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
    } catch {
      setError("Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 px-6">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3 mb-6 justify-center">
          <div className="w-10 h-10 bg-slate-900 rounded-lg flex items-center justify-center">
            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
              />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-slate-900">Elevate Foods Dashboard</h1>
        </div>

        <form
          onSubmit={submit}
          className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4"
        >
          <div>
            <p className="text-sm font-semibold text-slate-800">Restricted access</p>
            <p className="text-xs text-slate-500 mt-1">
              Enter the reporting password to view the dashboards.
            </p>
          </div>
          <div>
            <label htmlFor="dashboard-password" className="sr-only">
              Password
            </label>
            <input
              id="dashboard-password"
              type="password"
              autoFocus
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
            />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={busy || !password}
            className="w-full rounded-lg bg-slate-900 text-white text-sm font-medium py-2 hover:bg-slate-800 disabled:opacity-50 transition-colors"
          >
            {busy ? "Checking…" : "Unlock dashboard"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
