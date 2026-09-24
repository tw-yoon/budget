/**
 * Auto-detect subscriptions from Plaid's recurring-transactions streams.
 * Recurring *outflows* that look like bills/transfers (rent, loans, fees,
 * transfers) are excluded so the list stays subscription-focused; the user can
 * still delete anything that slips through.
 */

import { plaidClient } from "@/lib/plaid";
import { getAccessToken } from "@/lib/token-store";
import { prisma } from "@/lib/prisma";
import { estimateNext, mapFrequency } from "@/lib/subscriptions";

const EXCLUDE_PRIMARY = new Set([
  "LOAN_PAYMENTS",
  "RENT_AND_UTILITIES",
  "TRANSFER_OUT",
  "TRANSFER_IN",
  "BANK_FEES",
]);

export async function detectSubscriptions(): Promise<{
  found: number;
  errors: { institution: string; error: string }[];
}> {
  const items = await prisma.plaidItem.findMany({
    include: { accounts: { select: { id: true, plaidAccountId: true } } },
  });

  let found = 0;
  const errors: { institution: string; error: string }[] = [];

  for (const item of items) {
    if (item.accounts.length === 0) continue;
    try {
      const accessToken = getAccessToken(item.itemId);
      const res = await plaidClient.transactionsRecurringGet({
        access_token: accessToken,
        account_ids: item.accounts.map((a) => a.plaidAccountId),
      });
      const acctMap = new Map(item.accounts.map((a) => [a.plaidAccountId, a.id]));

      for (const s of res.data.outflow_streams) {
        const primary = s.personal_finance_category?.primary ?? "";
        if (EXCLUDE_PRIMARY.has(primary)) continue;

        const amount = Math.abs(
          s.average_amount?.amount ?? s.last_amount?.amount ?? 0
        );
        if (amount <= 0) continue;

        const cadence = mapFrequency(s.frequency);
        const name = s.merchant_name || s.description || "Subscription";

        await prisma.subscription.upsert({
          where: { streamId: s.stream_id },
          create: {
            streamId: s.stream_id,
            name,
            merchantName: s.merchant_name ?? null,
            amount,
            cadence,
            accountId: acctMap.get(s.account_id) ?? null,
            nextDate: estimateNext(s.last_date, cadence),
            isActive: s.is_active ?? true,
            source: "AUTO",
          },
          update: {
            name,
            amount,
            cadence,
            isActive: s.is_active ?? true,
            nextDate: estimateNext(s.last_date, cadence),
          },
        });
        found++;
      }
    } catch (err) {
      errors.push({ institution: item.institution, error: plaidErrorCode(err) });
    }
  }

  return { found, errors };
}

function plaidErrorCode(err: unknown): string {
  if (err && typeof err === "object" && "response" in err) {
    const data = (err as { response?: { data?: { error_code?: string } } }).response?.data;
    if (data?.error_code) return data.error_code;
  }
  return err instanceof Error ? err.message : String(err);
}
