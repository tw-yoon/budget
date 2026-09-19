"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { TransactionDTO } from "@/types";
import { formatSignedAmount, formatDate, formatCurrency } from "@/lib/format";
import { splitCategory } from "@/lib/categories";
import { remainderOf } from "@/lib/splits";
import { isZelleName } from "@/lib/zelle";
import { TransactionLinkPicker } from "./TransactionLinkPicker";
import { useProMode } from "./useProMode";

export type SortColumn = "date" | "label";
export type SortDir = "asc" | "desc";

// `validateNewSplit`'s first two refusals, mirrored on the client so a write
// control is absent exactly where the server would refuse it. Kept in one
// place because both the entry point on an unsplit row and the add form in the
// panel have to agree with the server, and with each other.
function isSplittable(t: TransactionDTO): boolean {
  return t.amount > 0 && !t.pending;
}

// A sortable column header. Clicking the active column flips direction;
// clicking the other one switches to it and starts descending — newest, and
// highest-numbered, is what you want on arrival either way.
function SortableTh({
  column,
  label,
  sort,
  dir,
  onSort,
}: {
  column: SortColumn;
  label: string;
  sort: SortColumn;
  dir: SortDir;
  onSort: (column: SortColumn) => void;
}) {
  const active = sort === column;
  return (
    <th
      className="px-4 py-3 font-medium"
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className={`group/th flex items-center gap-1 uppercase tracking-wide ${
          active
            ? "text-black/80 dark:text-white/80"
            : "hover:text-black/70 dark:hover:text-white/70"
        }`}
        title={`Sort by ${column === "label" ? "number" : "date"}`}
      >
        {label}
        <span className={active ? "" : "opacity-0 group-hover/th:opacity-40"}>
          {active && dir === "asc" ? "▲" : "▼"}
        </span>
      </button>
    </th>
  );
}

