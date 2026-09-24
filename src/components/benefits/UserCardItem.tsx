"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { loadSynced, pushSynced } from "@/lib/ui-state";
import type { BenefitDTO, EarningsCategoryDTO, UserCardDTO } from "@/types";
import { formatCurrency, humanizePfc } from "@/lib/format";
import { CardArt } from "./CardArt";
import { CardArtPicker } from "./CardArtPicker";
import {
  ISSUER_LABELS,
  MONTH_NAMES,
  PERIOD_LABELS,
  BENEFIT_PERIODS,
  TRACKABLE_CATEGORIES,
} from "@/lib/categories";
import {
  REWARD_CATEGORIES,
  REWARD_CATEGORY_LABELS,
} from "@/lib/rewards";

const inputClass =
  "rounded-md border border-black/15 bg-transparent px-2.5 py-1.5 text-sm outline-none placeholder:text-black/40 focus:border-black/40 dark:border-white/15 dark:placeholder:text-white/40 dark:focus:border-white/40";

/**
 * Whether a card's statement-credits list is expanded, remembered per card.
 *
 * This rides on the shared ui-state store rather than raw localStorage, the
 * same way useProMode and the income and spending-graph preferences do, so the
 * collapse state follows the user between browsers instead of being a fact
 * about one machine.
 *
 * That store is read over the network, so the value cannot be known on the
 * first render: the list starts expanded and collapses once the read lands.
 * The initial value is a constant, identical on the server and in the browser,
 * so nothing here can produce a hydration mismatch.
 */
const CREDITS_OPEN_DEFAULT = true;

function creditsKey(cardId: string): string {
  return `card-credits-open:${cardId}`;
}

// Before this moved onto the shared store the value was the raw string "1" or
// "0", which loadSynced JSON-parses back out as the number 1 or 0. Existing
// preferences have to keep working, so accept every shape they were saved in.
// A toggle rewrites the key as a boolean.
function toCreditsOpen(stored: unknown): boolean {
  if (typeof stored === "boolean") return stored;
  if (typeof stored === "number") return stored !== 0;
  if (typeof stored === "string") return stored !== "0" && stored !== "";
  return CREDITS_OPEN_DEFAULT;
}

function useCreditsOpen(cardId: string) {
  const [open, setOpen] = useState(CREDITS_OPEN_DEFAULT);
  // A click that lands while the read is still in flight is a deliberate
  // choice and must not be overwritten by the stale value when it arrives —
  // the same race useProMode guards. It outlives the effect run, so it is a
  // ref rather than a local.
  const chosen = useRef(false);

  useEffect(() => {
    let cancelled = false;
    chosen.current = false;
    void (async () => {
      const stored = await loadSynced(creditsKey(cardId));
      if (stored == null) return;
      if (!cancelled && !chosen.current) setOpen(toCreditsOpen(stored));
    })();
    return () => {
      cancelled = true;
    };
  }, [cardId]);

  const toggle = useCallback(() => {
    chosen.current = true;
    const next = !open;
    setOpen(next);
    pushSynced(creditsKey(cardId), next);
  }, [cardId, open]);

  return { open, toggle };
}

