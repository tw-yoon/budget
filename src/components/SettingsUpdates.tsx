"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { pollOutcome } from "@/lib/update-poll";
import type { PhoneUpdateStatusDTO, UpdateStatusDTO } from "@/types";

const POLL_MS = 3000;
const GIVE_UP_MS = 10 * 60 * 1000;

async function fetchStatus(check = false): Promise<UpdateStatusDTO | null> {
  try {
    const res = await fetch(`/api/update${check ? "?check=1" : ""}`, { cache: "no-store" });
    return res.ok ? ((await res.json()) as UpdateStatusDTO) : null;
  } catch {
    return null; // expected while the server is stopped for the update
  }
}

type Phase = "idle" | "checking" | "starting" | "updating" | "stillNotBack";

const buttonClass =
  "self-start rounded-lg border border-black/10 px-4 py-2 text-sm font-medium transition-colors hover:border-black/30 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:hover:border-white/30";
const mutedClass = "text-sm text-black/55 dark:text-white/55";

export function SettingsUpdates() {
  const [status, setStatus] = useState<UpdateStatusDTO | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmounted = useRef(false);

  // Waits for a running update to end: polls GET, ignoring failed requests
  // while the server is down, and reloads once it is back.
  const follow = useCallback(() => {
    setPhase("updating");
    const startedAt = Date.now();
    const poll = async () => {
      const s = await fetchStatus();
      if (unmounted.current) return;
      const outcome = pollOutcome(s);
      if (outcome === "done") return window.location.reload();
      if (outcome === "failed" && s) {
        setStatus(s);
        setPhase("idle");
        return;
      }
      if (Date.now() - startedAt > GIVE_UP_MS) return setPhase("stillNotBack");
      timer.current = setTimeout(poll, POLL_MS);
    };
    timer.current = setTimeout(poll, POLL_MS);
  }, []);

  useEffect(() => {
    unmounted.current = false;
    fetchStatus().then((s) => {
      if (unmounted.current) return;
      if (!s) return setLoadFailed(true);
      setStatus(s);
      // Opened while an update runs (from the phone, or another tab).
      if (s.updating) follow();
    });
    return () => {
      unmounted.current = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [follow]);

  const checkNow = useCallback(async () => {
    setPhase("checking");
    const s = await fetchStatus(true);
    if (unmounted.current) return;
    if (s) setStatus(s);
    setPhase("idle");
  }, []);

  const install = useCallback(async () => {
    if (!status) return;
    if (!window.confirm("Budget will stop for about a minute while it updates.")) return;
    setError(null);
    // "starting" disables the button so a double click can't send two POSTs.
    setPhase("starting");
    let res: Response;
    try {
      res = await fetch("/api/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
    } catch {
      setError("Couldn't start the update.");
      setPhase("idle");
      return;
    }
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error ?? "Couldn't start the update.");
      setPhase("idle");
      return;
    }
    follow();
  }, [status, follow]);

  const installButton = (
    <button
      type="button"
      onClick={install}
      disabled={phase !== "idle"}
      className={buttonClass}
    >
      Install
    </button>
  );

  let body: React.ReactNode;
  if (!status) {
    body = <p className={mutedClass}>{loadFailed ? "Couldn't check for updates." : "Checking…"}</p>;
  } else if (phase === "updating") {
    body = <p className={mutedClass}>Updating… Budget will be back in about a minute.</p>;
  } else if (phase === "stillNotBack") {
    body = <p className={mutedClass}>Still not back. Check the Mac.</p>;
  } else if (!status.canUpdate) {
    body = (
      <>
        <p className="text-sm">Budget v{status.version}.</p>
        <p className={mutedClass}>This copy is updated from its repository, not from here.</p>
      </>
    );
  } else {
    body = (
      <>
        {status.failed && (
          <div className="flex flex-col gap-2">
            <p className="text-sm">The last update didn&apos;t finish:</p>
            <pre className="whitespace-pre-wrap break-words rounded-lg border border-black/10 px-3 py-2 text-xs dark:border-white/10">
              {status.failed}
            </pre>
            <p className={mutedClass}>Run ./Budget.command --update in Terminal to see why.</p>
          </div>
        )}
        {status.available ? (
          <>
            <p className="text-sm">
              v{status.latest} is available (you have v{status.version}).
            </p>
            {installButton}
          </>
        ) : (
          <>
            {!status.failed && <p className="text-sm">Budget v{status.version} is up to date.</p>}
            <button
              type="button"
              onClick={checkNow}
              disabled={phase !== "idle"}
              className={buttonClass}
            >
              {phase === "checking" ? "Checking…" : "Check Now"}
            </button>
          </>
        )}
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Updates</h1>
        <p className={mutedClass}>Keep Budget current.</p>
      </header>
      <div className="flex flex-col gap-3">{body}</div>
      <PhoneUpdate />
    </div>
  );
}

async function fetchPhone(): Promise<PhoneUpdateStatusDTO | null> {
  try {
    const res = await fetch("/api/update/phone", { cache: "no-store" });
    return res.ok ? ((await res.json()) as PhoneUpdateStatusDTO) : null;
  } catch {
    return null;
  }
}

// Update iPhone: the Mac rebuilds the iPhone app and installs it on the
// paired phone (ios/scripts/phone.sh install). Hidden unless it's set up here.
function PhoneUpdate() {
  const [status, setStatus] = useState<PhoneUpdateStatusDTO | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const unmounted = useRef(false);

  // Polls until the install ends (the server may restart meanwhile).
  const follow = useCallback(() => {
    const poll = async () => {
      const s = await fetchPhone();
      if (unmounted.current) return;
      if (s) setStatus(s);
      if (!s || s.installing) timer.current = setTimeout(poll, POLL_MS);
    };
    timer.current = setTimeout(poll, POLL_MS);
  }, []);

  useEffect(() => {
    unmounted.current = false;
    fetchPhone().then((s) => {
      if (unmounted.current || !s) return;
      setStatus(s);
      if (s.installing) follow();
    });
    return () => {
      unmounted.current = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [follow]);

  const start = useCallback(async () => {
    setError(null);
    setStarting(true);
    try {
      const res = await fetch("/api/update/phone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? "Couldn't start the iPhone update.");
        return;
      }
      setStatus((s) => (s ? { ...s, installing: true, failed: null } : s));
      follow();
    } catch {
      setError("Couldn't start the iPhone update.");
    } finally {
      setStarting(false);
    }
  }, [follow]);

  if (!status?.available) return null;
  const last = status.lastInstalled
    ? new Date(status.lastInstalled).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold tracking-tight">iPhone</h2>
      {status.installing ? (
        <p className={mutedClass}>Updating the iPhone… Keep it unlocked and on the Mac&apos;s Wi-Fi.</p>
      ) : (
        <>
          {status.failed ? (
            <p className="text-sm">{status.failed}</p>
          ) : (
            last && <p className={mutedClass}>Last installed {last}.</p>
          )}
          <button type="button" onClick={start} disabled={starting} className={buttonClass}>
            Update iPhone
          </button>
        </>
      )}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </section>
  );
}
