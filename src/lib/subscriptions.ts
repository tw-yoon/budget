export const CADENCES = [
  "WEEKLY",
  "BIWEEKLY",
  "MONTHLY",
  "QUARTERLY",
  "YEARLY",
] as const;

export const CADENCE_LABELS: Record<string, string> = {
  WEEKLY: "Weekly",
  BIWEEKLY: "Every 2 weeks",
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  YEARLY: "Yearly",
};

// Normalize any cadence to an equivalent monthly cost.
const MONTHLY_FACTOR: Record<string, number> = {
  WEEKLY: 52 / 12,
  BIWEEKLY: 26 / 12,
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
      return "BIWEEKLY";
    case "MONTHLY":
      return "MONTHLY";
    case "ANNUALLY":
      return "YEARLY";
    default:
      return "MONTHLY";
  }
}
