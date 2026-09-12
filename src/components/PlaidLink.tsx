"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  usePlaidLink,
  type PlaidLinkOnSuccess,
  type PlaidLinkOnExit,
} from "react-plaid-link";

type Status = "idle" | "loading" | "linking" | "error";

/**
 * Plaid Link button. Two modes:
 *  - new connection (default): create token → exchange → sync + refresh
 *  - update mode (pass `itemId`): re-authenticates an existing item in place
 *    (fixes ITEM_LOGIN_REQUIRED) and refreshes its history window. No token
 *    exchange — the access token is unchanged; we just re-sync that item.
 *
 * In sandbox use credentials user_good / pass_good.
 */
export function PlaidLink({
  onConnected,
  itemId,
  label,
  variant = "primary",
  product = "transactions",
}: {
  onConnected?: () => void;
  itemId?: string;
  label?: string;
  variant?: "primary" | "link";
  // "investments" links brokerage/retirement institutions (Robinhood, 401k, HSA)
  // via Plaid's Investments product instead of Transactions.
  product?: "transactions" | "investments";
}) {
  const [token, setToken] = useState<string | null>(null);
  const autoOpenRef = useRef(false); // one-shot: open Link once the SDK is ready
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");

  const onSuccess = useCallback<PlaidLinkOnSuccess>(
    async (publicToken, metadata) => {
      setStatus("linking");
      setMessage(itemId ? "Updating…" : "Linking accounts…");
      try {
        let body: string;
        if (itemId) {
          // Update mode: access token unchanged, just re-sync this item.
          body = JSON.stringify({ item_id: itemId });
        } else {
          const ex = await fetch("/api/plaid/exchange-token", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              public_token: publicToken,
              institution_name: metadata.institution?.name ?? null,
            }),
          });
          if (!ex.ok) throw new Error(`Exchange failed (HTTP ${ex.status})`);
          const { item_id } = await ex.json().catch(() => ({}));
          body = JSON.stringify(item_id ? { item_id } : {});
        }

        // Pull transactions, then balances + liabilities (payment due dates).
        // Investments-only institutions have no Transactions product, so
        // /transactions/sync would error — skip it and just refresh balances.
        if (product !== "investments") {
          await fetch("/api/plaid/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
          });
        }
        await fetch("/api/plaid/refresh-balances", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        });

        setStatus("idle");
        setMessage("");
        setToken(null);
        onConnected?.();
      } catch (err) {
        setStatus("error");
        setMessage(err instanceof Error ? err.message : "Linking failed");
      }
    },
    [itemId, onConnected, product]
  );

  const onExit = useCallback<PlaidLinkOnExit>((err) => {
    autoOpenRef.current = false;
    if (err) {
      setStatus("error");
      setMessage(err.display_message || err.error_message || "Connection cancelled");
    } else {
      setStatus("idle");
      setMessage("");
    }
  }, []);

  const { open, ready } = usePlaidLink({ token, onSuccess, onExit });

  useEffect(() => {
    if (autoOpenRef.current && ready && token) {
      autoOpenRef.current = false;
      open();
    }
  }, [ready, token, open]);

  async function handleConnect() {
    setStatus("loading");
    setMessage("");
    try {
      const res = await fetch("/api/plaid/create-link-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(itemId ? { item_id: itemId } : { product }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.link_token) {
        throw new Error(data.error || `Could not start Plaid (HTTP ${res.status})`);
      }
      autoOpenRef.current = true;
      setToken(data.link_token);
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Could not start Plaid");
    }
  }

  const busy = status === "loading" || status === "linking";
  const idleLabel = label ?? "+ Connect a bank";
  const busyLabel = status === "loading" ? "Starting…" : itemId ? "Updating…" : "Linking…";

  const className =
    variant === "link"
      ? "text-xs font-medium text-indigo-600 hover:underline disabled:opacity-50 dark:text-indigo-400"
      : "inline-flex items-center gap-2 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50";

  return (
    <span className="inline-flex items-center gap-2">
      <button onClick={handleConnect} disabled={busy} className={className}>
        {busy ? busyLabel : idleLabel}
      </button>
      {message && (
        <span
          className={`text-xs ${
            status === "error"
              ? "text-red-600 dark:text-red-400"
              : "text-black/55 dark:text-white/55"
          }`}
        >
          {message}
        </span>
      )}
    </span>
  );
}
