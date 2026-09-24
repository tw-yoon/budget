"use client";

import { useCallback, useSyncExternalStore } from "react";
import { loadSynced, pushSynced } from "@/lib/ui-state";
import {
  PRO_MODE_KEY,
  LEGACY_ANALYTICS_MODE_KEY,
  resolveProMode,
  type ProMode,
} from "@/lib/pro-mode";

// One mode for the whole app, held at module scope rather than per component.
// Every caller used to keep its own copy, which was invisible while each of
// them was a page that remounted on navigation — but the sidebar is mounted
// once and never again, so it went on listing Pro entries after the switch in
// Settings had already turned Pro off, until a reload.
let mode: ProMode = "normal";
// False until the stored value has been read. Until then "normal" above is a
// placeholder, not a fact about the user, so a caller that renders one thing
// per mode — rather than merely hiding a control — must wait rather than
// assert the default.
let settled = false;
// A deliberate choice must not be overwritten by a stale read landing after
// it. This is the same guard the per-component version kept in a ref.
let chosen = false;
let started = false;
const listeners = new Set<() => void>();

function emit() {
  for (const notify of [...listeners]) notify();
}

// Runs once, on the first subscriber.
function start() {
  if (started) return;
  started = true;
  void (async () => {
    const stored = await loadSynced(PRO_MODE_KEY);
    if (stored != null) {
      if (!chosen) mode = resolveProMode(stored);
      return;
    }
    // One-time migration from the Analytics-only era. Read the old key, adopt
    // it, and push it forward under the new one. The old key is left alone.
    const legacy = await loadSynced(LEGACY_ANALYTICS_MODE_KEY);
    if (legacy == null) return;
    const migrated = resolveProMode(legacy);
    // Both the read above and choose()'s push are unawaited network calls
    // racing each other. If the user flips the switch while this legacy read
    // is in flight, the push must be skipped too, or this stale migrated value
    // lands in the store after — and overwrites — what they just chose.
    if (!chosen) {
      mode = migrated;
      pushSynced(PRO_MODE_KEY, migrated);
    }
  })().finally(() => {
    // Every path above has settled the question, including the early returns.
    settled = true;
    emit();
  });
}

function subscribe(notify: () => void) {
  listeners.add(notify);
  start();
  return () => {
    listeners.delete(notify);
  };
}

// A primitive, so React can compare snapshots by value and never sees a new
// object identity for an unchanged mode.
const getSnapshot = () => `${mode}:${settled ? 1 : 0}`;
// The server has no stored preference to read, and this is also the client's
// first snapshot, so the two agree and hydration has nothing to reconcile.
const getServerSnapshot = () => "normal:0";

export function useProMode() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [current, isSettled] = snapshot.split(":");

  const choose = useCallback((next: ProMode) => {
    chosen = true;
    mode = next;
    // A deliberate choice settles the question too, even mid-load — the same
    // reason `chosen` stops the in-flight read from overwriting it.
    settled = true;
    pushSynced(PRO_MODE_KEY, next);
    emit();
  }, []);

  return { mode: current as ProMode, loading: isSettled === "0", choose };
}