export function TransactionTable({
  transactions,
  onChanged,
  categories,
  sort,
  dir,
  onSort,
}: {
  transactions: TransactionDTO[];
  onChanged: () => void;
  categories: string[];
  sort: SortColumn;
  dir: SortDir;
  onSort: (column: SortColumn) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  // Optimistic overrides saved this session: id -> raw userCategory (null =
  // override cleared, revert to Plaid). Keeps the table current without a
  // refetch.
  const [overrides, setOverrides] = useState<Map<string, string | null>>(
    new Map()
  );

  // Subcategories already in use, grouped by parent — feeds the editor's
  // datalist so existing subs are one click away but free text still works.
  const knownSubs = useMemo(() => {
    const map = new Map<string, Set<string>>();
    const add = (raw: string | null) => {
      if (!raw) return;
      const { parent, sub } = splitCategory(raw);
      if (!sub) return;
      if (!map.has(parent)) map.set(parent, new Set());
      map.get(parent)!.add(sub);
    };
    for (const t of transactions) add(t.userCategory);
    for (const raw of overrides.values()) add(raw);
    return map;
  }, [transactions, overrides]);

  if (transactions.length === 0) {
    return (
      <div className="rounded-lg border border-black/10 px-6 py-16 text-center text-sm text-black/50 dark:border-white/10 dark:text-white/50">
        No transactions found. Connect an account and hit{" "}
        <span className="font-medium">Sync transactions</span>.
      </div>
    );
  }

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="overflow-x-auto rounded-lg border border-black/10 dark:border-white/10">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-black/10 text-left text-xs uppercase tracking-wide text-black/50 dark:border-white/10 dark:text-white/50">
            <SortableTh column="label" label="#" sort={sort} dir={dir} onSort={onSort} />
            <SortableTh column="date" label="Date" sort={sort} dir={dir} onSort={onSort} />
            <th className="px-4 py-3 font-medium">Description</th>
            <th className="px-4 py-3 font-medium">Account</th>
            <th className="px-4 py-3 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((t) => {
            const { text, isOutflow } = formatSignedAmount(t.amount);
            const hasBreakdown = t.breakdown !== null;
            const hasRefunds = t.refunds.length > 0;
            const hasSplits = t.splits.length > 0;
            const isExpandable = hasBreakdown || hasRefunds || hasSplits;
            // The parts, plus the leftover when there is one to draw. One part
            // consuming the row exactly leaves a single way, hence the singular.
            const splitWays =
              t.splits.length + (t.splitRemainder === null ? 0 : 1);
            const isOpen = expanded.has(t.id);
            // Effective category/sub: session override wins, then the
            // server-computed values (which already fold in stored overrides).
            const rawOverride = overrides.has(t.id)
              ? overrides.get(t.id)!
              : t.userCategory;
            const split = rawOverride ? splitCategory(rawOverride) : null;
            // overrides.has(...) here means an in-session "override cleared"
            // (revert to Plaid's), since the server hasn't refetched yet.
            // Otherwise t.category is the server's effective category — for a
            // linked row, the one inherited from its purchase.
            const category = split
              ? split.parent
              : overrides.has(t.id)
                ? t.plaidCategory
                : t.category;
            const categoryDetailed = split
              ? split.sub
              : overrides.has(t.id)
                ? t.plaidCategoryDetailed
                : t.categoryDetailed;
            const isEditing = editing === t.id;
            return (
              <FragmentRow key={t.id}>
                <tr
                  className={`border-b border-black/[0.06] last:border-0 dark:border-white/[0.06] ${
                    isExpandable
                      ? "cursor-pointer hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
                      : "hover:bg-black/[0.02] dark:hover:bg-white/[0.03]"
                  }`}
                  onClick={isExpandable ? () => toggle(t.id) : undefined}
                >
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs tabular-nums text-black/35 dark:text-white/35">
                    {t.label ?? "—"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-black/60 dark:text-white/60">
                    {formatDate(t.date)}
                  </td>
                  <td className="px-4 py-3">
                    {/* flex-wrap, so a narrow viewport stacks the badges onto
                        their own lines instead of squeezing every flex item —
                        description text included — down to one character per
                        row. */}
                    <div className="flex flex-wrap items-center gap-2">
                      {isExpandable && (
                        <span className="text-black/40 dark:text-white/40">
                          {isOpen ? "▾" : "▸"}
                        </span>
                      )}
                      {/* wrap-anywhere, not break-words: bank transfer memos
                          carry unbreakable 35-character reference tokens, and
                          only `overflow-wrap: anywhere` lowers the cell's
                          intrinsic minimum width. `break-word` wraps the text
                          but leaves the minimum intact, so the table would
                          still force the page into a horizontal scroll. */}
                      <span className="wrap-anywhere font-medium">
                        {t.merchantName ?? t.name}
                      </span>
                      {t.source === "VENMO" && <Badge tone="violet">Venmo</Badge>}
                      {t.source !== "VENMO" && isZelleName(t.name) && (
                        <Badge tone="violet">Zelle</Badge>
                      )}
                      {t.linkedTo && (
                        <span
                          title={`Linked to #${t.linkedTo.label ?? "?"} ${t.linkedTo.name}`}
                          className="shrink-0 whitespace-nowrap rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                        >
                          → #{t.linkedTo.label ?? "?"}
                        </span>
                      )}
                      {t.pending && <Badge tone="amber">Pending</Badge>}
                      {t.isTransfer && !hasBreakdown && (
                        <Badge tone="slate">Transfer</Badge>
                      )}
                      {hasBreakdown && (
                        <Badge tone="slate">
                          {t.breakdown!.slices.length} categories
                        </Badge>
                      )}
                      {hasSplits && (
                        <Badge tone="slate">
                          {splitWays === 1
                            ? "Split 1 way"
                            : `Split ${splitWays} ways`}
                        </Badge>
                      )}
                      {t.isFee && <Badge tone="slate">Fee</Badge>}
                    </div>
                    {isEditing ? (
                      <CategoryEditor
                        transaction={t}
                        category={category}
                        subcategory={split?.sub ?? ""}
                        knownSubs={knownSubs}
                        hasOverride={rawOverride !== null}
                        categories={categories}
                        linkedTo={t.linkedTo}
                        onLinked={() => {
                          // A link/unlink just changed this row's category on
                          // the server. Drop any stale session override so it
                          // doesn't keep masking the server's value after the
                          // refetch below — the link (or Plaid, once
                          // unlinked) owns the category now.
                          setOverrides((prev) => {
                            if (!prev.has(t.id)) return prev;
                            const next = new Map(prev);
                            next.delete(t.id);
                            return next;
                          });
                          setEditing(null);
                          onChanged();
                        }}
                        onSplit={() => {
                          // The row becomes expandable only now, so open it —
                          // otherwise the new carve-out lands behind a marker
                          // the user never saw appear.
                          setExpanded((prev) => new Set(prev).add(t.id));
                          setEditing(null);
                          onChanged();
                        }}
                        onDone={(raw) => {
                          if (raw !== undefined)
                            setOverrides((prev) =>
                              new Map(prev).set(t.id, raw)
                            );
                          setEditing(null);
                        }}
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditing(t.id);
                        }}
                        // text-left because a <button> centres its text by
                        // default, which only shows once the category name is
                        // long enough to wrap.
                        className="group/cat mt-0.5 flex items-center gap-1 text-left text-xs text-black/45 hover:text-black/70 dark:text-white/45 dark:hover:text-white/70"
                        title="Edit category"
                      >
                        <span>
                          {split
                            ? split.sub
                              ? `${category} > ${split.sub}`
                              : category
                            : categoryDetailed ?? category}
                        </span>
                        {rawOverride !== null && (
                          <span className="shrink-0 whitespace-nowrap rounded bg-sky-100 px-1 text-[9px] font-medium uppercase tracking-wide text-sky-700 dark:bg-sky-500/15 dark:text-sky-300">
                            custom
                          </span>
                        )}
                        <span className="opacity-0 transition-opacity group-hover/cat:opacity-100">
                          ✎
                        </span>
                      </button>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-black/60 dark:text-white/60">
                    {t.accountName}
                    {t.accountMask && (
                      <span className="text-black/40 dark:text-white/40">
                        {" "}
                        ··{t.accountMask}
                      </span>
                    )}
                  </td>
                  <td
                    className={`whitespace-nowrap px-4 py-3 text-right font-mono tabular-nums ${
                      isOutflow
                        ? "text-black/80 dark:text-white/80"
                        : "text-green-600 dark:text-green-400"
                    }`}
                  >
                    {text}
                    {hasRefunds && (
                      <div className="text-xs font-normal text-green-600 dark:text-green-400">
                        net {formatCurrency(t.netAmount)}
                      </div>
                    )}
                  </td>
                </tr>
                {isExpandable && isOpen && (
                  <tr className="border-b border-black/[0.06] bg-black/[0.015] dark:border-white/[0.06] dark:bg-white/[0.02]">
                    <td colSpan={5} className="px-4 py-3">
                      {hasBreakdown && <BreakdownPanel breakdown={t.breakdown!} />}
                      {hasRefunds && <RefundPanel refunds={t.refunds} />}
                      {hasSplits && (
                        <SplitPanel
                          transaction={t}
                          category={category}
                          categories={categories}
                          onChanged={onChanged}
                        />
                      )}
                    </td>
                  </tr>
                )}
              </FragmentRow>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function BreakdownPanel({
  breakdown,
}: {
  breakdown: NonNullable<TransactionDTO["breakdown"]>;
}) {
  return (
    <div className="pl-6">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-black/45 dark:text-white/45">
        Pooled from these Venmo payments
      </p>
      <ul className="space-y-1">
        {breakdown.slices.map((s) => (
          <li
            key={s.category}
            className="flex items-center justify-between gap-4 text-sm"
          >
            <span className="text-black/70 dark:text-white/70">{s.category}</span>
            <span className="font-mono tabular-nums">
              {formatCurrency(s.amount)}
            </span>
          </li>
        ))}
        {breakdown.priorBalance > 0 && (
          <li className="flex items-center justify-between gap-4 text-sm text-black/45 dark:text-white/45">
            <span>Prior balance (uncategorized)</span>
            <span className="font-mono tabular-nums">
              {formatCurrency(breakdown.priorBalance)}
            </span>
          </li>
        )}
      </ul>
    </div>
  );
}

function RefundPanel({ refunds }: { refunds: TransactionDTO["refunds"] }) {
  return (
    <div className="pl-6">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-black/45 dark:text-white/45">
        Paid back by
      </p>
      <ul className="space-y-1">
        {refunds.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-4 text-sm">
            <span className="text-black/70 dark:text-white/70">
              <span className="font-mono text-xs text-black/35 dark:text-white/35">
                #{r.label ?? "—"}
              </span>{" "}
              {formatDate(r.date)} · {r.name}
            </span>
            <span className="font-mono tabular-nums text-green-600 dark:text-green-400">
              {formatCurrency(Math.abs(r.amount))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// The third expandable panel, beside the cash-out breakdown and the refund
// list. Pro gates the controls only: the carve-outs and the leftover are shown
// in Normal too, because they are what the row now reports to every total.
function SplitPanel({
  transaction: t,
  category,
  categories,
  onChanged,
}: {
  transaction: TransactionDTO;
  // The row's effective category as the table computed it, overrides saved
  // this session included. Naming where the leftover lands is the whole job of
  // the "(rest)" line, so it has to agree with the label on the row above it.
  category: string;
  categories: string[];
  onChanged: () => void;
}) {
  const { mode, loading } = useProMode();
  const isPro = mode === "pro";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async (splitId: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/transactions/${t.id}/splits/${splitId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        // Same contract as the add form: the server owns the wording, so a
        // refusal reads the same wherever it surfaces.
        const { error: message } = (await res.json()) as { error?: string };
        setError(message ?? "Could not remove that split");
        return;
      }
      onChanged();
    } catch {
      // No response came back at all, so there is no server-authored message
      // to show. Worded differently from a refusal on purpose: one means the
      // request was rejected, the other that it never landed.
      setError("Could not reach the server");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pl-6">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-black/45 dark:text-white/45">
        Split across categories
      </p>
      <ul className="space-y-1">
        {t.splits.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-4 text-sm">
            <span className="text-black/70 dark:text-white/70">
              {s.subcategory ? `${s.category} › ${s.subcategory}` : s.category}
            </span>
            <span className="flex items-center gap-3">
              <span className="font-mono tabular-nums">{formatCurrency(s.amount)}</span>
              {isPro && (
                <button
                  type="button"
                  onClick={() => void remove(s.id)}
                  disabled={busy}
                  // The parent alone is ambiguous: two carve-outs can share
                  // one, and the ✕ carries no text of its own. The amount is
                  // what actually tells them apart, and the subcategory is
                  // spelled out rather than punctuated with "›", which a
                  // screen reader has no good way to say.
                  aria-label={`Remove the ${formatCurrency(s.amount)} split under ${
                    s.subcategory ? `${s.category}, ${s.subcategory}` : s.category
                  }`}
                  className="text-xs text-black/40 hover:text-red-600 disabled:opacity-40 dark:text-white/40 dark:hover:text-red-400"
                >
                  ✕
                </button>
              )}
            </span>
          </li>
        ))}
        {t.splitRemainder !== null && (
          <li className="flex items-center justify-between gap-4 text-sm text-black/45 dark:text-white/45">
            {/* The leftover is a part among equals, distinguished only by being
                the one you cannot remove — it is derived, not stored. */}
            <span>{category} (rest)</span>
            <span
              className={`font-mono tabular-nums ${
                t.splitRemainder < 0 ? "text-red-600 dark:text-red-400" : ""
              }`}
            >
              {formatCurrency(t.splitRemainder)}
            </span>
          </li>
        )}
      </ul>

      {t.splitRemainder !== null && t.splitRemainder < 0 && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">
          This transaction&rsquo;s amount changed and is now smaller than its
          splits. Remove or re-add a split to fix it.
        </p>
      )}

      {error && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
      )}

      {/* Neither branch renders while the mode is still being read: the hook
          starts at Normal, and showing the nudge on that would tell a Pro user
          something false about their own settings on every expand. */}
      {!loading && isPro && isSplittable(t) && (
        // Keyed on the part count so a successful add remounts the form: its
        // prefill is the amount left, and that has just changed.
        <AddSplitForm
          key={t.splits.length}
          transaction={t}
          categories={categories}
          onChanged={onChanged}
        />
      )}

      {!loading && !isPro && (
        <p className="mt-2 text-xs text-black/45 dark:text-white/45">
          Splits still count toward your totals in Normal mode —{" "}
          <Link href="/settings/mode" className="underline underline-offset-2 hover:text-foreground">
            switch to Pro in Settings
          </Link>{" "}
          to change them.
        </p>
      )}
    </div>
  );
}

function AddSplitForm({
  transaction: t,
  categories,
  onChanged,
}: {
  transaction: TransactionDTO;
  categories: string[];
  onChanged: () => void;
}) {
  // From the second carve-out onward the amount left is the natural default:
  // finishing off a row is then a single category pick with no arithmetic.
  //
  // On an unsplit row that same figure is the row's WHOLE amount, and taking
  // it would carve out everything — one part, no leftover, which is a silent
  // recategorization wearing a split badge rather than a split. The server
  // allows it (equality passes the over-allocation check), so the first
  // carve-out starts blank and its figure has to be typed.
  const left = t.splitRemainder ?? remainderOf(t.amount, t.splits);
  const [amount, setAmount] = useState(
    t.splits.length > 0 && left > 0 ? left.toFixed(2) : ""
  );
  const [category, setCategory] = useState(categories[0] ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/transactions/${t.id}/splits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: Number(amount), category }),
      });
      if (!res.ok) {
        // The server owns validation; showing its message keeps the two from
        // drifting apart as the rules change.
        const { error: message } = (await res.json()) as { error?: string };
        setError(message ?? "Could not add that split");
        return;
      }
      onChanged();
    } catch {
      // No response came back at all — nothing was validated and nothing was
      // written, which is a different thing to tell the user than a refusal.
      setError("Could not reach the server");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <input
        type="number"
        step="0.01"
        min="0"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        aria-label="Split amount"
        className="w-24 rounded border border-black/15 px-2 py-1 text-sm dark:border-white/15 dark:bg-transparent"
      />
      <select
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        aria-label="Split category"
        className="rounded border border-black/15 px-2 py-1 text-sm dark:border-white/15 dark:bg-transparent"
      >
        {categories.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => void submit()}
        disabled={busy || amount === ""}
        className="rounded bg-black px-3 py-1 text-sm text-white disabled:opacity-40 dark:bg-white dark:text-black"
      >
        Add split
      </button>
      {error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}
    </div>
  );
}

