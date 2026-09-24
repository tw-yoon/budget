export const CADENCES = [
  "WEEKLY",
  "BIWEEKLY",
  "SEMI_MONTHLY",
  "MONTHLY",
  "QUARTERLY",
  "YEARLY",
] as const;

export const CADENCE_LABELS: Record<string, string> = {
  WEEKLY: "Weekly",
  BIWEEKLY: "Every 2 weeks",
  SEMI_MONTHLY: "Twice a month",
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  YEARLY: "Yearly",
};

// Normalize any cadence to an equivalent monthly cost.
const MONTHLY_FACTOR: Record<string, number> = {
  WEEKLY: 52 / 12,
  BIWEEKLY: 26 / 12,
  SEMI_MONTHLY: 2,
  MONTHLY: 1,
  QUARTERLY: 1 / 3,
  YEARLY: 1 / 12,
};

export function monthlyCost(amount: number, cadence: string): number {
  return amount * (MONTHLY_FACTOR[cadence] ?? 1);
}

// Map Plaid's recurring frequency to our cadence values.
export function mapFrequency(freq?: string | null): string {
  switch (freq) {
    case "WEEKLY":
      return "WEEKLY";
    case "BIWEEKLY":
      return "BIWEEKLY";
    case "SEMI_MONTHLY":
      return "SEMI_MONTHLY";
    case "MONTHLY":
      return "MONTHLY";
    case "ANNUALLY":
      return "YEARLY";
    default:
      return "MONTHLY";
  }
}

// When a stream should charge next, one cadence after its last charge.
export function estimateNext(lastDate: string | null | undefined, cadence: string): Date | null {
  if (!lastDate) return null;
  const d = new Date(`${lastDate}T12:00:00Z`);
  if (isNaN(d.getTime())) return null;
  switch (cadence) {
    case "WEEKLY":
      d.setDate(d.getDate() + 7);
      break;
    case "BIWEEKLY":
      d.setDate(d.getDate() + 14);
      break;
    case "SEMI_MONTHLY":
      // Plaid gives only the last date, not the two days of the month it
      // charges on, so step half a month: the 15th lands on the 30th and the
      // 30th on the 15th, which is right for the common 15th/month-end pair.
      d.setDate(d.getDate() + 15);
      break;
    case "QUARTERLY":
      d.setMonth(d.getMonth() + 3);
      break;
    case "YEARLY":
      d.setFullYear(d.getFullYear() + 1);
      break;
    default:
      d.setMonth(d.getMonth() + 1);
  }
  return d;
}
