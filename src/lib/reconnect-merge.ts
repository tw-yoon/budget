/**
 * Reconnecting a bank merges its history
 * (docs/superpowers/specs/2026-10-02-reconnect-merges-history-design.md).
 *
 * A reconnected bank is a new Plaid Item with new account and transaction ids.
 * These rules pair the disconnected bank's accounts with the new connection's,
 * find the transactions both connections recorded, and decide what each
 * survivor keeps. Nothing merges without the owner's confirm: the preview
 * suggests, the confirm re-checks every pair it is sent.
 *
 * No Prisma import here: the routes hand in a store, so
 * scripts/test-reconnect-merge.mjs can run the rules against fakes.
 */

import type { PlaidItemRow } from "@/lib/plaid-items";

// ─── Rows ────────────────────────────────────────────────────────────────────

export interface MergeAccount {
  id: string;
  itemId: string;
  name: string;
  mask: string | null;
  type: string;
  subtype: string | null;
  displayName: string | null;
  manualDueDay: number | null;
  manualCreditLimit: number | null;
  transactionCount: number;
}

export interface MergeTx {
  id: string;
  accountId: string;
  externalId: string;
  source: string;
  label: number | null;
  amount: number;
  date: Date;
  name: string;
  merchantName: string | null;
  pending: boolean;
  priorItemId: string | null;
  userCategory: string | null;
  userCategorySource: string | null;
  personalNote: string | null;
  counterparty: string | null;
  linkedToId: string | null;
  fundsCashoutId: string | null;
  splitCount: number;
}

export interface AccountPair {
  from: string; // the disconnected bank's account (survives)
  to: string; // the connected bank's account (folded in, then deleted)
}

export interface DuplicatePair {
  keep: string; // the old connection's row (survives)
  drop: string; // the new connection's row (folded in, then deleted)
}

export interface Candidate {
  old: MergeTx;
  new: MergeTx;
  days: number;
  similarity: number;
  confident: boolean;
}

// ─── Accounts ────────────────────────────────────────────────────────────────

const accountKey = (a: MergeAccount) =>
  a.mask ? `${a.type}|${a.subtype ?? ""}|${a.mask}` : null;

/**
 * Suggested pairs: same type, subtype and mask, unique on both sides. No mask,
 * or two candidates on either side, leaves the account for the owner.
 */
export function suggestAccountPairs(
  oldAccounts: MergeAccount[],
  newAccounts: MergeAccount[]
): AccountPair[] {
  const count = (list: MergeAccount[]) => {
    const m = new Map<string, MergeAccount[]>();
    for (const a of list) {
      const k = accountKey(a);
      if (k) m.set(k, [...(m.get(k) ?? []), a]);
    }
    return m;
  };
  const olds = count(oldAccounts);
  const news = count(newAccounts);
  const pairs: AccountPair[] = [];
  for (const [k, os] of olds) {
    const ns = news.get(k);
    if (os.length === 1 && ns?.length === 1) pairs.push({ from: os[0].id, to: ns[0].id });
  }
  return pairs;
}

/** An error message, or null when every pair is allowed. */
export function checkAccountPairs(
  pairs: AccountPair[],
  oldAccounts: MergeAccount[],
  newAccounts: MergeAccount[]
): string | null {
  const olds = new Map(oldAccounts.map((a) => [a.id, a]));
  const news = new Map(newAccounts.map((a) => [a.id, a]));
  const seenFrom = new Set<string>();
  const seenTo = new Set<string>();
  for (const p of pairs) {
    const o = olds.get(p.from);
    const n = news.get(p.to);
    if (!o) return `Account ${p.from} is not an unmerged account of the disconnected bank`;
    if (!n) return `Account ${p.to} is not an account of the connected bank`;
    if (o.type !== n.type) return `${o.name} and ${n.name} are different kinds of account`;
    if (seenFrom.has(p.from) || seenTo.has(p.to)) return "An account can be merged only once";
    seenFrom.add(p.from);
    seenTo.add(p.to);
  }
  return null;
}

// ─── Transactions ────────────────────────────────────────────────────────────

export const DATE_WINDOW_DAYS = 3;
export const MIN_SIMILARITY = 0.5;

const DAY = 86_400_000;
const cents = (n: number) => Math.round(n * 100);

