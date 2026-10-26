"use client";

import { useState } from "react";
import type { RewardRateDTO, UserCardDTO } from "@/types";
import { ISSUER_LABELS } from "@/lib/categories";

const labelClass = "text-xs font-medium text-muted2";

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

// Parse a user-entered number, treating blanks/garbage as 0.
function num(raw: string): number {
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : 0;
}

function cardLabel(c: UserCardDTO): string {
  if (c.displayName) return `${c.displayName} ••${c.last4}`;
  const issuer = ISSUER_LABELS[c.issuer] ?? c.issuer;
  return `${issuer} ${c.name ?? ""} ••${c.last4}`.replace(/\s+/g, " ").trim();
}

// The rate a flight purchase earns through the issuer's travel portal: the
// card's travel category if it has one, otherwise its best everyday rate.
// (Stored TRAVEL rates here are the boosted portal rates, e.g. Chase 5x.)
function flightRate(card: UserCardDTO): RewardRateDTO | undefined {
  const travel = card.rewardRates.find((r) => r.category === "TRAVEL");
  if (travel) return travel;
  // Fall back to the best everyday rate, but ignore rotating quarterly
  // categories — they don't reliably cover flights.
  const everyday = card.rewardRates.filter((r) => r.category !== "ROTATING");
  return everyday.sort((a, b) => b.multiplier - a.multiplier)[0];
}

// Rate for a flight bought DIRECT from the airline (not the issuer portal).
// Chase Ultimate Rewards cards only earn their boosted travel rate through
// Chase Travel — booked direct, Sapphire earns 2x and Freedom earns nothing
// extra. Other cards (e.g. Amex Gold at 3x on flights) earn the same either way.
function directFlightMultiplier(card: UserCardDTO): number {
  const name = (card.name ?? "").toLowerCase();
  if (card.issuer === "CHASE") {
    if (name.includes("sapphire")) return 2;
    if (name.includes("freedom")) return 1;
  }
  return flightRate(card)?.multiplier ?? 1;
}

// A sensible default value per point (in cents) for a card's program. Cash-back
// programs and Chase's cash-back cards are worth exactly 1¢. Chase Sapphire
// points transfer to partners / use Points Boost for up to ~50% more (≈1.5¢).
// Amex Membership Rewards redeem at ~1¢ through Amex Travel (more via transfer).
// Editable per side, since how you redeem is up to you.
function defaultCpp(card: UserCardDTO): string {
  const name = (card.name ?? "").toLowerCase();
  if (card.issuer === "CHASE" && name.includes("sapphire")) return "1.5";
  return "1";
}

