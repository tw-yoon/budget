"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { loadSynced, pushSynced } from "@/lib/ui-state";
import {
  PRO_MODE_KEY,
  LEGACY_ANALYTICS_MODE_KEY,
  resolveProMode,
  type ProMode,
} from "@/lib/pro-mode";

// Shared by SettingsMode and AnalyticsDashboard: both need the current
// mode, but only Settings lets the user change it. `choose` sets state and
// pushes the choice, and also marks that a deliberate choice has been made —
// without that, a user click before the load resolves could be silently
// overwritten by the stale value once it arrives.
export function useProMode() {
  // Normal until the stored value arrives, which is also the default if it
  // never does.
  const [mode, setMode] = useState<ProMode>("normal");
  // A deliberate choice outlives the mount that was loading when it happened,
  // so it lives in a ref; "this effect run was torn down" is per-run state and
  // stays a local. Sharing one flag for both would let a cleanup suppress a
  // later run's load.
  const chosen = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await loadSynced(PRO_MODE_KEY);
      if (stored != null) {
        if (!cancelled && !chosen.current) setMode(resolveProMode(stored));
        return;
      }
      // One-time migration from the Analytics-only era. Read the old key, adopt
      // it, and push it forward under the new one. The old key is left alone.
      const legacy = await loadSynced(LEGACY_ANALYTICS_MODE_KEY);
      if (legacy == null) return;
      const migratedMode = resolveProMode(legacy);
      // Both the read above and choose()'s push are unawaited network calls
      // racing each other. If the user clicks the toggle while this legacy
      // read is still in flight, `chosen.current` is now true by the time we
      // get here: setMode is correctly skipped below, and the push must be
      // skipped too, or this stale migrated value can land in the store
      // after — and overwrite — the value the user just deliberately chose.
      if (!cancelled && !chosen.current) {
        setMode(migratedMode);
        pushSynced(PRO_MODE_KEY, migratedMode);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const choose = useCallback((next: ProMode) => {
    chosen.current = true;
    setMode(next);
    pushSynced(PRO_MODE_KEY, next);
  }, []);

  return { mode, choose };
}
