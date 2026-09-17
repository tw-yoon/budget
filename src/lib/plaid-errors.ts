/**
 * Turning a Plaid error code into something a person can act on.
 *
 * A failed sync is item-level: the whole bank connection is dead, not one
 * transaction. So the only useful thing to say is *which* bank and *what to do*
 * — which is why every message leads with the institution name.
 *
 * Kept free of imports so `node:test` can load it directly under Node's native
 * type stripping, and so it stays safe to import from a client component
 * (`src/lib/plaid.ts` holds the API secrets and must never reach the browser).
 */

/** Plain-language endings, keyed by Plaid's error_code. */
const MEANINGS: Record<string, string> = {
  // The saved connection is no longer valid — the usual cause is a changed
  // password or an expired consent. Re-auth is the only fix.
  ITEM_LOGIN_REQUIRED: "needs you to sign in again — reconnect it on Accounts",
  INVALID_CREDENTIALS: "rejected the saved sign-in — reconnect it on Accounts",
  INVALID_MFA: "needs another verification step — reconnect it on Accounts",
  ITEM_LOCKED: "has locked the account — unlock it with the bank, then reconnect it on Accounts",
  USER_PERMISSION_REVOKED: "had its access revoked — reconnect it on Accounts",
  PENDING_EXPIRATION: "is about to expire — reconnect it on Accounts to keep it alive",

  // Nothing to fix here; these clear up on their own.
  INSTITUTION_DOWN: "is down at the bank's end — this should clear on its own",
  INSTITUTION_NOT_RESPONDING: "is not responding right now — try again later",
  INSTITUTION_NO_LONGER_SUPPORTED: "is no longer supported by Plaid",
  RATE_LIMIT_EXCEEDED: "hit Plaid's rate limit — try again in a few minutes",
};

/**
 * One failure, as a sentence naming the bank. The raw code is kept in
 * parentheses so it stays searchable, and an unmapped code is never
 * paraphrased — it falls back to naming the bank and quoting the code, rather
 * than guessing at a meaning it might not have.
 */
export function describePlaidError(
  code: string | null | undefined,
  institution: string
): string {
  if (!code) return `${institution} failed for an unreported reason`;
  const meaning = MEANINGS[code];
  return meaning
    ? `${institution} ${meaning} (${code})`
    : `${institution} failed (${code})`;
}

/**
 * The whole failure line for a sync. A single failure reads as a plain
 * sentence; several are counted and separated, so the count never gets in the
 * way of the one case that matters most.
 */
export function summarizeFailures(
  failures: { institution: string; error?: string | null }[]
): string {
  const parts = failures.map((f) => describePlaidError(f.error, f.institution));
  if (parts.length === 1) return parts[0];
  return `${parts.length} banks failed: ${parts.join("; ")}`;
}
