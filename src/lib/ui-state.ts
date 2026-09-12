/**
 * Cross-browser persistence for small pieces of client state.
 *
 * Values live in data/ui-state.json on the server (via /api/ui-state) so every
 * browser sees the same state. localStorage is kept as a write-through cache
 * and as the fallback when the API is unreachable. The first load after this
 * shipped migrates transparently: if the server has no value yet but this
 * browser's localStorage does, the local value is adopted and pushed up.
 */

export async function loadSynced(key: string): Promise<unknown> {
  let serverOK = false;
  try {
    const r = await fetch(`/api/ui-state?key=${encodeURIComponent(key)}`, {
      cache: "no-store",
    });
    if (r.ok) {
      serverOK = true;
      const { value } = await r.json();
      if (value != null) {
        try {
          localStorage.setItem(key, JSON.stringify(value));
        } catch {
          /* ignore */
        }
        return value;
      }
    }
  } catch {
    /* server unreachable — fall back to this browser's copy */
  }

  let local: unknown = null;
  try {
    const raw = localStorage.getItem(key);
    if (raw != null && raw !== "") {
      try {
        local = JSON.parse(raw);
      } catch {
        local = raw; // legacy plain-string value
      }
    }
  } catch {
    /* ignore */
  }

  // One-time migration: seed the shared server copy from this browser.
  if (serverOK && local != null) pushSynced(key, local);
  return local;
}

export function pushSynced(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
  void fetch("/api/ui-state", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, value }),
  }).catch(() => {
    /* offline — localStorage still has the value */
  });
}
