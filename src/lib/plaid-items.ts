/**
 * Disconnecting a bank keeps its history
 * (docs/superpowers/specs/2026-10-02-disconnect-keeps-history-design.md).
 *
 * Disconnect revokes the Plaid Item and deletes its access token, but leaves
 * every account, transaction, split, link and sync log in place and stamps
 * `PlaidItem.disconnectedAt`. Deleting a bank's history is the full cleanup;
 * on a connected bank it disconnects first, in the same step.
 *
 * No Prisma or Plaid import here: the routes hand in a store and a Plaid
 * port, so scripts/test-plaid-items.mjs can run the rules against fakes.
 */

export interface PlaidItemRow {
  itemId: string;
  institution: string;
  disconnectedAt: Date | null;
}

/** What the rules need from the database. */
export interface ItemStore {
  findItem(itemId: string): Promise<PlaidItemRow | null>;
  markDisconnected(itemId: string, at: Date): Promise<void>;
  /** FK-safe delete of transactions, accounts, sync logs and the item, in one transaction. */
  deleteHistory(itemId: string): Promise<{ removedAccounts: number; removedTransactions: number }>;
}

/** What the rules need from Plaid and the token store. Both are best effort. */
export interface PlaidPort {
  revoke(itemId: string): Promise<void>;
  deleteToken(itemId: string): void;
}

export type ItemResult<T> =
  | { status: 200; body: T }
  | { status: 404 | 409; body: { error: string } };

const NOT_FOUND = { status: 404 as const, body: { error: "Bank not found" } };

// Revoke the Item (stops Plaid billing) and forget its token. A failure in
// either must not block the local change, as before.
async function cutOff(itemId: string, plaid: PlaidPort, tag: string) {
  try {
    await plaid.revoke(itemId);
  } catch (e) {
    console.warn(`[${tag}] itemRemove skipped:`, e);
  }
  try {
    plaid.deleteToken(itemId);
  } catch (e) {
    console.warn(`[${tag}] token removal skipped:`, e);
  }
}

/** DELETE /api/plaid/items/:itemId. Idempotent: a disconnected bank is left alone. */
export async function disconnectItem(
  itemId: string,
  store: ItemStore,
  plaid: PlaidPort,
  now: Date = new Date()
): Promise<ItemResult<{ ok: true; institution: string; disconnectedAt: string }>> {
  const item = await store.findItem(itemId);
  if (!item) return NOT_FOUND;
  if (item.disconnectedAt) {
    return {
      status: 200,
      body: { ok: true, institution: item.institution, disconnectedAt: item.disconnectedAt.toISOString() },
    };
  }
  await cutOff(itemId, plaid, "items DELETE");
  await store.markDisconnected(itemId, now);
  return {
    status: 200,
    body: { ok: true, institution: item.institution, disconnectedAt: now.toISOString() },
  };
}

/** DELETE /api/plaid/items/:itemId/history. A connected bank is disconnected first. */
export async function deleteItemHistory(
  itemId: string,
  store: ItemStore,
  plaid: PlaidPort
): Promise<
  ItemResult<{ ok: true; institution: string; removedAccounts: number; removedTransactions: number }>
> {
  const item = await store.findItem(itemId);
  if (!item) return NOT_FOUND;
  if (!item.disconnectedAt) await cutOff(itemId, plaid, "items history DELETE");
  const removed = await store.deleteHistory(itemId);
  return { status: 200, body: { ok: true, institution: item.institution, ...removed } };
}

/**
 * The items a Plaid call (sync, balance refresh) should touch. With no
 * `itemId`, every connected item; a disconnected one is skipped silently.
 * Asked for a disconnected item by id, a 409 that says so, rather than a
 * doomed call with a token that no longer exists.
 */
export function pickConnectedItems<T extends PlaidItemRow>(
  all: T[],
  itemId?: string
): { ok: true; items: T[] } | { ok: false; status: 404 | 409; error: string } {
  if (itemId) {
    const item = all.find((i) => i.itemId === itemId);
    if (!item) return { ok: false, status: 404, error: "No linked items found" };
    if (item.disconnectedAt) {
      return { ok: false, status: 409, error: `${item.institution} is disconnected` };
    }
    return { ok: true, items: [item] };
  }
  const items = all.filter((i) => !i.disconnectedAt);
  if (items.length === 0) return { ok: false, status: 404, error: "No linked items found" };
  return { ok: true, items };
}
