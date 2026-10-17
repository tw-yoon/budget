/**
 * Placement rules: which statement-credit transactions fill which card perk.
 * Import-free so `node:test` can load it directly (like links.ts).
 * Plaid sign convention: a credit is money in, amount < 0.
 */

export interface CreditRow {
  id: string; accountId: string; date: Date; amount: number; // < 0
  name: string; merchantName: string | null; pfcDetailed: string | null;
  pending: boolean; isFee: boolean;
  decision: "YES" | "NO" | null; // owner's answer
  benefitId: string | null;      // YES: the perk; NO: the perk refused (null = not a perk at all)
}
export interface PerkInput {
  id: string; accountId: string; amount: number; period: string; keywords: string[];
}
export interface Placed { benefitId: string; how: "auto" | "confirmed"; windowKey: string }
export interface PerkQuestion { transactionId: string; suggestedBenefitId: string | null; windowFull: boolean }
export interface Placement { placed: Map<string, Placed>; questions: PerkQuestion[] }

const CENT = 0.005;

/** True when any non-empty keyword is contained in the row's name or merchant, case-insensitively. */
export function matchesKeyword(keywords: string[], r: { name: string; merchantName: string | null }): boolean {
  const hay = [r.name, r.merchantName ?? ""].map((s) => s.toLowerCase());
  return keywords.some((k) => k !== "" && hay.some((h) => h.includes(k.toLowerCase())));
}

export function isCreditCandidate(
  r: Pick<CreditRow, "amount" | "pending" | "isFee" | "pfcDetailed">
): boolean {
  const pfc = r.pfcDetailed ?? "";
  return (
    r.amount < 0 && !r.pending && !r.isFee &&
    !pfc.endsWith("CREDIT_CARD_PAYMENT") && !pfc.startsWith("LOAN_DISBURSEMENTS")
  );
}

export function placeCredits(
  perks: PerkInput[],
  rows: CreditRow[],
  windowKey: (period: string, date: Date) => string,
  askSince: Date,
): Placement {
  const placed = new Map<string, Placed>();
  const questions: PerkQuestion[] = [];
  const sums = new Map<string, number>();
  const byId = new Map(perks.map((p) => [p.id, p]));
  const sumOf = (p: PerkInput, wk: string) => sums.get(`${p.id}|${wk}`) ?? 0;
  const add = (p: PerkInput, wk: string, v: number) => sums.set(`${p.id}|${wk}`, sumOf(p, wk) + v);

  const ordered = [...rows].sort((a, b) => a.date.getTime() - b.date.getTime());
  for (const r of ordered) {
    const value = -r.amount;
    const confirmed = r.decision === "YES" && r.benefitId ? byId.get(r.benefitId) : undefined;
    if (confirmed) {
      const wk = windowKey(confirmed.period, r.date);
      placed.set(r.id, { benefitId: confirmed.id, how: "confirmed", windowKey: wk });
      add(confirmed, wk, value);
      continue;
    }
    if (r.decision === "NO" && r.benefitId === null) continue;

    const eligible = perks.filter(
      (p) => p.accountId === r.accountId && !(r.decision === "NO" && p.id === r.benefitId)
    );
    const matches = eligible.filter((p) => matchesKeyword(p.keywords, r));

    if (matches.length === 1) {
      const p = matches[0];
      const wk = windowKey(p.period, r.date);
      if (p.amount - sumOf(p, wk) > CENT) {
        placed.set(r.id, { benefitId: p.id, how: "auto", windowKey: wk });
        add(p, wk, value);
        continue;
      }
    }

    if (r.date < askSince) continue;
    const equal = eligible.find((p) => Math.abs(value - p.amount) < CENT);
    const looksLikeCredit = r.name.toLowerCase().includes("credit") || equal !== undefined || matches.length > 0;
    if (!looksLikeCredit) continue;
    const suggested = matches[0] ?? equal ?? null;
    questions.push({
      transactionId: r.id,
      suggestedBenefitId: suggested?.id ?? null,
      windowFull:
        matches.length > 0 && matches[0].amount - sumOf(matches[0], windowKey(matches[0].period, r.date)) <= CENT,
    });
  }
  return { placed, questions };
}

const GENERIC_WORDS = new Set(["credit", "statement", "refund", "amex", "american", "express", "chase", "discover"]);

/** Too broad to learn: under 4 letters, or only issuer/credit words plus digits and punctuation. */
function isGenericKeyword(k: string): boolean {
  const words = k.toLowerCase().match(/[a-z]+/g) ?? [];
  return words.join("").length < 4 || words.every((w) => GENERIC_WORDS.has(w));
}