function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

// Inline two-level category picker: a category select plus an optional
// free-text subcategory (with a datalist of subs already used under that
// category). Saving without a subcategory stores just the category — the sub
// simply defaults to the category itself.
function CategoryEditor({
  transaction,
  category,
  subcategory,
  knownSubs,
  hasOverride,
  categories,
  linkedTo,
  onLinked,
  onSplit,
  onDone,
}: {
  transaction: TransactionDTO;
  category: string;
  subcategory: string;
  knownSubs: Map<string, Set<string>>;
  hasOverride: boolean;
  categories: string[];
  linkedTo: TransactionDTO["linkedTo"];
  onLinked: (linked: { label: number | null; name: string } | null) => void;
  // A first carve-out was added and the row needs refetching.
  onSplit: () => void;
  // raw userCategory saved, null = cleared, undefined = cancelled
  onDone: (raw?: string | null) => void;
}) {
  const [cat, setCat] = useState(category);
  const [sub, setSub] = useState(subcategory);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const { mode } = useProMode();
  const locked = linkedTo !== null;
  // An unsplit row is not expandable, so the first carve-out has nowhere else
  // to be started from.
  const canSplit = mode === "pro" && isSplittable(transaction);

  // Selectable categories: the user's list, plus whatever this row already
  // shows (e.g. a Plaid primary with no mapping) so nothing gets orphaned.
  const options = useMemo(() => {
    const set = new Set(categories);
    set.add(category);
    set.add(transaction.plaidCategory);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [categories, category, transaction.plaidCategory]);

  const subs = [...(knownSubs.get(cat) ?? [])].sort((a, b) =>
    a.localeCompare(b)
  );
  const datalistId = `subs-${transaction.id}`;

  const patch = async (body: {
    category: string | null;
    subcategory?: string | null;
  }) => {
    setSaving(true);
    setError(false);
    try {
      const res = await fetch(`/api/transactions/${transaction.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("patch failed");
      const data = (await res.json()) as { userCategory: string | null };
      onDone(data.userCategory);
    } catch {
      setError(true);
      setSaving(false);
    }
  };

  return (
    <div
      className="mt-1 flex flex-wrap items-center gap-1.5 text-xs"
      onClick={(e) => e.stopPropagation()}
    >
      <select
        value={cat}
        onChange={(e) => {
          setCat(e.target.value);
          setSub("");
        }}
        disabled={saving || locked}
        className="rounded border border-black/15 bg-white px-1.5 py-1 dark:border-white/20 dark:bg-neutral-900"
      >
        {options.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <input
        type="text"
        value={sub}
        onChange={(e) => setSub(e.target.value)}
        placeholder="Subcategory (optional)"
        list={datalistId}
        disabled={saving || locked}
        onKeyDown={(e) => {
          if (e.key === "Enter") patch({ category: cat, subcategory: sub });
          if (e.key === "Escape") onDone();
        }}
        className="w-44 rounded border border-black/15 bg-white px-1.5 py-1 dark:border-white/20 dark:bg-neutral-900"
      />
      <datalist id={datalistId}>
        {subs.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <button
        type="button"
        disabled={saving || locked}
        onClick={() => patch({ category: cat, subcategory: sub })}
        title={
          locked
            ? "This row's category comes from the purchase it's connected to — disconnect first to set one manually"
            : undefined
        }
        className="rounded bg-black px-2 py-1 font-medium text-white hover:bg-black/80 disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-white/85"
      >
        {saving ? "Saving…" : "Save"}
      </button>
      {hasOverride && (
        <button
          type="button"
          disabled={saving}
          onClick={() => patch({ category: null })}
          className="rounded border border-black/15 px-2 py-1 text-black/60 hover:bg-black/[0.04] disabled:opacity-50 dark:border-white/20 dark:text-white/60 dark:hover:bg-white/[0.06]"
          title="Remove override and use Plaid's category"
        >
          Reset
        </button>
      )}
      <button
        type="button"
        disabled={saving}
        onClick={() => onDone()}
        className="rounded px-2 py-1 text-black/50 hover:bg-black/[0.04] dark:text-white/50 dark:hover:bg-white/[0.06]"
      >
        Cancel
      </button>
      {error && (
        <span className="text-red-600 dark:text-red-400">Failed to save</span>
      )}
      {transaction.amount < 0 && (
        <div className="mt-1 w-full border-t border-black/[0.06] pt-1.5 dark:border-white/[0.06]">
          <TransactionLinkPicker
            transactionId={transaction.id}
            linkedTo={linkedTo}
            onLinked={onLinked}
          />
        </div>
      )}
      {canSplit && (
        <div className="mt-1 w-full border-t border-black/[0.06] pt-1.5 dark:border-white/[0.06]">
          {splitting ? (
            <AddSplitForm
              transaction={transaction}
              categories={categories}
              onChanged={onSplit}
            />
          ) : (
            <button
              type="button"
              onClick={() => setSplitting(true)}
              title="Put part of this transaction under its own category"
              className="rounded border border-black/15 px-2 py-1 text-black/60 hover:bg-black/[0.04] dark:border-white/20 dark:text-white/60 dark:hover:bg-white/[0.06]"
            >
              Split this
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Badge({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "amber" | "slate" | "violet";
}) {
  const tones = {
    amber:
      "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
    slate:
      "bg-black/[0.06] text-black/55 dark:bg-white/10 dark:text-white/55",
    violet:
      "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  };
  return (
    <span
      className={`shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
