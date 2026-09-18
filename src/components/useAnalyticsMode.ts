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
// pushes the choice, and also marks the in-flight mount load as superseded —
// without that, a user click before the load resolves could be silently
// overwritten by the stale value once it arrives.
export function useAnalyticsMode() {
  // Normal until the stored value arrives, which is also the default if it
  // never does.
  const [mode, setMode] = useState<AnalyticsMode>("normal");
  const superseded = useRef(false);

  useEffect(() => {
    void loadSynced(ANALYTICS_MODE_KEY).then((stored) => {
      if (!superseded.current) setMode(resolveAnalyticsMode(stored));
    });
    return () => {
      superseded.current = true;
    };
  }, []);

  const choose = useCallback((next: AnalyticsMode) => {
    superseded.current = true;
    setMode(next);
    pushSynced(ANALYTICS_MODE_KEY, next);
  }, []);

  return { mode, choose };
}
