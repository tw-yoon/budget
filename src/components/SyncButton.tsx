"use client";

import { useState } from "react";
import type { SyncResponse } from "@/types";

type Status = "idle" | "syncing" | "done" | "error";

export function SyncButton({ onSynced }: { onSynced?: () => void }) {
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");

  async function handleSync() {
    setStatus("syncing");
    setMessage("");
    try {
      const res = await fetch("/api/plaid/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}), // omit item_id => sync every linked item
      });
      if (!res.ok) throw new Error(`Sync failed (HTTP ${res.status})`);

      const data: SyncResponse = await res.json();
      const totals = data.summary.reduce(
        (acc, s) => ({
          added: acc.added + (s.added ?? 0),
          modified: acc.modified + (s.modified ?? 0),
          removed: acc.removed + (s.removed ?? 0),
        }),
        { added: 0, modified: 0, removed: 0 }
      );
      const failed = data.summary.filter((s) => !s.success);
      const skipped = data.summary.filter((s) => s.skipped).length;

      if (failed.length) {
        setStatus("error");
        setMessage(
          `${failed.length} item(s) failed: ${failed
            .map((f) => f.error ?? "unknown error")
            .join("; ")}`
        );
      } else {
        setStatus("done");
        setMessage(
          `+${totals.added} added · ${totals.modified} modified · ${totals.removed} removed` +
            (skipped ? ` · ${skipped} investment item(s) skipped` : "")
        );
      }
      onSynced?.();
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Sync failed");
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={handleSync}
        disabled={status === "syncing"}
        className="inline-flex items-center gap-2 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {status === "syncing" ? (
          <>
            <Spinner />
            Syncing…
          </>
        ) : (
          "Sync transactions"
        )}
      </button>
      {message && (
        <span
          className={`text-sm ${
            status === "error"
              ? "text-red-600 dark:text-red-400"
              : "text-black/60 dark:text-white/60"
          }`}
        >
          {message}
        </span>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <svg
      className="h-4 w-4 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}
