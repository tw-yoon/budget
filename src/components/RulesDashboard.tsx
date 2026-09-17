"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  RULE_FIELDS,
  RULE_MATCH_TYPES,
  FIELD_LABELS,
  MATCH_TYPE_LABELS,
} from "@/lib/rules";

interface RuleDTO {
  id: string;
  field: string;
  matchType: string;
  pattern: string;
  category: string;
  priority: number;
  enabled: boolean;
}

const inputCls =
  "rounded-md border border-black/15 bg-transparent px-2.5 py-1.5 text-sm outline-none placeholder:text-black/40 focus:border-black/40 dark:border-white/15 dark:placeholder:text-white/40 dark:focus:border-white/40";

export function RulesDashboard() {
  const [rules, setRules] = useState<RuleDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [applyMsg, setApplyMsg] = useState("");
  const [applying, setApplying] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/rules");
      if (!res.ok) throw new Error(`Failed to load (HTTP ${res.status})`);
      setRules((await res.json()).rules as RuleDTO[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function applyNow() {
    setApplying(true);
    setApplyMsg("");
    try {
      const res = await fetch("/api/rules/apply", { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "Failed to apply");
      setApplyMsg(
        `Re-categorized ${d.updated} transaction${d.updated === 1 ? "" : "s"}.`
      );
    } catch (err) {
      setApplyMsg(err instanceof Error ? err.message : "Failed to apply");
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Rules</h1>
          <p className="text-sm text-black/55 dark:text-white/55">
            Auto-assign a category when a transaction matches.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={applyNow}
            disabled={applying}
            className="rounded-md border border-black/15 px-3 py-1.5 text-sm font-medium hover:bg-black/[0.03] disabled:opacity-50 dark:border-white/15 dark:hover:bg-white/[0.04]"
          >
            {applying ? "Applying…" : "Apply now"}
          </button>
          <button
            onClick={() => setAdding((v) => !v)}
            className="rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background hover:opacity-90"
          >
            + Add rule
          </button>
        </div>
      </header>

      {applyMsg && (
        <p className="text-xs text-black/55 dark:text-white/55">{applyMsg}</p>
      )}

      <p className="rounded-lg border border-amber-300/50 bg-amber-50 px-4 py-2.5 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
        Rules run top-to-bottom on each sync; the <strong>first match wins</strong>.
        They never overwrite a category you set by hand or one from Venmo. Set a
        rule&apos;s category to <strong>Transfer</strong> to exclude matching
        transactions from spending. Hit <strong>Apply now</strong> to run them
        over existing transactions.
      </p>

      {adding && (
        <RuleForm
          onDone={() => {
            setAdding(false);
            load();
          }}
          onCancel={() => setAdding(false)}
        />
      )}

      {error ? (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
          {error}
        </div>
      ) : rules === null ? (
        <div className="rounded-lg border border-black/10 px-6 py-12 text-center text-sm text-black/50 dark:border-white/10 dark:text-white/50">
          Loading…
        </div>
      ) : rules.length === 0 ? (
        <div className="rounded-lg border border-black/10 px-6 py-12 text-center text-sm text-black/50 dark:border-white/10 dark:text-white/50">
          No rules yet. Hit <span className="font-medium">+ Add rule</span> to
          create one.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-black/10 dark:border-white/10">
          <div className="divide-y divide-black/[0.06] dark:divide-white/[0.06]">
            {rules.map((r) => (
              <Row key={r.id} rule={r} onChanged={load} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ rule, onChanged }: { rule: RuleDTO; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);

  async function patch(data: Partial<RuleDTO>) {
    setBusy(true);
    await fetch(`/api/rules/${rule.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    setBusy(false);
    onChanged();
  }

  async function remove() {
    setBusy(true);
    await fetch(`/api/rules/${rule.id}`, { method: "DELETE" });
    onChanged();
  }

  return (
    <div
      className={`flex items-center justify-between gap-4 px-4 py-3 ${
        rule.enabled ? "" : "opacity-50"
      }`}
    >
      <div className="min-w-0 text-sm">
        <div className="truncate">
          <span className="text-black/55 dark:text-white/55">
            {FIELD_LABELS[rule.field as keyof typeof FIELD_LABELS] ?? rule.field}{" "}
            {MATCH_TYPE_LABELS[
              rule.matchType as keyof typeof MATCH_TYPE_LABELS
            ] ?? rule.matchType}{" "}
          </span>
          <span className="font-mono">&ldquo;{rule.pattern}&rdquo;</span>
        </div>
        <div className="mt-0.5 text-xs text-black/50 dark:text-white/50">
          → <span className="font-medium text-foreground">{rule.category}</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-black/50 dark:text-white/50">
          <input
            type="checkbox"
            checked={rule.enabled}
            disabled={busy}
            onChange={(e) => patch({ enabled: e.target.checked })}
          />
          on
        </label>
        <button
          onClick={remove}
          disabled={busy}
          aria-label="Delete rule"
          className="text-black/30 hover:text-red-600 disabled:opacity-50 dark:text-white/30 dark:hover:text-red-400"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

function RuleForm({
  onDone,
  onCancel,
}: {
  onDone: () => void;
  onCancel: () => void;
}) {
  const [field, setField] = useState<string>("EITHER");
  const [matchType, setMatchType] = useState<string>("CONTAINS");
  const [pattern, setPattern] = useState("");
  const [category, setCategory] = useState<string>("");
  const [categories, setCategories] = useState<string[]>([]);
  const [categoriesError, setCategoriesError] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const cancelledRef = useRef(false);

  // Pulled out of the effect so the "Retry" button below can re-run the same
  // fetch after a failure, not just the initial mount.
  const loadCategories = useCallback(() => {
    setCategoriesError(false);
    fetch("/api/categories")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (cancelledRef.current) return;
        if (!json) {
          setCategoriesError(true);
          return;
        }
        const names = json.categories.map((c: { name: string }) => c.name);
        setCategories(names);
        // Don't stomp a selection the user already made while this was
        // loading — only default the picker when it's still blank.
        setCategory((prev) => (prev === "" ? (names[0] ?? "") : prev));
      })
      .catch(() => {
        if (!cancelledRef.current) setCategoriesError(true);
      });
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadCategories();
    return () => {
      cancelledRef.current = true;
    };
  }, [loadCategories]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const res = await fetch("/api/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ field, matchType, pattern, category }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Failed to add");
      return;
    }
    onDone();
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-lg border border-black/10 p-4 dark:border-white/10"
    >
      <div className="grid gap-2 sm:grid-cols-4">
        <select
          value={field}
          onChange={(e) => setField(e.target.value)}
          className={inputCls}
        >
          {RULE_FIELDS.map((f) => (
            <option key={f} value={f}>
              {FIELD_LABELS[f]}
            </option>
          ))}
        </select>
        <select
          value={matchType}
          onChange={(e) => setMatchType(e.target.value)}
          className={inputCls}
        >
          {RULE_MATCH_TYPES.map((m) => (
            <option key={m} value={m}>
              {MATCH_TYPE_LABELS[m]}
            </option>
          ))}
        </select>
        <input
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          placeholder="Pattern (e.g. Starbucks)"
          required
          className={inputCls}
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className={inputCls}
        >
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      {categoriesError && (
        <p className="mt-2 text-sm text-red-600 dark:text-red-400">
          Failed to load categories.{" "}
          <button
            type="button"
            onClick={loadCategories}
            className="underline hover:no-underline"
          >
            Retry
          </button>
        </p>
      )}
      {error && (
        <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
      <div className="mt-2.5 flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Adding…" : "Add rule"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-black/15 px-3 py-1.5 text-sm hover:bg-black/[0.03] dark:border-white/15 dark:hover:bg-white/[0.04]"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
