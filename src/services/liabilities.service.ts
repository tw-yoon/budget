/**
 * Pulls credit-card liability details (payment due date, last statement
 * balance, minimum payment) via /liabilities/get and stores them on the
 * matching Account rows.
 *
 * Best-effort: liabilities is a separate Plaid product, so if a token wasn't
 * created with it (or the institution doesn't support it) this returns
 * { ok: false } with the Plaid error code rather than throwing — callers like
 * the balance refresh should not break because of it.
 */

import { plaidClient } from "@/lib/plaid";
import { getAccessToken } from "@/lib/token-store";
import { prisma } from "@/lib/prisma";

// Plaid gives dates as "YYYY-MM-DD"; pin to noon UTC so local formatting
// never lands on the previous day.
function toDate(d: string | null | undefined): Date | null {
  return d ? new Date(`${d}T12:00:00Z`) : null;
}

export async function syncLiabilities(
  itemId: string
): Promise<{ ok: boolean; updated: number; error?: string }> {
  try {
    const accessToken = getAccessToken(itemId);
    const res = await plaidClient.liabilitiesGet({ access_token: accessToken });
    const credits = res.data.liabilities.credit ?? [];

    let updated = 0;
    for (const c of credits) {
      if (!c.account_id) continue;
      const r = await prisma.account.updateMany({
        where: { plaidAccountId: c.account_id },
        data: {
          nextPaymentDueDate: toDate(c.next_payment_due_date),
          lastStatementBalance: c.last_statement_balance ?? null,
          minimumPaymentAmount: c.minimum_payment_amount ?? null,
          paymentIsOverdue: c.is_overdue ?? null,
        },
      });
      updated += r.count;
    }
    return { ok: true, updated };
  } catch (err) {
    return { ok: false, updated: 0, error: plaidErrorCode(err) };
  }
}

function plaidErrorCode(err: unknown): string {
  if (err && typeof err === "object" && "response" in err) {
    const data = (err as { response?: { data?: { error_code?: string } } }).response?.data;
    if (data?.error_code) return data.error_code;
  }
  return err instanceof Error ? err.message : String(err);
}
