"use client";

import { useEffect, useState } from "react";

type State = { kind: "loading" } | { kind: "local"; token: string } | { kind: "remote" } | { kind: "error"; message: string };

export function SettingsAccess() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/access/token", { cache: "no-store" })
      .then(async (r) => {
        if (r.ok) setState({ kind: "local", token: (await r.json()).token });
        else if (r.status === 403) setState({ kind: "remote" });
        else setState({ kind: "error", message: (await r.json().catch(() => null))?.error ?? "Couldn't load." });
      })
      .catch(() => setState({ kind: "error", message: "Couldn't reach the server." }));
  }, []);

  async function copy(token: string) {
    try {
      await navigator.clipboard.writeText(token);
      setProblem(null);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setProblem("Couldn't copy — select the field and copy it.");
    }
  }

  async function reset() {
    if (!confirm("Every other device (your iPhone, other browsers) will be signed out until you give it the new token.")) return;
    setProblem(null);
    try {
      const r = await fetch("/api/access/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (r.ok) {
        setState({ kind: "local", token: (await r.json()).token });
        setShown(true);
      } else {
        setProblem((await r.json().catch(() => null))?.error ?? "Couldn't reset the token.");
      }
    } catch {
      setProblem("Couldn't reset the token.");
    }
  }

  async function signOut() {
    await fetch("/api/access/signout", { method: "POST" });
    window.location.assign("/signin");
  }

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1>Remote Access</h1>
        <p className="text-sm text-muted2">
          The server only accepts connections from this Mac and from your tailnet. Other devices need the access token.
        </p>
      </header>

      {state.kind === "loading" && <p className="text-sm text-muted2">Loading…</p>}
      {state.kind === "error" && <p className="text-sm text-neg">{state.message}</p>}

      {state.kind === "local" && (
        <div className="group-panel flex flex-col gap-3 px-4 py-3">
          <span className="text-sm font-medium">Access token</span>
          <div className="flex flex-wrap items-center gap-2">
            <input
              readOnly
              type={shown ? "text" : "password"}
              value={state.token}
              className="field min-w-0 flex-1 py-2 text-sm"
            />
            <button type="button" onClick={() => setShown((s) => !s)} className="btn">
              {shown ? "Hide" : "Show"}
            </button>
            <button type="button" onClick={() => copy(state.token)} className="btn">
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="text-sm text-muted2">
            On the iPhone, paste it under Settings → Server. In another browser, open this server&apos;s address and paste it when asked.
          </p>
          <button type="button" onClick={reset} className="btn self-start text-neg">
            Reset Token…
          </button>
          {problem && <p className="text-sm text-neg">{problem}</p>}
        </div>
      )}

      {state.kind === "remote" && (
        <div className="group-panel flex items-center justify-between gap-3 px-4 py-3">
          <span className="text-sm">Signed in on this browser.</span>
          <button type="button" onClick={signOut} className="btn">
            Sign Out
          </button>
        </div>
      )}
    </div>
  );
}