// Letters only: store numbers and reference numbers differ between two
// renderings of one transaction more often than the words do.
function words(s: string | null): Set<string> {
  return new Set(
    (s ?? "")
      .toLowerCase()
      .replace(/[^a-z]+/g, " ")
      .split(" ")
      .filter((w) => w.length >= 2)
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / (a.size + b.size - shared);
}

/** 1 for the same merchant; else the share of description words in common. */
export function nameSimilarity(
  a: Pick<MergeTx, "name" | "merchantName">,
  b: Pick<MergeTx, "name" | "merchantName">
): number {
  const ma = [...words(a.merchantName)].join(" ");
  const mb = [...words(b.merchantName)].join(" ");
  if (ma && ma === mb) return 1;
  return Math.max(
    jaccard(words(a.name), words(b.name)),
    ma && mb ? jaccard(words(a.merchantName), words(b.merchantName)) : 0
  );
}

/** Whole days between two dates, ignoring the time of day. */
function dayGap(a: Date, b: Date): number {
  const d = (x: Date) => Math.floor(x.getTime() / DAY);
  return Math.abs(d(a) - d(b));
}

/**
 * Could `n` (new connection) be the same transaction as `o` (old connection)?
 * Plaid rows only; the new row must have posted, because Plaid replaces a
 * pending id with a new one when it posts.
 */
export function isCandidate(o: MergeTx, n: MergeTx): boolean {
  return (
    o.source === "PLAID" &&
    n.source === "PLAID" &&
    !n.pending &&
    cents(o.amount) === cents(n.amount) &&
    dayGap(o.date, n.date) <= DATE_WINDOW_DAYS &&
    nameSimilarity(o, n) >= MIN_SIMILARITY
  );
}

// Closer date first, then the more similar name.
const rank = (a: { days: number; similarity: number }, b: { days: number; similarity: number }) =>
  a.days - b.days || b.similarity - a.similarity;

/**
 * Every candidate pair between old and new rows that `group` puts on the same
 * merged account. A pair is confident when each row is the other's unique best
 * candidate; settling those can make a remaining pair unique, so it repeats.
 * Everything else is returned with confident: false, for the owner to judge.
 */
export function findDuplicates(
  oldRows: MergeTx[],
  newRows: MergeTx[],
  group: (row: MergeTx) => string
): Candidate[] {
  const byGroup = new Map<string, MergeTx[]>();
  for (const n of newRows) {
    const g = group(n);
    byGroup.set(g, [...(byGroup.get(g) ?? []), n]);
  }
  let open: Candidate[] = [];
  for (const o of oldRows) {
    for (const n of byGroup.get(group(o)) ?? []) {
      if (isCandidate(o, n)) {
        open.push({
          old: o,
          new: n,
          days: dayGap(o.date, n.date),
          similarity: nameSimilarity(o, n),
          confident: false,
        });
      }
    }
  }

  const confident: Candidate[] = [];
  for (;;) {
    const best = (key: (c: Candidate) => string) => {
      const m = new Map<string, Candidate[]>();
      for (const c of open) m.set(key(c), [...(m.get(key(c)) ?? []), c]);
      const out = new Map<string, Candidate>();
      for (const [k, list] of m) {
        list.sort(rank);
        if (list.length === 1 || rank(list[0], list[1]) < 0) out.set(k, list[0]);
      }
      return out;
    };
    const bestOld = best((c) => c.old.id);
    const bestNew = best((c) => c.new.id);
    const settled = open.filter(
      (c) => bestOld.get(c.old.id) === c && bestNew.get(c.new.id) === c
    );
    if (settled.length === 0) break;
    const used = new Set(settled.flatMap((c) => [c.old.id, c.new.id]));
    for (const c of settled) confident.push({ ...c, confident: true });
    open = open.filter((c) => !used.has(c.old.id) && !used.has(c.new.id));
  }

  const byDate = (a: Candidate, b: Candidate) => b.new.date.getTime() - a.new.date.getTime();
  return [...confident.sort(byDate), ...open.sort(byDate)];
}

/** An error message, or null when every pair is a candidate and no row repeats. */
export function checkDuplicatePairs(pairs: DuplicatePair[], candidates: Candidate[]): string | null {
  const known = new Set(candidates.map((c) => `${c.old.id}|${c.new.id}`));
  const used = new Set<string>();
  for (const p of pairs) {
    if (!known.has(`${p.keep}|${p.drop}`)) return "A pair sent is not a possible duplicate";
    if (used.has(p.keep) || used.has(p.drop)) return "A transaction can be merged only once";
    used.add(p.keep);
    used.add(p.drop);
  }
  return null;
}

// ─── What the survivors keep ─────────────────────────────────────────────────

/** The owner's account settings: the old account's, else the new one's. */
export function mergedAccountSettings(o: MergeAccount, n: MergeAccount) {
  return {
    displayName: o.displayName ?? n.displayName,
    manualDueDay: o.manualDueDay ?? n.manualDueDay,
    manualCreditLimit: o.manualCreditLimit ?? n.manualCreditLimit,
  };
}

// A category set by hand, by a Venmo import or by a link outranks a rule's.
function strength(source: string | null, category: string | null): number {
  if (!category) return 0;
  return source === "RULE" || source === null ? 1 : 2;
}

/** The owner's fields on the surviving row, from the old row `k` and its duplicate `d`. */
export function mergedTransactionFields(k: MergeTx, d: MergeTx) {
  // A link carries its category with it (userCategorySource "LINK").
  // A link between the pair itself would point at a row that is going away.
  const linkFrom =
    k.linkedToId && k.linkedToId !== d.id ? k : d.linkedToId && d.linkedToId !== k.id ? d : null;
  const catFrom = linkFrom
    ? linkFrom
    : strength(d.userCategorySource, d.userCategory) > strength(k.userCategorySource, k.userCategory)
      ? d
      : k;
  const kn = k.personalNote?.trim() ? k.personalNote : null;
  const dn = d.personalNote?.trim() ? d.personalNote : null;
  return {
    userCategory: catFrom.userCategory,
    userCategorySource: catFrom.userCategory ? catFrom.userCategorySource : null,
    linkedToId: linkFrom?.linkedToId ?? null,
    personalNote: kn && dn && kn !== dn ? `${kn}\n${dn}` : (kn ?? dn),
    counterparty: k.counterparty ?? d.counterparty,
    fundsCashoutId: k.fundsCashoutId ?? d.fundsCashoutId,
    // The duplicate's splits move over only when the survivor has none.
    moveSplits: k.splitCount === 0 && d.splitCount > 0,
  };
}

/** True when the owner has put something of their own on the row. */
export function isEdited(t: MergeTx): boolean {
  return Boolean(
    (t.userCategory && t.userCategorySource !== "RULE") ||
      t.personalNote ||
      t.linkedToId ||
      t.splitCount > 0
  );
}

// ─── Banks list ──────────────────────────────────────────────────────────────

export interface BankForMerge {
  itemId: string;
  institution: string;
  accountCount: number; // unmerged accounts
  disconnectedAt: Date | null;
}

export interface MergeRecordRow {
  fromItemId: string;
  intoItemId: string;
  createdAt: Date;
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * What `banks[]` in GET /api/accounts says about merging: for a disconnected
 * bank with accounts left, the connected banks of the same name it could merge
 * into; for a connected bank, the banks merged into it. A disconnected bank
 * with nothing left after a merge is hidden.
 */
export function mergeLinks(banks: BankForMerge[], merges: MergeRecordRow[]) {
  const name = new Map(banks.map((b) => [b.itemId, b.institution]));
  const mergedAway = new Set(merges.map((m) => m.fromItemId));
  return new Map(
    banks.map((b) => {
      const hidden = b.disconnectedAt != null && b.accountCount === 0 && mergedAway.has(b.itemId);
      const mergeInto =
        b.disconnectedAt && b.accountCount > 0
          ? banks
              .filter((c) => !c.disconnectedAt && sameName(c.institution, b.institution))
              .map((c) => ({ itemId: c.itemId, institution: c.institution }))
          : [];
      // Latest merge per source bank.
      const latest = new Map<string, MergeRecordRow>();
      for (const m of merges) {
        if (m.intoItemId !== b.itemId) continue;
        const prev = latest.get(m.fromItemId);
        if (!prev || prev.createdAt < m.createdAt) latest.set(m.fromItemId, m);
      }
      const mergedFrom = b.disconnectedAt
        ? []
        : [...latest.values()].map((m) => ({
            itemId: m.fromItemId,
            institution: name.get(m.fromItemId) ?? b.institution,
            mergedAt: m.createdAt.toISOString(),
          }));
      return [b.itemId, { hidden, mergeInto, mergedFrom }] as const;
    })
  );
}

// ─── Preview and confirm ─────────────────────────────────────────────────────

export interface MergeStore {
  findItem(itemId: string): Promise<PlaidItemRow | null>;
  /** Accounts currently under the item, with transaction counts. */
  listAccounts(itemId: string): Promise<MergeAccount[]>;
  /** Survivor account ids of earlier merges from `fromItemId` into `intoItemId`. */
  mergedAccountIds(fromItemId: string, intoItemId: string): Promise<string[]>;
  listTransactions(accountIds: string[]): Promise<MergeTx[]>;
  /** A full copy of the database; its file name, or throws. */
  snapshot(at: Date): Promise<string>;
  apply(plan: MergePlan): Promise<void>;
}

export interface MergePlan {
  fromItemId: string;
  intoItemId: string;
  at: Date;
  snapshotFile: string;
  accounts: { survivor: MergeAccount; removed: MergeAccount; settings: ReturnType<typeof mergedAccountSettings> }[];
  duplicates: { keep: MergeTx; drop: MergeTx; fields: ReturnType<typeof mergedTransactionFields> }[];
}

export type MergeResult<T> =
  | { status: 200; body: T }
  | { status: 400 | 404 | 409 | 500; body: { error: string } };

type Fail = { status: 400 | 404 | 409 | 500; body: { error: string } };
const fail = (status: Fail["status"], error: string): Fail => ({ status, body: { error } });

async function gather(
  fromItemId: string,
  intoItemId: string | null | undefined,
  pairs: AccountPair[] | null,
  store: MergeStore
) {
  if (!intoItemId) return fail(400, "into is required");
  const from = await store.findItem(fromItemId);
  const into = await store.findItem(intoItemId);
  if (!from || !into) return fail(404, "Bank not found");
  if (fromItemId === intoItemId) return fail(409, "A bank cannot be merged into itself");
  if (!from.disconnectedAt) return fail(409, `${from.institution} is still connected`);
  if (into.disconnectedAt) return fail(409, `${into.institution} is disconnected`);

  const oldAccounts = await store.listAccounts(fromItemId);
  const intoAccounts = await store.listAccounts(intoItemId);
  const mergedIds = new Set(await store.mergedAccountIds(fromItemId, intoItemId));
  const merged = intoAccounts.filter((a) => mergedIds.has(a.id));
  const newAccounts = intoAccounts.filter((a) => !mergedIds.has(a.id));

  const chosen = pairs ?? suggestAccountPairs(oldAccounts, newAccounts);
  const bad = checkAccountPairs(chosen, oldAccounts, newAccounts);
  if (bad) return fail(400, bad);

  // Old rows: the paired old accounts, plus rows on accounts merged earlier
  // that the old connection recorded. New rows: the paired new accounts, plus
  // rows the new connection has added to merged accounts since.
  const survivorOf = new Map<string, string>();
  for (const p of chosen) {
    survivorOf.set(p.from, p.from);
    survivorOf.set(p.to, p.from);
  }
  for (const a of merged) survivorOf.set(a.id, a.id);
  const rows = await store.listTransactions([...survivorOf.keys()]);
  const pairedOld = new Set(chosen.map((p) => p.from));
  const isOld = (t: MergeTx) =>
    pairedOld.has(t.accountId) || (mergedIds.has(t.accountId) && t.priorItemId === fromItemId);
  const isNew = (t: MergeTx) =>
    !pairedOld.has(t.accountId) && !(mergedIds.has(t.accountId) && t.priorItemId != null);
  const candidates = findDuplicates(
    rows.filter(isOld),
    rows.filter(isNew),
    (t) => survivorOf.get(t.accountId)!
  );

  return { from, into, oldAccounts, newAccounts, merged, pairs: chosen, candidates };
}

const brief = (t: MergeTx) => ({
  id: t.id,
  label: t.label,
  date: t.date.toISOString(),
  name: t.merchantName ?? t.name,
  amount: t.amount,
  pending: t.pending,
  edited: isEdited(t),
});

const accountBrief = (a: MergeAccount) => ({
  id: a.id,
  name: a.displayName ?? a.name,
  mask: a.mask,
  type: a.type,
  subtype: a.subtype,
  transactionCount: a.transactionCount,
});

/** GET /api/plaid/items/:itemId/merge?into=…[&pairs=…] */
export async function previewMerge(
  fromItemId: string,
  intoItemId: string | null,
  pairs: AccountPair[] | null,
  store: MergeStore
) {
  const g = await gather(fromItemId, intoItemId, pairs, store);
  if ("status" in g) return g;
  return {
    status: 200 as const,
    body: {
      from: {
        itemId: g.from.itemId,
        institution: g.from.institution,
        disconnectedAt: g.from.disconnectedAt!.toISOString(),
      },
      into: { itemId: g.into.itemId, institution: g.into.institution },
      oldAccounts: g.oldAccounts.map(accountBrief),
      newAccounts: g.newAccounts.map(accountBrief),
      mergedAccounts: g.merged.map(accountBrief),
      pairs: g.pairs,
      duplicates: g.candidates.map((c) => ({ old: brief(c.old), new: brief(c.new), confident: c.confident })),
    },
  };
}

/** Parses `pairs=old:new,old:new` (absent → null, meaning "use the suggestions"). */
export function parsePairsParam(raw: string | null): AccountPair[] | null {
  if (raw == null) return null;
  return raw
    .split(",")
    .filter(Boolean)
    .map((s) => {
      const [from, to] = s.split(":");
      return { from: from ?? "", to: to ?? "" };
    });
}

function isPairList<K extends string>(v: unknown, a: K, b: K): v is Record<K, string>[] {
  return (
    Array.isArray(v) &&
    v.every(
      (p) => p && typeof p === "object" && typeof (p as Record<K, unknown>)[a] === "string" &&
        typeof (p as Record<K, unknown>)[b] === "string"
    )
  );
}

/** POST /api/plaid/items/:itemId/merge */
export async function confirmMerge(
  fromItemId: string,
  body: unknown,
  store: MergeStore,
  now: Date = new Date()
): Promise<
  MergeResult<{ ok: true; mergedAccounts: number; mergedDuplicates: number; snapshot: string }>
> {
  const b = (body ?? {}) as { into?: unknown; accounts?: unknown; duplicates?: unknown };
  const accounts = b.accounts ?? [];
  const duplicates = b.duplicates ?? [];
  if (typeof b.into !== "string") return fail(400, "into is required");
  if (!isPairList(accounts, "from", "to")) return fail(400, "accounts must be [{ from, to }]");
  if (!isPairList(duplicates, "keep", "drop")) return fail(400, "duplicates must be [{ keep, drop }]");
  if (accounts.length === 0 && duplicates.length === 0) return fail(400, "Nothing to merge");

  const g = await gather(fromItemId, b.into, accounts, store);
  if ("status" in g) return g;
  const bad = checkDuplicatePairs(duplicates, g.candidates);
  if (bad) return fail(400, bad);

  // Never write without a way back.
  let snapshotFile: string;
  try {
    snapshotFile = await store.snapshot(now);
  } catch (e) {
    console.error("[merge] snapshot failed:", e);
    return fail(500, "Could not back up the database first, so nothing was merged");
  }

  const olds = new Map(g.oldAccounts.map((a) => [a.id, a]));
  const news = new Map(g.newAccounts.map((a) => [a.id, a]));
  const byPair = new Map(g.candidates.map((c) => [`${c.old.id}|${c.new.id}`, c]));
  const plan: MergePlan = {
    fromItemId,
    intoItemId: b.into,
    at: now,
    snapshotFile,
    accounts: accounts.map((p) => {
      const survivor = olds.get(p.from)!;
      const removed = news.get(p.to)!;
      return { survivor, removed, settings: mergedAccountSettings(survivor, removed) };
    }),
    duplicates: duplicates.map((p) => {
      const c = byPair.get(`${p.keep}|${p.drop}`)!;
      return { keep: c.old, drop: c.new, fields: mergedTransactionFields(c.old, c.new) };
    }),
  };
  await store.apply(plan);
  return {
    status: 200,
    body: {
      ok: true,
      mergedAccounts: plan.accounts.length,
      mergedDuplicates: plan.duplicates.length,
      snapshot: snapshotFile,
    },
  };
}
