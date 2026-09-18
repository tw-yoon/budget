"use client";

import { useCallback, useEffect, useState } from "react";
import type { AccountsResponse } from "@/types";

// Shared by AccountsDashboard and SettingsConnections: both read the same
// endpoint, but each is its own mutable view (transfers, disconnects, card
// edits all write back through this data), so — unlike useCashflow's shared
// read-only cache — every consumer gets its own state and its own reload.
export function useAccountsData() {
  const [data, setData] = useState<AccountsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/accounts");
      if (!res.ok) throw new Error(`Failed to load (HTTP ${res.status})`);
      setData((await res.json()) as AccountsResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Intentional data-fetch effect on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload();
  }, [reload]);

  return { data, loading, error, reload };
}
