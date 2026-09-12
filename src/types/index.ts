export interface TransactionDTO {
  id: string;
  plaidTxId: string;
  accountId: string;
  accountName: string;
  accountMask: string | null;
  amount: number; // raw Plaid amount: positive = outflow (money left account)
  date: string; // ISO timestamp
  name: string;
  merchantName: string | null;
  category: string; // effective parent category (user override or humanized PFC primary)
  categoryDetailed: string | null; // user subcategory if overridden, else humanized PFC detailed
  userCategory: string | null; // raw override, possibly "Parent > Sub"; null = Plaid's
  plaidCategory: string; // humanized PFC primary (pre-override fallback)
  plaidCategoryDetailed: string | null; // humanized PFC detailed (pre-override fallback)
  logoUrl: string | null;
  pending: boolean;
  isTransfer: boolean;
  isFee: boolean;
  personalNote: string | null;
  source: string; // PLAID | VENMO
  // Present on bank-side Venmo cash-out deposits: the categorized Venmo
  // payments pooled into this lump sum, plus any unaccounted prior balance.
  breakdown: CashoutBreakdown | null;
}

export interface CashoutBreakdown {
  slices: { category: string; amount: number }[];
  priorBalance: number;
}

export interface TransactionsResponse {
  transactions: TransactionDTO[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface SyncSummaryItem {
  itemId: string;
  institution: string;
  success: boolean;
  added?: number;
  modified?: number;
  removed?: number;
  error?: string;
  skipped?: boolean; // investments-only item — no Transactions product to sync
}

export interface SyncResponse {
  summary: SyncSummaryItem[];
}

export interface AnalyticsSummary {
  totalSpent: number;
  totalIncome: number;
  net: number;
  txCount: number;
}

export interface CategorySlice {
  category: string;
  amount: number;
  count: number;
}

export interface MonthBucket {
  month: string; // YYYY-MM
  label: string; // e.g. "Jan"
  spent: number;
  income: number;
}

export interface MerchantTotal {
  name: string;
  amount: number;
  count: number;
}

export interface AnalyticsResult {
  summary: AnalyticsSummary;
  byCategory: CategorySlice[];
  byMonth: MonthBucket[];
  topMerchants: MerchantTotal[];
  rangeMonths: number;
}

// Per-month cash-flow breakdown that feeds the interactive Sankey. The client
// fetches a wide series once and aggregates any sub-window locally, so zooming
// and panning across months needs no extra round-trips.
export interface CashflowMonth {
  key: string; // YYYY-MM
  label: string; // e.g. "Jun 2026"
  income: { source: string; amount: number }[]; // inflows grouped by category
  // Outflows grouped by parent category. `subs` (present when the user has
  // subcategorized spend in that category) holds the named-sub totals; the
  // remainder up to `amount` is un-subcategorized spend.
  spend: { category: string; amount: number; subs?: { name: string; amount: number }[] }[];
}

// Daily spend totals for the cumulative "Spending" graph.
export interface DailySpend {
  date: string; // YYYY-MM-DD
  amount: number; // net spend that day (outflows minus reimbursements)
}

export interface SpendingSeries {
  days: DailySpend[]; // chronological, only days with spend activity
}

export interface CashflowSeries {
  months: CashflowMonth[]; // chronological, oldest → newest
  // Real cash on hand right now (sum of depository balances). The Sankey anchors
  // each month's running balance to this and back-computes earlier months, so the
  // savings lane reflects an actual cash position rather than an arbitrary base.
  currentCash: number;
  cashAsOf: string | null; // ISO of the most recent balance refresh
}

export interface AccountDTO {
  id: string;
  name: string;
  officialName: string | null;
  mask: string | null;
  type: string; // DEPOSITORY | CREDIT | INVESTMENT | LOAN | OTHER
  subtype: string | null;
  currentBalance: number;
  availableBalance: number | null;
  balanceFetchedAt: string; // ISO
  institution: string;
  isLiability: boolean;
  nextPaymentDueDate: string | null; // ISO; credit cards only
  lastStatementBalance: number | null;
  minimumPaymentAmount: number | null;
  paymentIsOverdue: boolean | null;
  displayName: string | null;
  manualDueDay: number | null;
  manualCreditLimit: number | null;
}

export interface AccountGroup {
  type: string;
  label: string;
  subtotal: number;
  isLiability: boolean;
  accounts: AccountDTO[];
}

export interface AccountsSummary {
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
  accountCount: number;
  lastRefreshed: string | null; // most recent balanceFetchedAt
}

export interface BankSummary {
  itemId: string;
  institution: string;
  accountCount: number;
}

export interface DebitCardDTO {
  id: string;
  name: string;
  last4: string;
  accountId: string;
  accountName: string;
  available: number | null;
}

export interface AccountsResponse {
  groups: AccountGroup[];
  summary: AccountsSummary;
  banks: BankSummary[];
  debitCards: DebitCardDTO[];
}

export interface SubscriptionDTO {
  id: string;
  name: string;
  amount: number;
  cadence: string;
  cadenceLabel: string;
  monthlyCost: number;
  nextDate: string | null;
  merchantName: string | null;
  accountName: string | null;
  source: string; // MANUAL | AUTO
  isActive: boolean;
}

export interface SubscriptionsResponse {
  subscriptions: SubscriptionDTO[];
  monthlyTotal: number;
}

export interface BenefitDTO {
  id: string;
  name: string;
  notes: string | null;
  amount: number;
  period: string;
  matchCategories: string[];
  categoryLabels: string[];
  matchText: string[]; // name keywords matched against credit/refund transactions
  perkActiveFrom: string | null; // ISO date the flat-value perk was switched on
  used: number; // raw used (may exceed amount)
  cappedUsed: number; // min(used, amount)
  pct: number; // 0..1
  periodLabel: string; // e.g. "Q2 2026"
  source: "manual" | "auto" | "none";
  autoMode: "spending" | "credits" | "perk" | null; // how "auto" progress is computed
  yearBreakdown: BenefitPeriodDTO[]; // one cell per period window this year
  ytdCaptured: number; // credit value captured so far this year
  yearTarget: number; // max credit value available across the full year
}

export interface BenefitPeriodDTO {
  label: string; // full window label, e.g. "March 2026"
  short: string; // compact cell label, e.g. "Mar"
  key: string; // stable period key, e.g. "2026-03" — used for manual overrides
  used: number;
  target: number; // per-window credit cap
  captured: boolean; // used >= target
  manual: boolean; // this window has a manual override
  future: boolean; // window hasn't started yet
}

export interface RewardRateDTO {
  id: string;
  category: string;
  categoryLabel: string;
  multiplier: number;
  unit: string; // "X" | "PERCENT"
  display: string; // e.g. "4x" or "6%"
  notes: string | null;
}

// What a card earned on its own spending over one benefit year, and how much of
// that it earned *over* the next-best card the user holds.
export interface EarningsDTO {
  unit: string; // "X" (points) or "PERCENT" (cashback) — the card's base unit
  pointValueCents: number; // assumed cash value of one point, for cross-card math
  totalSpend: number;
  totalEarned: number; // points, or cashback dollars — in the card's own unit
  totalValue: number; // totalEarned expressed in dollars
  incrementalValue: number; // totalValue minus what the best alternative would have paid
  byCategory: EarningsCategoryDTO[]; // descending by spend
}

export interface EarningsCategoryDTO {
  category: string;
  categoryLabel: string;
  spend: number;
  rate: string; // e.g. "4x" or "1.5%"
  isBonus: boolean; // false when this fell through to the card's base rate
  earned: number; // in the card's own unit
  value: number; // in dollars
  vsBest: number; // value minus the best alternative card's value on this spend
  bestAlternative: string | null; // that card's name
}

export interface UserCardDTO {
  id: string;
  issuer: string;
  name: string | null;
  last4: string;
  membershipStartYear: number;
  membershipStartMonth: number | null;
  annualFee: number;
  pointValueCents: number;
  linked: boolean;
  linkedAccountName: string | null;
  benefits: BenefitDTO[];
  benefitCount: number;
  benefitsUsedCount: number;
  creditsYtd: number; // total statement credits captured this year
  creditsAnnualMax: number; // total credits available across the full year
  rewardRates: RewardRateDTO[];
  earnings: EarningsDTO | null; // null when the card isn't linked to an account
  earningsPeriodLabel: string; // e.g. "Feb 2026 – Jan 2027"
}

export interface UserCardsResponse {
  cards: UserCardDTO[];
}
