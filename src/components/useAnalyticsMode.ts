"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { loadSynced, pushSynced } from "@/lib/ui-state";
import {
  ANALYTICS_MODE_KEY,
  resolveAnalyticsMode,
  type AnalyticsMode,
} from "@/lib/analytics-mode";

// Shared by SettingsAnalytics and AnalyticsDashboard: both need the current
// mode, but only Settings lets the user change it. `choose` sets state and
// pushes the choice, and also marks that a deliberate choice has been made —
// without that, a user click before the load resolves could be silently
// overwritten by the stale value once it arrives.
export function useAnalyticsMode() {
  // Normal until the stored value arrives, which is also the default if it
  // never does.
  const [mode, setMode] = useState<AnalyticsMode>("normal");
  // A deliberate choice outlives the mount that was loading when it happened,
  // so it lives in a ref; "this effect run was torn down" is per-run state and
  // stays a local. Sharing one flag for both would let a cleanup suppress a
  // later run's load.
  const chosen = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void loadSynced(ANALYTICS_MODE_KEY).then((stored) => {
      if (!cancelled && !chosen.current) setMode(resolveAnalyticsMode(stored));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const choose = useCallback((next: AnalyticsMode) => {
    chosen.current = true;
    setMode(next);
    pushSynced(ANALYTICS_MODE_KEY, next);
  }, []);

  return { mode, choose };
}
