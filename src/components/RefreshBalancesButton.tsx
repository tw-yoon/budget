"use client";

import { useState } from "react";

type Status = "idle" | "refreshing" | "error";

export function RefreshBalancesButton({ onRefreshed }: { onRefreshed?: () => void }) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");

  async function handleRefresh() {
    setStatus("refreshing");
    setError("");
    try {
      const res = await fetch("/api/plaid/refresh-balances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(`Refresh failed (HTTP ${res.status})`);
      setStatus("idle");
      onRefreshed?.();
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Refresh failed");
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={handleRefresh}
        disabled={status === "refreshing"}
        className="inline-flex items-center gap-2 rounded-md border border-black/15 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-black/[0.03] disabled:opacity-50 dark:border-white/15 dark:hover:bg-white/[0.04]"
      >
        <svg
          className={`h-3.5 w-3.5 ${status === "refreshing" ? "animate-spin" : ""}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {status === "refreshing" ? "Refreshing…" : "Refresh balances"}
      </button>
      {status === "error" && (
        <span className="text-sm text-red-600 dark:text-red-400">{error}</span>
      )}
    </div>
  );
}