export function FlightComparison({ cards }: { cards: UserCardDTO[] }) {
  // Two ways to buy the same flight; each can be paid with a card that earns.
  // Point value (cents per point) is per side, since the two cards' programs
  // can be worth different amounts.
  const [airlinePrice, setAirlinePrice] = useState("");
  const [airlineEarn, setAirlineEarn] = useState("1");
  const [airlineCardId, setAirlineCardId] = useState("");
  const [airlineCpp, setAirlineCpp] = useState("1");
  const [portalPrice, setPortalPrice] = useState("");
  const [portalEarn, setPortalEarn] = useState("5");
  const [portalCardId, setPortalCardId] = useState("");
  const [portalCpp, setPortalCpp] = useState("1");
  // Optional helper: work out cents-per-point from a redemption.
  const [showCpp, setShowCpp] = useState(false);

  // Resolve one side into rewards + net cost. The earn field is a plain number;
  // the selected card's flight rate decides whether it means "Nx points" (worth
  // N × that side's point value) or "N% cash back" (a flat N cents).
  function sideResult(
    cardId: string,
    earnRaw: string,
    priceRaw: string,
    cppRaw: string
  ) {
    const card = cards.find((c) => c.id === cardId);
    const rate = card ? flightRate(card) : undefined;
    const isPercent = rate?.unit === "PERCENT";
    const ppv = num(cppRaw) / 100; // dollars per point
    const cash = num(priceRaw);
    const earn = num(earnRaw);
    const perDollar = isPercent ? earn / 100 : earn * ppv;
    const reward = cash * perDollar;
    const points = isPercent ? 0 : cash * earn;
    return { rate, isPercent, cash, reward, points, net: cash - reward };
  }

  // Selecting a card auto-fills that side's earn rate and point value. The
  // airline side uses the direct-from-airline rate; the portal side uses the
  // boosted travel-portal rate.
  function pickCard(
    id: string,
    isPortal: boolean,
    setId: (v: string) => void,
    setEarn: (v: string) => void,
    setCpp: (v: string) => void
  ) {
    setId(id);
    const card = cards.find((c) => c.id === id);
    if (!card) return;
    const multiplier = isPortal
      ? flightRate(card)?.multiplier
      : directFlightMultiplier(card);
    if (multiplier != null) setEarn(String(multiplier));
    setCpp(defaultCpp(card));
  }

  const airline = sideResult(airlineCardId, airlineEarn, airlinePrice, airlineCpp);
  const portal = sideResult(portalCardId, portalEarn, portalPrice, portalCpp);

  const hasInput = airline.cash > 0 || portal.cash > 0;
  const diff = airline.net - portal.net; // positive => portal cheaper
  const portalCheaper = diff > 0;

  return (
    <div className="group-panel p-4">
      <div className="text-sm font-medium">Flight price comparison</div>
      <p className="mt-1 text-xs text-muted2">
        Compare buying the same flight direct from the airline against your
        card&apos;s travel portal. Pick the card you&apos;d pay with on each side
        — net cost subtracts the value of the points it earns, so you see which
        is truly cheaper. The same card often earns a different rate in the
        portal than buying direct, so edit the rate if it differs.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <SideCard
          title="Airline website"
          cards={cards}
          cardId={airlineCardId}
          onCard={(id) => pickCard(id, false, setAirlineCardId, setAirlineEarn, setAirlineCpp)}
          price={airlinePrice}
          onPrice={setAirlinePrice}
          earn={airlineEarn}
          onEarn={setAirlineEarn}
          cpp={airlineCpp}
          onCpp={setAirlineCpp}
          result={airline}
          hasInput={hasInput}
          pricePlaceholder="450"
          earnPlaceholder="1"
        />
        <SideCard
          title="Card portal"
          cards={cards}
          cardId={portalCardId}
          onCard={(id) => pickCard(id, true, setPortalCardId, setPortalEarn, setPortalCpp)}
          price={portalPrice}
          onPrice={setPortalPrice}
          earn={portalEarn}
          onEarn={setPortalEarn}
          cpp={portalCpp}
          onCpp={setPortalCpp}
          result={portal}
          hasInput={hasInput}
          pricePlaceholder="465"
          earnPlaceholder="5"
        />
      </div>

      <div className="mt-3">
        <button
          type="button"
          onClick={() => setShowCpp((v) => !v)}
          className="text-xs font-medium text-accent hover:underline"
        >
          {showCpp ? "Hide point-value help" : "How is point value set?"}
        </button>
      </div>

      {showCpp && (
        <CppHelper onApply={(v) => { setAirlineCpp(v); setPortalCpp(v); }} />
      )}

      {hasInput && (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <ResultCard
            label="Airline website (net cost)"
            value={money(airline.net)}
            winner={!portalCheaper}
          />
          <ResultCard
            label="Card portal (net cost)"
            value={money(portal.net)}
            winner={portalCheaper}
          />
          <div className="sm:col-span-2 rounded-lg bg-background px-3 py-2 text-sm">
            {Math.abs(diff) < 0.005 ? (
              <>It&apos;s a wash — both net out to about the same.</>
            ) : (
              <>
                <strong>
                  {portalCheaper ? "Card portal" : "Airline website"}
                </strong>{" "}
                is cheaper by <strong>{money(Math.abs(diff))}</strong> after
                points.
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SideCard({
  title,
  cards,
  cardId,
  onCard,
  price,
  onPrice,
  earn,
  onEarn,
  cpp,
  onCpp,
  result,
  hasInput,
  pricePlaceholder,
  earnPlaceholder,
}: {
  title: string;
  cards: UserCardDTO[];
  cardId: string;
  onCard: (id: string) => void;
  price: string;
  onPrice: (v: string) => void;
  earn: string;
  onEarn: (v: string) => void;
  cpp: string;
  onCpp: (v: string) => void;
  result: { rate?: RewardRateDTO; isPercent: boolean; points: number; reward: number };
  hasInput: boolean;
  pricePlaceholder: string;
  earnPlaceholder: string;
}) {
  const { rate, isPercent, points, reward } = result;
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-background p-3">
      <div className="text-sm font-medium">{title}</div>
      <Field label="Cash price ($)">
        <input
          value={price}
          onChange={(e) => onPrice(e.target.value)}
          placeholder={pricePlaceholder}
          inputMode="decimal"
          className="field mt-1 w-full"
        />
      </Field>

      {cards.length > 0 && (
        <Field label="Pay with card">
          <select
            value={cardId}
            onChange={(e) => onCard(e.target.value)}
            className="field mt-1 w-full"
          >
            <option value="">Enter rate manually</option>
            {cards.map((c) => (
              <option key={c.id} value={c.id}>
                {cardLabel(c)}
              </option>
            ))}
          </select>
        </Field>
      )}

      <Field label={isPercent ? "Cash back per $ (%)" : "Points earned per $"}>
        <input
          value={earn}
          onChange={(e) => onEarn(e.target.value)}
          placeholder={earnPlaceholder}
          inputMode="decimal"
          className="field mt-1 w-full"
        />
      </Field>

      {cardId && rate?.notes && (
        <p className="text-xs text-muted2">
          {rate.notes} — edit above if your rate differs here.
        </p>
      )}

      {isPercent ? (
        <p className="text-xs text-muted2">
          Cash back is worth a flat 1¢ each, so point value doesn&apos;t apply.
        </p>
      ) : (
        <Field label="Point value (¢ per point)">
          <input
            value={cpp}
            onChange={(e) => onCpp(e.target.value)}
            placeholder="1.5"
            inputMode="decimal"
            className="field mt-1 w-full"
          />
        </Field>
      )}

      {hasInput && (
        <Earned
          text={isPercent ? "Earns cash back" : `Earns ${points.toLocaleString("en-US")} pts`}
          value={reward}
        />
      )}
    </div>
  );
}

// Works out cents-per-point from a real redemption: the cash price a booking
// would cost, divided by the points it asks for. This is the honest value of a
// point *for that redemption* — the number to plug into the tool.
function CppHelper({ onApply }: { onApply: (value: string) => void }) {
  const [cash, setCash] = useState("");
  const [points, setPoints] = useState("");

  const c = num(cash);
  const p = num(points);
  const cpp = p > 0 ? (c * 100) / p : 0;
  const rounded = cpp > 0 ? cpp.toFixed(2) : "";

  return (
    <div className="mt-2 rounded-lg bg-background p-3 text-xs">
      <p className="text-muted2">
        Each side&apos;s point value is pre-filled from its card: cash back and
        standard portal redemptions are <strong>1.0¢</strong>; Chase Sapphire
        points transfer / Points Boost for up to ~50% more (<strong>1.5¢</strong>).
        To nail down a specific redemption, cents per point = its cash price ÷
        the points it costs, ×100:
      </p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Field label="Cash price ($)">
          <input
            value={cash}
            onChange={(e) => setCash(e.target.value)}
            placeholder="450"
            inputMode="decimal"
            className="field mt-1 w-full"
          />
        </Field>
        <Field label="Points it costs">
          <input
            value={points}
            onChange={(e) => setPoints(e.target.value)}
            placeholder="30000"
            inputMode="decimal"
            className="field mt-1 w-full"
          />
        </Field>
      </div>
      {cpp > 0 && (
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-muted2">
            = <strong>{rounded}¢</strong> per point
          </span>
          <button
            type="button"
            onClick={() => onApply(rounded)}
            className="btn btn-primary"
          >
            Use for both sides
          </button>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className={labelClass}>{label}</span>
      {children}
    </div>
  );
}

function Earned({ text, value }: { text: string; value: number }) {
  return (
    <div className="mt-1 text-xs text-muted2">
      {text}
      {value > 0 && ` (${money(value)} value)`}
    </div>
  );
}

function ResultCard({
  label,
  value,
  winner,
}: {
  label: string;
  value: string;
  winner: boolean;
}) {
  return (
    <div
      className={`rounded-lg p-3 ${winner ? "bg-pos/15" : "bg-background"}`}
    >
      <div className="text-xs text-muted2">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums">{value}</div>
      {winner && (
        <div className="mt-0.5 text-xs font-medium text-pos">
          Cheaper
        </div>
      )}
    </div>
  );
}
