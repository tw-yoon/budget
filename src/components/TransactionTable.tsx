"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { TransactionDTO } from "@/types";
import { formatSignedAmount, formatDate, formatWeekday, formatCurrency } from "@/lib/format";
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

// Selectable categories for a two-level picker on a row: the user's list,
// plus whatever the row already shows (e.g. a Plaid primary with no mapping)
// so nothing gets orphaned. Shared by CategoryEditor and AddSplitForm so a
// part's picker offers exactly what the row's own picker offers — "the same
// picker the row itself uses" per the spec.
function categoryOptionsFor(
  categories: string[],
  category: string,
  plaidCategory: string
): string[] {
  const set = new Set(categories);
  set.add(category);
  set.add(plaidCategory);
  return [...set].sort((a, b) => a.localeCompare(b));
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
        className={`group/th flex items-center gap-1 ${
          active ? "text-foreground" : "hover:text-foreground"
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

// Plaid's merchant logo, or the name's first letter in a gray circle.
function MerchantLogo({ transaction }: { transaction: TransactionDTO }) {
  const [broken, setBroken] = useState(false);
  const name = transaction.merchantName ?? transaction.name;
  if (transaction.logoUrl && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={transaction.logoUrl}
        alt=""
        onError={() => setBroken(true)}
        className="h-9 w-9 shrink-0 rounded-full bg-panel2 object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-panel2 text-sm font-medium text-muted2"
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

export function TransactionTable({
  transactions,
  onChanged,
  categories,
  subcategories,
  detailed = false,
  sort,
  dir,
  onSort,
}: {
  transactions: TransactionDTO[];
  onChanged: () => void;
  categories: string[];
  subcategories: Map<string, string[]>;
  // Bigger rows with the logo, the bank's own description and your note.
  detailed?: boolean;
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

  // Subcategories from Settings plus any used on this page or saved this
  // session, grouped by parent — feeds the editor's datalist so existing subs
  // are one click away but free text still works.
  const knownSubs = useMemo(() => {
    const map = new Map<string, Set<string>>(
      [...subcategories].map(([parent, subs]) => [parent, new Set(subs)])
    );
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
  }, [subcategories, transactions, overrides]);

  if (transactions.length === 0) {
    return (
      <div className="group-panel px-6 py-16 text-center text-sm text-muted2">
        No transactions found. Connect an account and hit{" "}
        <span className="font-medium">Sync transactions</span>.
      </div>
    );
  }

  const padY = detailed ? "py-4" : "py-3";

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="group-panel overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="section-caption border-b border-line text-left">
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
                  className={`border-b border-line last:border-0 hover:bg-panel2 ${
                    isExpandable ? "cursor-pointer" : ""
                  }`}
                  onClick={isExpandable ? () => toggle(t.id) : undefined}
                >
                  <td className={`whitespace-nowrap px-4 ${padY} text-xs tabular-nums text-dim2`}>
                    {t.label ?? "—"}
                  </td>
                  <td className={`whitespace-nowrap px-4 ${padY} text-muted2`}>
                    {formatDate(t.date)}
                    {detailed && (
                      <div className="text-xs text-dim2">{formatWeekday(t.date)}</div>
                    )}
                  </td>
                  <td className={`w-full min-w-40 max-w-0 px-4 ${padY}`}>
                    {/* flex-wrap, so a narrow viewport stacks the badges onto
                        their own lines instead of squeezing every flex item —
                        description text included — down to one character per
                        row. */}
                    <div className={detailed ? "flex items-start gap-3" : undefined}>
                    {detailed && <MerchantLogo transaction={t} />}
                    <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {isExpandable && (
                        <span className="text-dim2">
                          {isOpen ? "▾" : "▸"}
                        </span>
                      )}
                      {/* wrap-anywhere, not break-words: transfer memos carry unbreakable
                          reference tokens, and only overflow-wrap:anywhere lowers the cell's
                          minimum width (min-w-40 keeps it readable). */}
                      <span className={`wrap-anywhere font-medium ${detailed ? "text-base" : ""}`}>
                        {t.merchantName ?? t.name}
                      </span>
                      {t.source === "VENMO" && <Badge tone="violet">Venmo</Badge>}
                      {t.source !== "VENMO" && isZelleName(t.name) && (
                        <Badge tone="violet">Zelle</Badge>
                      )}
                      {t.linkedTo && (
                        <span
                          title={`Linked to #${t.linkedTo.label ?? "?"} ${t.linkedTo.name}`}
                          className="chip shrink-0 whitespace-nowrap text-pos"
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
                        <Badge
                          tone={
                            t.splitRemainder !== null && t.splitRemainder < 0
                              ? "amber"
                              : "slate"
                          }
                          title={
                            t.splitRemainder !== null && t.splitRemainder < 0
                              ? "This transaction's amount changed and is now smaller than its splits"
                              : undefined
                          }
                        >
                          {splitWays === 1
                            ? "Split 1 way"
                            : `Split ${splitWays} ways`}
                        </Badge>
                      )}
                      {t.isFee && <Badge tone="slate">Fee</Badge>}
                    </div>
                    {detailed && t.merchantName && t.merchantName !== t.name && (
                      <div className="wrap-anywhere mt-0.5 text-xs text-dim2">{t.name}</div>
                    )}
                    {detailed && t.personalNote && (
                      <div className="wrap-anywhere mt-0.5 text-xs">{t.personalNote}</div>
                    )}
                    {isEditing ? (
                      <CategoryEditor
                        transaction={t}
                        category={category}
                        subcategory={categoryDetailed ?? ""}
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
                        className="group/cat mt-0.5 flex items-center gap-1 text-left text-xs text-muted2 hover:text-foreground"
                        title="Edit category"
                      >
                        <span>
                          {categoryDetailed
                            ? `${category} > ${categoryDetailed}`
                            : category}
                        </span>
                        {rawOverride !== null && (
                          <span className="chip shrink-0 whitespace-nowrap">
                            custom
                          </span>
                        )}
                        <span className="opacity-0 transition-opacity group-hover/cat:opacity-100">
                          ✎
                        </span>
                      </button>
                    )}
                    </div>
                    </div>
                  </td>
                  <td className={`whitespace-nowrap px-4 ${padY} text-muted2`}>
                    {t.accountName}
                    {t.accountMask && (
                      <span className="text-dim2">
                        {" "}
                        ··{t.accountMask}
                      </span>
                    )}
                  </td>
                  <td
                    className={`whitespace-nowrap px-4 ${padY} text-right tabular-nums ${
                      detailed ? "text-base font-medium" : ""
                    } ${
                      isOutflow
                        ? "text-foreground"
                        : "text-pos"
                    }`}
                  >
                    {text}
                    {hasRefunds && (
                      <div className="text-xs font-normal text-pos">
                        net {formatCurrency(t.netAmount)}
                      </div>
                    )}
                  </td>
                </tr>
                {isExpandable && isOpen && (
                  <tr className="border-b border-line bg-panel2">
                    <td colSpan={5} className="px-4 py-3">
                      {hasBreakdown && <BreakdownPanel breakdown={t.breakdown!} />}
                      {hasRefunds && <RefundPanel refunds={t.refunds} />}
                      {hasSplits && (
                        <SplitPanel
                          transaction={t}
                          category={category}
                          categoryDetailed={categoryDetailed}
                          categories={categories}
                          knownSubs={knownSubs}
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
      <p className="section-caption mb-2">
        Pooled from these Venmo payments
      </p>
      <ul className="space-y-1">
        {breakdown.slices.map((s) => (
          <li
            key={s.category}
            className="flex items-center justify-between gap-4 text-sm"
          >
            <span className="text-muted2">{s.category}</span>
            <span className="tabular-nums">
              {formatCurrency(s.amount)}
            </span>
          </li>
        ))}
        {breakdown.priorBalance > 0 && (
          <li className="flex items-center justify-between gap-4 text-sm text-muted2">
            <span>Prior balance (uncategorized)</span>
            <span className="tabular-nums">
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
      <p className="section-caption mb-2">
        Paid back by
      </p>
      <ul className="space-y-1">
        {refunds.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-4 text-sm">
            <span className="text-muted2">
              <span className="text-xs text-dim2">
                #{r.label ?? "—"}
              </span>{" "}
              {formatDate(r.date)} · {r.name}
            </span>
            <span className="tabular-nums text-pos">
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
  categoryDetailed,
  categories,
  knownSubs,
  onChanged,
}: {
  transaction: TransactionDTO;
  // The row's effective category as the table computed it, overrides saved
  // this session included. Naming where the leftover lands is the whole job of
  // the "(rest)" line, so it has to agree with the label on the row above it.
  category: string;
  // The row's effective subcategory, same rules as `category` above — needed
  // so "(rest)" reads as the full category, not just its parent.
  categoryDetailed: string | null;
  categories: string[];
  knownSubs: Map<string, Set<string>>;
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
      <p className="section-caption mb-2">
        Split across categories
      </p>
      <ul className="space-y-1">
        {t.splits.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-4 text-sm">
            <span className="text-muted2">
              {s.subcategory ? `${s.category} › ${s.subcategory}` : s.category}
            </span>
            <span className="flex items-center gap-3">
              <span className="tabular-nums">{formatCurrency(s.amount)}</span>
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
                  className="text-xs text-dim2 hover:text-neg disabled:opacity-40"
                >
                  ✕
                </button>
              )}
            </span>
          </li>
        ))}
        {t.splitRemainder !== null && (
          <li className="flex items-center justify-between gap-4 text-sm text-muted2">
            {/* The leftover is a part among equals, distinguished only by being
                the one you cannot remove — it is derived, not stored. Full
                effective category (parent + sub when there is one), matching
                how a carve-out renders above. */}
            <span>
              {categoryDetailed ? `${category} › ${categoryDetailed}` : category}{" "}
              (rest)
            </span>
            <span
              className={`tabular-nums ${
                t.splitRemainder < 0 ? "text-neg" : ""
              }`}
            >
              {formatCurrency(t.splitRemainder)}
            </span>
          </li>
        )}
      </ul>

      {t.splitRemainder !== null && t.splitRemainder < 0 && (
        <p className="mt-2 text-xs text-neg">
          This transaction&rsquo;s amount changed and is now smaller than its
          splits. Remove or re-add a split to fix it.
        </p>
      )}

      {error && (
        <p className="mt-2 text-xs text-neg">{error}</p>
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
          category={category}
          categories={categories}
          knownSubs={knownSubs}
          onChanged={onChanged}
        />
      )}

      {!loading && !isPro && (
        <p className="mt-2 text-xs text-muted2">
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
  category,
  categories,
  knownSubs,
  onChanged,
}: {
  transaction: TransactionDTO;
  // The row's own effective category (parent only), so the picker can offer
  // it even when it came from an unmapped Plaid primary — same reasoning as
  // CategoryEditor's `options` below.
  category: string;
  categories: string[];
  knownSubs: Map<string, Set<string>>;
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
  // Same picker the row itself uses: the user's list plus whatever this row
  // already shows, so a part can be carved under a category the row is
  // currently wearing even when that came from an unmapped Plaid primary.
  const options = useMemo(
    () => categoryOptionsFor(categories, category, t.plaidCategory),
    [categories, category, t.plaidCategory]
  );
  const [cat, setCat] = useState(options[0] ?? category);
  const [sub, setSub] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const subs = [...(knownSubs.get(cat) ?? [])].sort((a, b) => a.localeCompare(b));
  const datalistId = `split-subs-${t.id}`;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/transactions/${t.id}/splits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: Number(amount),
          category: cat,
          subcategory: sub.trim() || null,
        }),
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
        min="0.01"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        aria-label="Split amount"
        className="field w-24"
      />
      <select
        value={cat}
        onChange={(e) => {
          setCat(e.target.value);
          setSub("");
        }}
        aria-label="Split category"
        className="field"
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
        aria-label="Split subcategory"
        className="field w-44"
      />
      <datalist id={datalistId}>
        {subs.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <button
        type="button"
        onClick={() => void submit()}
        disabled={busy || amount === ""}
        className="btn btn-primary disabled:opacity-40"
      >
        Add split
      </button>
      {error && <span className="text-xs text-neg">{error}</span>}
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
  // to be started from. Restricted to an unsplit row: once there are parts,
  // the row is expandable and the panel's own AddSplitForm is the one place
  // to add another — without this, an already-split, expanded row with the
  // editor open would render two identical add-split forms at once.
  const canSplit =
    mode === "pro" && isSplittable(transaction) && transaction.splits.length === 0;

  // Selectable categories: the user's list, plus whatever this row already
  // shows (e.g. a Plaid primary with no mapping) so nothing gets orphaned.
  const options = useMemo(
    () => categoryOptionsFor(categories, category, transaction.plaidCategory),
    [categories, category, transaction.plaidCategory]
  );

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
        className="field"
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
        className="field w-44"
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
        className="btn btn-primary disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save"}
      </button>
      {hasOverride && (
        <button
          type="button"
          disabled={saving}
          onClick={() => patch({ category: null })}
          className="btn disabled:opacity-50"
          title="Remove override and use Plaid's category"
        >
          Reset
        </button>
      )}
      <button
        type="button"
        disabled={saving}
        onClick={() => onDone()}
        className="btn"
      >
        Cancel
      </button>
      {error && (
        <span className="text-neg">Failed to save</span>
      )}
      {transaction.amount < 0 && (
        <div className="mt-1 w-full border-t border-line pt-1.5">
          <TransactionLinkPicker
            transactionId={transaction.id}
            linkedTo={linkedTo}
            onLinked={onLinked}
          />
        </div>
      )}
      {canSplit && (
        <div className="mt-1 w-full border-t border-line pt-1.5">
          {splitting ? (
            <AddSplitForm
              transaction={transaction}
              category={category}
              categories={categories}
              knownSubs={knownSubs}
              onChanged={onSplit}
            />
          ) : (
            <button
              type="button"
              onClick={() => setSplitting(true)}
              title="Put part of this transaction under its own category"
              className="btn"
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
  title,
}: {
  children: React.ReactNode;
  tone: "amber" | "slate" | "violet";
  title?: string;
}) {
  const tones = {
    amber:
      "text-warn",
    slate:
      "",
    violet:
      "",
  };
  return (
    <span
      title={title}
      className={`chip shrink-0 whitespace-nowrap ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