/** The keyword a "yes" teaches its perk, or "" when it would be too generic to learn. */
export function learnKeyword(r: Pick<CreditRow, "name" | "merchantName">): string {
  const merchant = (r.merchantName ?? "").trim();
  const tokens = r.name.replace(/^\s*(AMEX|CHASE|DISCOVER)\b/i, "").trim().split(/\s+/);
  while (tokens.length > 0 && /\d/.test(tokens[tokens.length - 1])) tokens.pop();
  const k = merchant || tokens.join(" ");
  return isGenericKeyword(k) ? "" : k;
}

export interface PurchaseRow { id: string; date: Date; amount: number; name: string; merchantName: string | null }
export interface RankedPurchase extends PurchaseRow { strong: boolean }
export const PAIR_WINDOW_DAYS = 45;

const DAY = 86_400_000;

export function rankPurchases(
  credit: { date: Date; amount: number },
  purchases: PurchaseRow[],
  perk: { keywords: string[]; pairedMerchants: string[] },
): RankedPurchase[] {
  const merchants = perk.pairedMerchants.map((m) => m.toLowerCase());
  // Round so DST-shifted midnights still count whole days.
  const gap = (p: PurchaseRow) => Math.round((credit.date.getTime() - p.date.getTime()) / DAY);
  return purchases
    .filter((p) => p.amount >= -credit.amount - CENT && gap(p) >= 0 && gap(p) <= PAIR_WINDOW_DAYS)
    .map((p) => {
      const paired = merchants.includes((p.merchantName ?? p.name).toLowerCase());
      return { p, paired, strong: paired || matchesKeyword(perk.keywords, p) };
    })
    .sort((a, b) => Number(b.paired) - Number(a.paired) || Number(b.strong) - Number(a.strong) || gap(a.p) - gap(b.p))
    .map(({ p, strong }) => ({ ...p, strong }));
}

/** A placed credit auto-pairing may link: unlinked, not unpaired by the owner, category not set by hand. */
export function canAutoPair(r: { linkedToId: string | null; noAutoPair: boolean; userCategorySource: string | null }): boolean {
  return r.linkedToId === null && !r.noAutoPair && r.userCategorySource !== "MANUAL";
}

/** Purchases a credit may pair with: not linked themselves and not already offset by a refund. */
export function openPurchases<T extends { id: string; linkedToId: string | null }>(purchases: T[], refunded: Set<string>): T[] {
  return purchases.filter((p) => p.linkedToId === null && !refunded.has(p.id));
}

export function pickAutoPair(ranked: RankedPurchase[]): string | null {
  const strong = ranked.filter((r) => r.strong);
  return strong.length === 1 ? strong[0].id : null;
}

/** Appends a trimmed value unless it is empty or already present (case-insensitive). */
export function appendUnique(list: string[], value: string): string[] {
  const v = value.trim();
  if (v === "" || list.some((x) => x.toLowerCase() === v.toLowerCase())) return list;
  return [...list, v];
}

export type PerkAnswer = { decision: "YES"; benefitId: string } | { decision: "NO"; benefitId: string | null };

export const MAX_KEYWORDS = 20;
export const MAX_KEYWORD_LENGTH = 60;

/** `matchText` of PATCH /api/benefits/:id: trimmed, deduped keywords, or an error message. */
export function parseKeywords(value: unknown): string[] | { error: string } {
  if (!Array.isArray(value) || value.some((k) => typeof k !== "string")) return { error: "matchText must be a list of keywords" };
  let list: string[] = [];
  for (const raw of value as string[]) {
    const k = raw.trim();
    if (k === "") return { error: "Keywords can't be empty" };
    if (k.length > MAX_KEYWORD_LENGTH) return { error: `Keywords must be ${MAX_KEYWORD_LENGTH} characters or fewer` };
    if (isGenericKeyword(k)) return { error: `"${k}" is too generic to match credits` };
    list = appendUnique(list, k);
  }
  if (list.length > MAX_KEYWORDS) return { error: `At most ${MAX_KEYWORDS} keywords` };
  return list;
}

/** Body of PUT /api/perk-credits/:id, or null when malformed. */
export function parsePerkAnswer(body: unknown): PerkAnswer | null {
  if (!body || typeof body !== "object") return null;
  const { decision, benefitId } = body as Record<string, unknown>;
  const id = typeof benefitId === "string" && benefitId !== "" ? benefitId : undefined;
  if (decision === "yes" && id) return { decision: "YES", benefitId: id };
  if (decision === "no" && (id || benefitId === null)) return { decision: "NO", benefitId: id ?? null };
  return null;
}

/** Body of PUT /api/perk-credits/:id/purchase: the purchase id, null to unlink, undefined when malformed. */
export function parsePurchasePick(body: unknown): string | null | undefined {
  if (!body || typeof body !== "object") return undefined;
  const { purchaseId } = body as Record<string, unknown>;
  if (purchaseId === null) return null;
  return typeof purchaseId === "string" && purchaseId !== "" ? purchaseId : undefined;
}
