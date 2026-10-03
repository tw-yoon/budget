"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";

// Browsers strip tab/CR/LF from URLs, so "/\t/evil.example" would become
// "//evil.example"; reject control characters outright.
const sameOrigin = (p: string | null) =>
  p &&
  p.startsWith("/") &&
  !p.startsWith("//") &&
  !p.startsWith("/\\") &&
  !/[\u0000-\u001f\u007f]/.test(p)
    ? p
    : "/";

export function SignInForm() {
  const next = sameOrigin(useSearchParams().get("next"));
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/access/signin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (r.ok) {
        window.location.assign(next);
        return;
      }
      setError((await r.json().catch(() => null))?.error ?? "Couldn't sign in.");
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 rounded-lg border border-black/10 p-6 dark:border-white/10">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Sign In</h1>
        <p className="text-sm text-black/55 dark:text-white/55">
          This Budget server needs its access token. Find it on the Mac running Budget, under
          Settings → Remote Access.
        </p>
      </header>
      <label className="flex flex-col gap-1 text-sm">
        Access token
        <input
          type="password"
          autoComplete="current-password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          className="rounded-md border border-black/15 bg-transparent px-3 py-2 font-mono dark:border-white/15"
          autoFocus
        />
      </label>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={busy || token.trim() === ""}
        className="rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background disabled:opacity-40"
      >
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