export function UserCardItem({
  card,
  onChanged,
  onMove,
  canMoveUp,
  canMoveDown,
}: {
  card: UserCardDTO;
  onChanged: () => void;
  onMove: (id: string, dir: "up" | "down") => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  // Remembered per card, and shared across this user's browsers.
  const { open: showCredits, toggle: toggleCredits } = useCreditsOpen(card.id);

  async function deleteCard() {
    if (!confirm(`Remove ${ISSUER_LABELS[card.issuer] ?? card.issuer} ··${card.last4} and its benefits?`))
      return;
    setBusy(true);
    await fetch(`/api/user-cards/${card.id}`, { method: "DELETE" });
    onChanged();
  }

  const years = new Date().getFullYear() - card.membershipStartYear;

  return (
    <section className="overflow-hidden rounded-xl border border-black/10 dark:border-white/10">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-black/10 px-4 py-3 dark:border-white/10">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex flex-col items-start">
            <CardArt
              issuer={card.issuer}
              last4={card.last4}
              name={card.name}
              src={card.artUrl}
            />
            <CardArtPicker cardId={card.id} hasArt={!!card.artUrl} onChanged={onChanged} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="rounded bg-black/[0.06] px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide dark:bg-white/10">
                {ISSUER_LABELS[card.issuer] ?? card.issuer}
              </span>
              <span className="font-medium">{card.name || "Card"}</span>
              <span className="text-black/45 dark:text-white/45">··{card.last4}</span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-black/50 dark:text-white/50">
              <span>Member since</span>
              <StartMonthPicker card={card} onChanged={onChanged} />
              <span>
                {years > 0 && `· ${years} yr${years > 1 ? "s" : ""} `}·{" "}
                {card.benefitsUsedCount}/{card.benefitCount} credits maxed
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {card.linked ? (
            <span className="rounded bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700 dark:bg-green-500/15 dark:text-green-400">
              Linked · {card.linkedAccountName}
            </span>
          ) : (
            <span className="rounded bg-black/[0.06] px-2 py-0.5 text-[11px] text-black/55 dark:bg-white/10 dark:text-white/55">
              Not linked
            </span>
          )}
          <div className="flex items-center">
            <button
              onClick={() => onMove(card.id, "up")}
              disabled={!canMoveUp}
              aria-label="Move card up"
              title="Move up"
              className="rounded px-1 text-sm text-black/45 hover:text-foreground disabled:opacity-25 dark:text-white/45"
            >
              ↑
            </button>
            <button
              onClick={() => onMove(card.id, "down")}
              disabled={!canMoveDown}
              aria-label="Move card down"
              title="Move down"
              className="rounded px-1 text-sm text-black/45 hover:text-foreground disabled:opacity-25 dark:text-white/45"
            >
              ↓
            </button>
          </div>
          <button
            onClick={deleteCard}
            disabled={busy}
            className="text-xs text-black/50 hover:text-red-600 disabled:opacity-50 dark:text-white/50 dark:hover:text-red-400"
          >
            Remove
          </button>
        </div>
      </header>

      <FeeTracker card={card} onChanged={onChanged} />

      <div className="border-b border-black/10 px-4 py-3 dark:border-white/10">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-black/45 dark:text-white/45">
          Earning rates
        </div>
        <RatesSection card={card} onChanged={onChanged} />
      </div>

      <EarningsSection card={card} onChanged={onChanged} />

      <button
        onClick={toggleCredits}
        aria-expanded={showCredits}
        className="flex w-full items-center justify-between px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-black/45 hover:text-foreground dark:text-white/45"
      >
        <span className="flex items-center gap-1.5">
          <span className={`transition-transform ${showCredits ? "rotate-90" : ""}`}>›</span>
          Statement credits
        </span>
        <span className="font-normal normal-case tracking-normal text-black/40 dark:text-white/40">
          {showCredits
            ? "Hide"
            : `${card.benefitCount} ${card.benefitCount === 1 ? "credit" : "credits"} · ${formatCurrency(card.creditsYtd)} this year`}
        </span>
      </button>

      {showCredits && (
        <>
          <div className="divide-y divide-black/[0.06] dark:divide-white/[0.06]">
            {card.benefits.length === 0 ? (
              <p className="px-4 py-5 text-center text-sm text-black/45 dark:text-white/45">
                No credits yet — add one below.
              </p>
            ) : (
              card.benefits.map((b) => (
                <BenefitRow key={b.id} benefit={b} onChanged={onChanged} />
              ))
            )}
          </div>

          {adding ? (
            <AddBenefitForm
              cardId={card.id}
              onDone={() => {
                setAdding(false);
                onChanged();
              }}
              onCancel={() => setAdding(false)}
            />
          ) : (
            <div className="px-4 py-2.5">
              <button
                onClick={() => setAdding(true)}
                className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400"
              >
                + Add credit
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/**
 * The month the card was opened, editable inline. It sets where a monthly
 * credit's twelve-cell strip begins — and with it the window the earnings panel
 * measures — so the year lines up with the anniversary the fee is billed on
 * rather than with January. Left unset, everything falls back to the calendar.
 */
function StartMonthPicker({
  card,
  onChanged,
}: {
  card: UserCardDTO;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function save(value: string) {
    setBusy(true);
    await fetch(`/api/user-cards/${card.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ membershipStartMonth: value ? Number(value) : null }),
    });
    setBusy(false);
    onChanged();
  }

  return (
    <span className="inline-flex items-center gap-1">
      <select
        value={card.membershipStartMonth ?? ""}
        onChange={(e) => save(e.target.value)}
        disabled={busy}
        aria-label="Membership start month"
        title="The month you opened this card — sets where monthly credit strips start"
        className={`cursor-pointer rounded border border-transparent bg-transparent py-0 pl-0.5 pr-4 text-xs outline-none hover:border-black/15 focus:border-black/40 disabled:opacity-50 dark:hover:border-white/15 dark:focus:border-white/40 ${
          card.membershipStartMonth ? "" : "text-black/35 dark:text-white/35"
        }`}
      >
        <option value="">month?</option>
        {MONTH_NAMES.map((m, i) => (
          <option key={m} value={i + 1}>
            {m.slice(0, 3)}
          </option>
        ))}
      </select>
      <span>{card.membershipStartYear}</span>
    </span>
  );
}

function FeeTracker({
  card,
  onChanged,
}: {
  card: UserCardDTO;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [feeInput, setFeeInput] = useState(String(card.annualFee));
  const [busy, setBusy] = useState(false);

  async function saveFee() {
    const n = Number(feeInput);
    if (!Number.isFinite(n) || n < 0) return;
    setBusy(true);
    await fetch(`/api/user-cards/${card.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ annualFee: n }),
    });
    setEditing(false);
    onChanged();
  }

  const fee = card.annualFee;
  const net = card.creditsYtd - fee;
  const aheadPct = fee > 0 ? Math.min(1, card.creditsYtd / fee) : 1;
  const aheadWidth = Math.round(aheadPct * 100);
  const breakEven = net >= 0;

  return (
    <div className="border-b border-black/10 px-4 py-3 dark:border-white/10">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-black/45 dark:text-white/45">
          Credits vs. annual fee
        </span>
        {editing ? (
          <span className="flex items-center gap-1">
            <span className="text-xs text-black/45 dark:text-white/45">Fee $</span>
            <input
              value={feeInput}
              onChange={(e) => setFeeInput(e.target.value.replace(/[^\d.]/g, ""))}
              inputMode="decimal"
              autoFocus
              className="w-20 rounded border border-black/15 bg-transparent px-1.5 py-0.5 text-xs outline-none focus:border-black/40 dark:border-white/15 dark:focus:border-white/40"
            />
            <button
              onClick={saveFee}
              disabled={busy}
              className="rounded border border-black/15 px-1.5 py-0.5 text-xs hover:bg-black/[0.03] disabled:opacity-50 dark:border-white/15 dark:hover:bg-white/[0.04]"
            >
              Save
            </button>
          </span>
        ) : (
          <button
            onClick={() => {
              setFeeInput(String(card.annualFee));
              setEditing(true);
            }}
            className="text-xs text-black/45 hover:text-foreground dark:text-white/45"
            title="Edit annual fee"
          >
            Fee {formatCurrency(fee)} · Edit
          </button>
        )}
      </div>

      {fee > 0 ? (
        <>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/10">
            <div
              className={`h-full rounded-full ${breakEven ? "bg-green-500" : "bg-indigo-500"}`}
              style={{ width: `${aheadWidth}%` }}
            />
          </div>
          <div className="mt-1.5 text-xs text-black/55 dark:text-white/55">
            <span className="font-medium text-foreground">
              {formatCurrency(card.creditsYtd)}
            </span>{" "}
            captured this year ·{" "}
            {breakEven ? (
              <span className="font-medium text-green-600 dark:text-green-400">
                ✓ paid for itself, {formatCurrency(net)} ahead
              </span>
            ) : (
              <span>{formatCurrency(-net)} to break even</span>
            )}{" "}
            · up to {formatCurrency(card.creditsAnnualMax)} available
          </div>
        </>
      ) : (
        <div className="mt-1.5 text-xs text-black/55 dark:text-white/55">
          No annual fee ·{" "}
          <span className="font-medium text-foreground">
            {formatCurrency(card.creditsYtd)}
          </span>{" "}
          in credits captured this year
          {card.creditsAnnualMax > 0 &&
            ` · up to ${formatCurrency(card.creditsAnnualMax)} available`}
        </div>
      )}
    </div>
  );
}

function BenefitRow({
  benefit,
  onChanged,
}: {
  benefit: BenefitDTO;
  onChanged: () => void;
}) {
  const [logValue, setLogValue] = useState(
    benefit.source === "manual" ? String(benefit.used) : ""
  );
  const [busy, setBusy] = useState(false);

  const complete = benefit.pct >= 1;
  const pctWidth = Math.round(benefit.pct * 100);
  const perkOn = benefit.perkActiveFrom !== null;
  // Whether clearing a manual log leaves something to fall back on — matched
  // transactions, or the perk's own flat value.
  const canAuto =
    perkOn || benefit.matchText.length > 0 || benefit.matchCategories.length > 0;

  async function patch(usedManual: number | null) {
    setBusy(true);
    await fetch(`/api/benefits/${benefit.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usedManual }),
    });
    setBusy(false);
    onChanged();
  }

  async function togglePerk() {
    setBusy(true);
    await fetch(`/api/benefits/${benefit.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ perkActive: !perkOn }),
    });
    setBusy(false);
    onChanged();
  }

  async function del() {
    // Deleting drops the benefit's manual logs and perk switch with it, and
    // there's no undo in the UI — so confirm first.
    if (!confirm(`Delete "${benefit.name}" and everything logged against it?`)) return;
    setBusy(true);
    await fetch(`/api/benefits/${benefit.id}`, { method: "DELETE" });
    onChanged();
  }

  const activatedOn = benefit.perkActiveFrom
    ? new Date(benefit.perkActiveFrom).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;

  const hint =
    benefit.source === "auto"
      ? benefit.autoMode === "perk"
        ? `Perk active since ${activatedOn} · ${benefit.periodLabel}`
        : benefit.autoMode === "credits"
          ? `From statement credits in transactions · ${benefit.periodLabel}`
          : `From ${benefit.categoryLabels.join(", ")} spending · ${benefit.periodLabel}`
      : benefit.source === "manual"
        ? `Manually logged · ${benefit.periodLabel}`
        : `Not tracked · ${benefit.periodLabel}`;

  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium">{benefit.name}</span>
        <span className="font-mono text-sm tabular-nums">
          {formatCurrency(benefit.cappedUsed)}
          <span className="text-black/45 dark:text-white/45">
            {" "}
            / {formatCurrency(benefit.amount)}
          </span>
        </span>
      </div>

      <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/10">
        <div
          className={`h-full rounded-full ${complete ? "bg-green-500" : "bg-indigo-500"}`}
          style={{ width: `${pctWidth}%` }}
        />
      </div>

      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-black/45 dark:text-white/45">
          {complete ? "✓ " : ""}
          {hint}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={togglePerk}
            disabled={busy}
            role="switch"
            aria-checked={perkOn}
            title={
              perkOn
                ? "Switch off — the perk stops counting toward the annual fee"
                : "Switch on once you've activated this perk with the issuer; it then counts in full every period"
            }
            className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs transition-colors disabled:opacity-50 ${
              perkOn
                ? "border-green-500/40 bg-green-500/15 text-green-700 dark:text-green-400"
                : "border-black/15 text-black/45 hover:bg-black/[0.03] dark:border-white/15 dark:text-white/45 dark:hover:bg-white/[0.04]"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                perkOn ? "bg-green-500" : "bg-black/25 dark:bg-white/25"
              }`}
            />
            Perk {perkOn ? "on" : "off"}
          </button>
          <div className="flex items-center gap-1">
            <span className="text-xs text-black/45 dark:text-white/45">Used $</span>
            <input
              value={logValue}
              onChange={(e) => setLogValue(e.target.value.replace(/[^\d.]/g, ""))}
              inputMode="decimal"
              placeholder="0"
              className="w-16 rounded border border-black/15 bg-transparent px-1.5 py-0.5 text-xs outline-none focus:border-black/40 dark:border-white/15 dark:focus:border-white/40"
            />
            <button
              onClick={() => {
                const n = Number(logValue);
                if (Number.isFinite(n) && n >= 0) patch(n);
              }}
              disabled={busy}
              className="rounded border border-black/15 px-1.5 py-0.5 text-xs hover:bg-black/[0.03] disabled:opacity-50 dark:border-white/15 dark:hover:bg-white/[0.04]"
            >
              Save
            </button>
            {benefit.source === "manual" && (
              <button
                onClick={() => {
                  setLogValue("");
                  patch(null);
                }}
                disabled={busy}
                className="text-xs text-black/45 hover:text-foreground disabled:opacity-50 dark:text-white/45"
                title={canAuto ? "Revert to auto-tracking from transactions" : "Clear the logged amount"}
              >
                {canAuto ? "Auto" : "Clear"}
              </button>
            )}
          </div>
          <button
            onClick={del}
            disabled={busy}
            aria-label="Delete benefit"
            className="text-black/30 hover:text-red-600 disabled:opacity-50 dark:text-white/30 dark:hover:text-red-400"
          >
            ✕
          </button>
        </div>
      </div>

      <YearStrip benefit={benefit} onChanged={onChanged} />
    </div>
  );
}

function YearStrip({
  benefit,
  onChanged,
}: {
  benefit: BenefitDTO;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);

  // A single-window period (ANNUAL) adds nothing beyond the bar above.
  if (benefit.yearBreakdown.length <= 1) return null;

  const elapsed = benefit.yearBreakdown.filter((w) => !w.future);
  const capturedCount = elapsed.filter((w) => w.captured).length;

  // Click cycles a window: auto → pinned (flip captured state) → back to auto.
  async function toggle(w: BenefitDTO["yearBreakdown"][number]) {
    setBusy(true);
    const value = w.manual ? null : w.captured ? 0 : w.target;
    await fetch(`/api/benefits/${benefit.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ periodKey: w.key, value }),
    });
    setBusy(false);
    onChanged();
  }

  const cellClass = (w: BenefitDTO["yearBreakdown"][number]) => {
    const ring = w.manual ? " ring-2 ring-inset ring-indigo-400/70" : "";
    if (w.captured)
      return "border-green-500/30 bg-green-500/15 text-green-700 dark:text-green-400" + ring;
    if (w.used > 0)
      return "border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-400" + ring;
    if (w.future && !w.manual)
      return "border-dashed border-black/15 text-black/25 dark:border-white/15 dark:text-white/25";
    return "border-black/10 text-black/35 dark:border-white/10 dark:text-white/35" + ring;
  };

  return (
    <div className="mt-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-black/40 dark:text-white/40">
          This year{" "}
          <span className="text-black/30 dark:text-white/30">· click a month to override</span>
        </span>
        <span className="text-[11px] tabular-nums text-black/40 dark:text-white/40">
          {capturedCount}/{elapsed.length} captured · {formatCurrency(benefit.ytdCaptured)} of{" "}
          {formatCurrency(benefit.yearTarget)}
        </span>
      </div>
      <div className="mt-1 flex gap-1">
        {benefit.yearBreakdown.map((w) => (
          <button
            key={w.key}
            onClick={() => toggle(w)}
            disabled={busy}
            title={`${w.label}: ${formatCurrency(w.used)} / ${formatCurrency(w.target)}${w.manual ? " (manual)" : ""}${w.future ? " · upcoming" : w.captured ? " ✓" : ""}\nClick to ${w.manual ? "clear override" : w.captured ? "mark not captured" : "mark captured"}`}
            className={`flex-1 rounded border py-1 text-center text-[10px] font-medium transition-colors hover:brightness-110 disabled:opacity-50 ${cellClass(w)}`}
          >
            {w.short}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * What the card actually earned on the spending routed through it.
 *
 * Shown apart from the credits-vs-fee bar on purpose. Gross points are not
 * comparable to a statement credit: you'd have earned points on that spending
 * whatever card you used, so folding them into the fee bar would make any card
 * look like it pays for itself. The number that means something is the last one
 * — what this card returned *over* the next-best card you hold on the very same
 * transactions. A negative figure means another card in your wallet would have
 * done better.
 */
function EarningsSection({
  card,
  onChanged,
}: {
  card: UserCardDTO;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [cppInput, setCppInput] = useState(String(card.pointValueCents));
  const [busy, setBusy] = useState(false);

  const e = card.earnings;

  async function saveCpp() {
    const n = Number(cppInput);
    if (!Number.isFinite(n) || n <= 0) return;
    setBusy(true);
    await fetch(`/api/user-cards/${card.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pointValueCents: n }),
    });
    setEditing(false);
    setBusy(false);
    onChanged();
  }

  const isPoints = e?.unit === "X";
  const fmtEarned = (n: number) =>
    isPoints ? `${Math.round(n).toLocaleString()} pts` : formatCurrency(n);

  return (
    <div className="border-b border-black/10 px-4 py-3 dark:border-white/10">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-black/45 dark:text-white/45">
          Points earned
        </span>
        <span className="text-xs text-black/40 dark:text-white/40">
          {card.earningsPeriodLabel}
        </span>
      </div>

      {!e ? (
        <p className="mt-2 text-xs text-black/45 dark:text-white/45">
          Link this card to an account to estimate what it earns.
        </p>
      ) : e.byCategory.length === 0 ? (
        <p className="mt-2 text-xs text-black/45 dark:text-white/45">
          No spending on this card in this window yet.
        </p>
      ) : (
        <>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-black/40 dark:text-white/40">
                  <th className="pb-1 text-left font-medium">Category</th>
                  <th className="pb-1 text-right font-medium">Spend</th>
                  <th className="pb-1 text-right font-medium">Rate</th>
                  <th className="pb-1 text-right font-medium">Earned</th>
                  <th className="pb-1 text-right font-medium">vs. next best</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.06] dark:divide-white/[0.06]">
                {e.byCategory.map((r) => (
                  <EarningsRow key={r.category} row={r} isPoints={isPoints} />
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-black/10 pt-2 dark:border-white/10">
            <span className="text-xs text-black/50 dark:text-white/50">
              {formatCurrency(e.totalSpend)} spent ·{" "}
              <span className="font-mono tabular-nums text-sky-700 dark:text-sky-400">
                {fmtEarned(e.totalEarned)}
              </span>
              {isPoints && ` ≈ ${formatCurrency(e.totalValue)}`}
            </span>
            <span
              className={`font-mono text-sm tabular-nums ${
                e.incrementalValue >= 0
                  ? "text-sky-700 dark:text-sky-400"
                  : "text-amber-700 dark:text-amber-400"
              }`}
              title="What this card earned beyond the best alternative card you hold, on the same transactions"
            >
              {e.incrementalValue >= 0 ? "+" : "−"}
              {formatCurrency(Math.abs(e.incrementalValue))} vs. next best
            </span>
          </div>

          {isPoints && (
            <div className="mt-1.5 text-[11px] text-black/40 dark:text-white/40">
              {editing ? (
                <span className="flex items-center gap-1">
                  Point worth
                  <input
                    value={cppInput}
                    onChange={(ev) => setCppInput(ev.target.value.replace(/[^\d.]/g, ""))}
                    inputMode="decimal"
                    autoFocus
                    className="w-14 rounded border border-black/15 bg-transparent px-1.5 py-0.5 outline-none focus:border-black/40 dark:border-white/15 dark:focus:border-white/40"
                  />
                  ¢
                  <button
                    onClick={saveCpp}
                    disabled={busy}
                    className="rounded border border-black/15 px-1.5 py-0.5 hover:bg-black/[0.03] disabled:opacity-50 dark:border-white/15 dark:hover:bg-white/[0.04]"
                  >
                    Save
                  </button>
                </span>
              ) : (
                <button
                  onClick={() => {
                    setCppInput(String(card.pointValueCents));
                    setEditing(true);
                  }}
                  className="hover:text-foreground"
                  title="Only used to compare against cards that pay cashback"
                >
                  Valued at {card.pointValueCents}¢ per point · Edit
                </button>
              )}
              {" · estimated from categories, before caps and exclusions"}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function EarningsRow({ row, isPoints }: { row: EarningsCategoryDTO; isPoints: boolean }) {
  return (
    <tr>
      <td className="py-1">
        {row.categoryLabel}
        {!row.isBonus && (
          <span className="ml-1 text-[11px] text-black/35 dark:text-white/35">base</span>
        )}
      </td>
      <td className="py-1 text-right font-mono text-xs tabular-nums text-black/60 dark:text-white/60">
        {formatCurrency(row.spend)}
      </td>
      <td className="py-1 text-right font-mono text-xs tabular-nums text-black/60 dark:text-white/60">
        {row.rate}
      </td>
      <td className="py-1 text-right font-mono text-xs tabular-nums">
        {isPoints ? Math.round(row.earned).toLocaleString() : formatCurrency(row.earned)}
      </td>
      <td
        className={`py-1 text-right font-mono text-xs tabular-nums ${
          row.vsBest > 0
            ? "text-sky-700 dark:text-sky-400"
            : row.vsBest < 0
              ? "text-amber-700 dark:text-amber-400"
              : "text-black/35 dark:text-white/35"
        }`}
        title={row.bestAlternative ? `Best alternative: ${row.bestAlternative}` : undefined}
      >
        {row.vsBest === 0
          ? "—"
          : `${row.vsBest > 0 ? "+" : "−"}${formatCurrency(Math.abs(row.vsBest))}`}
      </td>
    </tr>
  );
}

function RatesSection({
  card,
  onChanged,
}: {
  card: UserCardDTO;
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  async function delRate(id: string) {
    setBusy(true);
    await fetch(`/api/rewards/${id}`, { method: "DELETE" });
    onChanged();
  }

  return (
    <div className="mt-2">
      {card.rewardRates.length === 0 ? (
        <p className="text-xs text-black/45 dark:text-white/45">
          No earning rates yet — add one below, or re-add this card from a preset.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {card.rewardRates.map((r) => (
            <span
              key={r.id}
              title={r.notes ?? undefined}
              className="inline-flex items-center gap-1.5 rounded-md border border-black/10 px-2 py-1 text-xs dark:border-white/10"
            >
              <span className="font-medium">{r.categoryLabel}</span>
              <span className="font-mono tabular-nums">{r.display}</span>
              {r.notes && <span className="text-black/35 dark:text-white/35">*</span>}
              <button
                onClick={() => delRate(r.id)}
                disabled={busy}
                aria-label={`Delete ${r.categoryLabel} rate`}
                className="text-black/30 hover:text-red-600 disabled:opacity-50 dark:text-white/30 dark:hover:text-red-400"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      {adding ? (
        <AddRateForm
          cardId={card.id}
          onDone={() => {
            setAdding(false);
            onChanged();
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="mt-2 text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
        >
          + Add / override rate
        </button>
      )}
    </div>
  );
}

function AddRateForm({
  cardId,
  onDone,
  onCancel,
}: {
  cardId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [category, setCategory] = useState("DINING");
  const [multiplier, setMultiplier] = useState("");
  const [unit, setUnit] = useState("X");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const res = await fetch("/api/rewards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userCardId: cardId,
        category,
        multiplier: Number(multiplier),
        unit,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Failed to save rate");
      return;
    }
    onDone();
  }

  const small =
    "rounded-md border border-black/15 bg-transparent px-2 py-1 text-xs outline-none focus:border-black/40 dark:border-white/15 dark:focus:border-white/40";

  return (
    <form onSubmit={submit} className="mt-2 flex flex-wrap items-center gap-2">
      <select
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        className={small}
      >
        {REWARD_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {REWARD_CATEGORY_LABELS[c]}
          </option>
        ))}
      </select>
      <input
        value={multiplier}
        onChange={(e) => setMultiplier(e.target.value.replace(/[^\d.]/g, ""))}
        placeholder="Rate"
        inputMode="decimal"
        required
        className={`w-16 ${small}`}
      />
      <select value={unit} onChange={(e) => setUnit(e.target.value)} className={small}>
        <option value="X">x points</option>
        <option value="PERCENT">% cash</option>
      </select>
      <button
        type="submit"
        disabled={busy}
        className="rounded-md bg-foreground px-2.5 py-1 text-xs font-medium text-background hover:opacity-90 disabled:opacity-50"
      >
        Save
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="text-xs text-black/50 hover:text-foreground dark:text-white/50"
      >
        Cancel
      </button>
      {error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}
    </form>
  );
}

function AddBenefitForm({
  cardId,
  onDone,
  onCancel,
}: {
  cardId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [period, setPeriod] = useState<string>("ANNUAL");
  const [category, setCategory] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const res = await fetch("/api/benefits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userCardId: cardId,
        name,
        amount: Number(amount),
        period,
        category: category || null,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Failed to add benefit");
      return;
    }
    onDone();
  }

  return (
    <form
      onSubmit={submit}
      className="border-t border-black/10 bg-black/[0.015] px-4 py-3 dark:border-white/10 dark:bg-white/[0.02]"
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Benefit name (e.g. Airline Fee Credit)"
          required
          className={inputClass}
        />
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
          placeholder="Amount ($)"
          inputMode="decimal"
          required
          className={inputClass}
        />
        <select
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          className={inputClass}
        >
          {BENEFIT_PERIODS.map((p) => (
            <option key={p} value={p}>
              {PERIOD_LABELS[p]}
            </option>
          ))}
        </select>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className={inputClass}
        >
          <option value="">Track manually (no category)</option>
          {TRACKABLE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {humanizePfc(c)} spending
            </option>
          ))}
        </select>
      </div>
      {error && (
        <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
      <div className="mt-2.5 flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Adding…" : "Add benefit"}
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
