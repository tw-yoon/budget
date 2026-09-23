"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  RULE_FIELDS,
  RULE_MATCH_TYPES,
  FIELD_LABELS,
  MATCH_TYPE_LABELS,
} from "@/lib/rules";
import { joinCategory, splitCategory } from "@/lib/categories";

interface RuleDTO {
  id: string;
  field: string;
  matchType: string;
  pattern: string;
  category: string;
  priority: number;
  enabled: boolean;
  // How the rows this rule is the first match for stand; null when it's off.
  outcome: { applied: number; pending: number; handSet: number } | null;
}

/** A category and its subcategories, for the category pickers. */
interface CategoryOption {
  name: string;
  subs: string[];
}

const inputCls =
  "rounded-md border border-black/15 bg-transparent px-2.5 py-1.5 text-sm outline-none placeholder:text-black/40 focus:border-black/40 dark:border-white/15 dark:placeholder:text-white/40 dark:focus:border-white/40";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function RulesDashboard() {
  const [rules, setRules] = useState<RuleDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [applyMsg, setApplyMsg] = useState("");
  const [applying, setApplying] = useState(false);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [categoriesError, setCategoriesError] = useState(false);
  const cancelledRef = useRef(false);

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
        setCategories(
          (json.categories as { name: string; subcategories: { name: string }[] }[]).map(
            (c) => ({ name: c.name, subs: c.subcategories.map((s) => s.name) })
          )
        );
      })
      .catch(() => {
        if (!cancelledRef.current) setCategoriesError(true);
      });
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    loadCategories();
    return () => {
      cancelledRef.current = true;
    };
  }, [load, loadCategories]);

  async function applyNow() {
    setApplying(true);
    setApplyMsg("");
    try {
      const res = await fetch("/api/rules/apply", { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "Failed to apply");
      setApplyMsg(
        `Re-categorized ${plural(d.updated, "transaction")}.` +
          (d.kept
            ? ` ${plural(d.kept, "matching transaction")} set by hand ${d.kept === 1 ? "was" : "were"} kept.`
            : "")
      );
      await load();
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
            Auto-assign a category, or a subcategory, when a transaction matches.
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
        They never overwrite a category you set by hand or one from Venmo, unless
        you hit <strong>Use rule for these</strong>{" "}on a rule. Set a
        rule&apos;s category to <strong>Transfer</strong> to exclude matching transactions
        from spending. Hit <strong>Apply now</strong> to run them over existing
        transactions.
      </p>

      {categoriesError && (
        <p className="text-sm text-red-600 dark:text-red-400">
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

      {adding && (
        <RuleForm
          categories={categories}
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
              <Row
                key={r.id}
                rule={r}
                categories={categories}
                onChanged={load}
                onNotice={setApplyMsg}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * A category select plus an optional subcategory: pick one of the category's
 * subcategories or type a new one, as in the ledger's row editor.
 */
function TargetPicker({
  categories,
  category,
  sub,
  onCategory,
  onSub,
}: {
  categories: CategoryOption[];
  category: string;
  sub: string;
  onCategory: (c: string) => void;
  onSub: (s: string) => void;
}) {
  const listId = useId();
  // Keep a category this rule already names selectable even if it has since
  // left the list, so opening the editor never silently changes it.
  const names = categories.map((c) => c.name);
  if (category && !names.includes(category)) names.unshift(category);
  const subs = categories.find((c) => c.name === category)?.subs ?? [];

  return (
    <>
      <select
        value={category}
        onChange={(e) => {
          onCategory(e.target.value);
          onSub("");
        }}
        aria-label="Category"
        className={inputCls}
      >
        {names.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <input
        value={sub}
        onChange={(e) => onSub(e.target.value)}
        placeholder="Subcategory (optional)"
        aria-label="Subcategory"
        list={listId}
        className={inputCls}
      />
      <datalist id={listId}>
        {subs.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </>
  );
}

function Row({
  rule,
  categories,
  onChanged,
  onNotice,
}: {
  rule: RuleDTO;
  categories: CategoryOption[];
  onChanged: () => void;
  onNotice: (msg: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [cat, setCat] = useState("");
  const [sub, setSub] = useState("");

  async function patch(data: Partial<RuleDTO>) {
    setBusy(true);
    const res = await fetch(`/api/rules/${rule.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    setBusy(false);
    if (!res.ok) onNotice("Failed to update the rule.");
    onChanged();
  }

  async function remove() {
    setBusy(true);
    await fetch(`/api/rules/${rule.id}`, { method: "DELETE" });
    onChanged();
  }

  async function takeOver(count: number) {
    if (
      !confirm(
        `Replace the category you set by hand on ${plural(count, "transaction")} matching "${rule.pattern}" with "${rule.category}"?\n\nThey'll follow this rule from then on.`
      )
    ) {
      return;
    }
    setBusy(true);
    const res = await fetch(`/api/rules/${rule.id}/take-over`, { method: "POST" });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    onNotice(
      res.ok
        ? `"${rule.pattern}" now sets ${plural(d.updated, "more transaction")}.`
        : (d.error ?? "Failed to apply the rule.")
    );
    onChanged();
  }

  const o = rule.outcome;
  const matched = o ? o.applied + o.pending + o.handSet : 0;

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
        {editing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setEditing(false);
              const next = joinCategory(cat, sub);
              if (next !== rule.category) void patch({ category: next });
            }}
            className="mt-1.5 flex flex-wrap items-center gap-2"
          >
            <TargetPicker
              categories={categories}
              category={cat}
              sub={sub}
              onCategory={setCat}
              onSub={setSub}
            />
            <button
              type="submit"
              disabled={busy || !cat}
              className="rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-md border border-black/15 px-3 py-1.5 text-sm hover:bg-black/[0.03] dark:border-white/15 dark:hover:bg-white/[0.04]"
            >
              Cancel
            </button>
          </form>
        ) : (
          <div className="mt-0.5 text-xs text-black/50 dark:text-white/50">
            →{" "}
            <button
              type="button"
              onClick={() => {
                const { parent, sub } = splitCategory(rule.category);
                setCat(parent);
                setSub(sub ?? "");
                setEditing(true);
              }}
              title="Change the category this rule sets"
              className="font-medium text-foreground hover:underline"
            >
              {rule.category}
            </button>
          </div>
        )}
        {o && (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-black/45 dark:text-white/45">
            {matched === 0 ? (
              <span>No matching transactions yet</span>
            ) : (
              <span>
                Matches {matched}:{" "}
                {[
                  o.applied && `${o.applied} set by this rule`,
                  o.pending && `${o.pending} waiting for Apply now`,
                  o.handSet && `${o.handSet} set by hand (kept)`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            )}
            {o.handSet > 0 && (
              <button
                type="button"
                onClick={() => takeOver(o.handSet)}
                disabled={busy}
                className="rounded border border-black/15 px-1.5 py-0.5 text-black/60 hover:bg-black/[0.04] disabled:opacity-50 dark:border-white/15 dark:text-white/60 dark:hover:bg-white/[0.06]"
              >
                Use rule for these
              </button>
            )}
          </div>
        )}
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
  categories,
  onDone,
  onCancel,
}: {
  categories: CategoryOption[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [field, setField] = useState<string>("EITHER");
  const [matchType, setMatchType] = useState<string>("CONTAINS");
  const [pattern, setPattern] = useState("");
  // "" until picked — the category actually submitted falls back to the first
  // one, so a list that loads after the form opens still defaults sensibly.
  const [picked, setPicked] = useState("");
  const [sub, setSub] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const category = picked || categories[0]?.name || "";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const res = await fetch("/api/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        field,
        matchType,
        pattern,
        category: joinCategory(category, sub),
      }),
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
      <div className="grid gap-2 sm:grid-cols-5">
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
        <TargetPicker
          categories={categories}
          category={category}
          sub={sub}
          onCategory={setPicked}
          onSub={setSub}
        />
      </div>
      {error && (
        <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
      <div className="mt-2.5 flex gap-2">
        <button
          type="submit"
          disabled={busy || !category}
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
