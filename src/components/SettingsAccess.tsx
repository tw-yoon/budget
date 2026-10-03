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
        <h1 className="text-2xl font-semibold tracking-tight">Remote Access</h1>
        <p className="text-sm text-black/55 dark:text-white/55">
          The server only accepts connections from this Mac and from your tailnet. Other devices need the access token.
        </p>
      </header>

      {state.kind === "loading" && <p className="text-sm text-black/55 dark:text-white/55">Loading…</p>}
      {state.kind === "error" && <p className="text-sm text-red-600 dark:text-red-400">{state.message}</p>}

      {state.kind === "local" && (
        <div className="flex flex-col gap-3 rounded-lg border border-black/10 px-4 py-3 dark:border-white/10">
          <span className="text-sm font-medium">Access token</span>
          <div className="flex flex-wrap items-center gap-2">
            <input
              readOnly
              type={shown ? "text" : "password"}
              value={state.token}
              className="min-w-0 flex-1 rounded-md border border-black/15 bg-transparent px-3 py-2 font-mono text-sm dark:border-white/15"
            />
            <button type="button" onClick={() => setShown((s) => !s)} className="rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/15">
              {shown ? "Hide" : "Show"}
            </button>
            <button type="button" onClick={() => copy(state.token)} className="rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/15">
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="text-sm text-black/55 dark:text-white/55">
            On the iPhone, paste it under Settings → Server. In another browser, open this server&apos;s address and paste it when asked.
          </p>
          <button type="button" onClick={reset} className="self-start text-sm text-red-600 hover:underline dark:text-red-400">
            Reset Token…
          </button>
          {problem && <p className="text-sm text-red-600 dark:text-red-400">{problem}</p>}
        </div>
      )}

      {state.kind === "remote" && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-black/10 px-4 py-3 dark:border-white/10">
          <span className="text-sm">Signed in on this browser.</span>
          <button type="button" onClick={signOut} className="rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/15">
            Sign Out
          </button>
        </div>
      )}
    </div>
  );
}
