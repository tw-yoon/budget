"use client";

import { useCallback, useSyncExternalStore } from "react";
import { loadSynced, pushSynced } from "@/lib/ui-state";
import { THEME_KEY, resolveTheme, themeAttribute, type Theme } from "@/lib/theme";

// One theme for the whole app, held at module scope so the switch in Settings
// reaches every reader at once — the same reason useProMode works this way.
let theme: Theme = "system";
// False until the stored value has been read. The inline script in the layout
// has usually applied the right palette long before this settles; this only
// governs what the Settings buttons show as current.
let settled = false;
// A deliberate choice must not be overwritten by a stale read landing after it.
let chosen = false;
let started = false;
const listeners = new Set<() => void>();

function emit() {
  for (const notify of [...listeners]) notify();
}

/**
 * Put the choice on <html> for globals.css to key off. Removing the attribute
 * is what "system" means — the palette falls through to prefers-color-scheme.
 */
function apply(next: Theme) {
  const attribute = themeAttribute(next);
  if (attribute) document.documentElement.dataset.theme = attribute;
  else delete document.documentElement.dataset.theme;
}

// Runs once, on the first subscriber.
function start() {
  if (started) return;
  started = true;
  void (async () => {
    const stored = await loadSynced(THEME_KEY);
    // The inline script already read this browser's copy; this read is what
    // carries a choice made in another browser over to this one.
    if (stored == null || chosen) return;
    theme = resolveTheme(stored);
    apply(theme);
  })().finally(() => {
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

const getSnapshot = () => `${theme}:${settled ? 1 : 0}`;
// No stored preference is readable on the server, and this is also the
// client's first snapshot, so hydration has nothing to reconcile. The palette
// itself is already correct by then — the inline script saw to that.
const getServerSnapshot = () => "system:0";

export function useTheme() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [current, isSettled] = snapshot.split(":");

  const choose = useCallback((next: Theme) => {
    chosen = true;
    theme = next;
    settled = true;
    apply(next);
    pushSynced(THEME_KEY, next);
    emit();
  }, []);

  return { theme: current as Theme, loading: isSettled === "0", choose };
}
