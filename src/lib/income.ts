// Income page maths: federal tables, pay schedules, and the saved-state shape.
// No React here so node:test can load it.

import { calcStateTax } from "@/data/state-tax-brackets";

// ── Federal tax tables by year ───────────────────────────────────────────────
// Each tax year holds its own IRS limits, brackets, and standard deduction. To
// add a year (e.g. when the IRS publishes 2027 figures), drop in a new entry —
// nothing else needs to change. Consumers resolve the right tables with
// federalFor(year), which falls back to the most recent coded year.
export type FederalLimits = {
  k401_under50: number;
  k401_50to59_64plus: number;
  k401_60to63: number;
  k401_total_under50: number;
  k401_total_50plus: number;
  hsa_single: number;
  hsa_family: number;
  hsa_catchup: number;
  fsa_health: number;
  fsa_dependent_care: number;
  fsa_carryover: number;
  roth_ira: number;
  roth_ira_catchup: number;
  roth_phaseout_single_start: number;
  roth_phaseout_single_end: number;
  roth_phaseout_mfj_start: number;
  roth_phaseout_mfj_end: number;
  ss_wage_base: number;
};

export type TaxBracket = { up_to: number; rate: number };

export type FederalTables = {
  limits: FederalLimits;
  bracketsSingle: TaxBracket[];
  bracketsMfj: TaxBracket[];
  standardDeduction: { single: number; mfj: number };
};

export const FEDERAL_BY_YEAR: Record<number, FederalTables> = {
  2026: {
    limits: {
      // 401(k) employee elective deferral
      k401_under50: 24500,
      k401_50to59_64plus: 32500, // 24,500 + 8,000 catch-up
      k401_60to63: 35750, // 24,500 + 11,250 SECURE 2.0 super catch-up
      // 401(k) total additions (employee + employer combined)
      k401_total_under50: 72000,
      k401_total_50plus: 80000,
      hsa_single: 4400,
      hsa_family: 8750,
      hsa_catchup: 1000, // age 55+
      fsa_health: 3400,
      fsa_dependent_care: 7500,
      fsa_carryover: 680, // max health-FSA rollover (informational)
      roth_ira: 7500,
      roth_ira_catchup: 8600, // age 50+
      roth_phaseout_single_start: 153000,
      roth_phaseout_single_end: 168000,
      roth_phaseout_mfj_start: 242000,
      roth_phaseout_mfj_end: 252000,
      ss_wage_base: 176100,
    },
    bracketsSingle: [
      { up_to: 11925, rate: 0.10 },
      { up_to: 48475, rate: 0.12 },
      { up_to: 103350, rate: 0.22 },
      { up_to: 197300, rate: 0.24 },
      { up_to: 250525, rate: 0.32 },
      { up_to: 626350, rate: 0.35 },
      { up_to: Infinity, rate: 0.37 },
    ],
    bracketsMfj: [
      { up_to: 23850, rate: 0.10 },
      { up_to: 96950, rate: 0.12 },
      { up_to: 206700, rate: 0.22 },
      { up_to: 394600, rate: 0.24 },
      { up_to: 501050, rate: 0.32 },
      { up_to: 751600, rate: 0.35 },
      { up_to: Infinity, rate: 0.37 },
    ],
    standardDeduction: { single: 15000, mfj: 30000 },
  },
};

export const FEDERAL_YEARS = Object.keys(FEDERAL_BY_YEAR)
  .map(Number)
  .sort((a, b) => a - b);

// The most recent tax year we have federal figures coded for.
export const LATEST_FEDERAL_YEAR = FEDERAL_YEARS[FEDERAL_YEARS.length - 1];

// Resolve federal tables for a year: exact match, else the most recent prior
// year available, else the earliest we have.
export function federalFor(year: number): { dataYear: number; tables: FederalTables } {
  if (FEDERAL_BY_YEAR[year]) return { dataYear: year, tables: FEDERAL_BY_YEAR[year] };
  const prior = FEDERAL_YEARS.filter((y) => y <= year);
  const dataYear = prior.length ? prior[prior.length - 1] : FEDERAL_YEARS[0];
  return { dataYear, tables: FEDERAL_BY_YEAR[dataYear] };
}

export type AgeBand = "under50" | "50to54" | "55to59" | "60to63" | "64plus";

export const AGE_BANDS: { value: AgeBand; label: string }[] = [
  { value: "under50", label: "Under 50" },
  { value: "50to54", label: "50–54" },
  { value: "55to59", label: "55–59 (HSA catch-up)" },
  { value: "60to63", label: "60–63 (super catch-up)" },
  { value: "64plus", label: "64+" },
];

export const is50plus = (band: AgeBand) => band !== "under50";
export const is55plus = (band: AgeBand) => band === "55to59" || band === "60to63" || band === "64plus";

export function k401LimitFor(band: AgeBand, L: FederalLimits): number {
  if (band === "under50") return L.k401_under50;
  if (band === "60to63") return L.k401_60to63;
  return L.k401_50to59_64plus; // 50–54, 55–59, and 64+
}

export function k401TotalLimitFor(band: AgeBand, L: FederalLimits): number {
  return band === "under50" ? L.k401_total_under50 : L.k401_total_50plus;
}

export function calcFederalTax(
  taxableIncome: number,
  filing: "single" | "mfj",
  tables: FederalTables
): number {
  const brackets = filing === "single" ? tables.bracketsSingle : tables.bracketsMfj;
  let tax = 0;
  let prev = 0;
  for (const bracket of brackets) {
    if (taxableIncome <= prev) break;
    const chunk = Math.min(taxableIncome, bracket.up_to) - prev;
    tax += chunk * bracket.rate;
    prev = bracket.up_to;
  }
  return tax;
}

export type EntryMode = "$" | "%";
export type AllocationItem = { label: string; amount: number; mode?: EntryMode };

export const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// How a period pays out. "months" is the coarse mode — a salary rate spread
// over a range of whole months. The others schedule real pay dates from a
// first payday, which is what actually determines how much of a year's salary
// you see and how a deduction divides across paychecks.
export type PayCadence = "months" | "weekly" | "biweekly" | "semimonthly" | "monthly";

export const CADENCES: { value: PayCadence; label: string; perYear: number }[] = [
  { value: "months", label: "Whole months", perYear: 12 },
  { value: "weekly", label: "Weekly", perYear: 52 },
  { value: "biweekly", label: "Every 2 weeks", perYear: 26 },
  { value: "semimonthly", label: "Twice a month", perYear: 24 },
  { value: "monthly", label: "Monthly", perYear: 12 },
];

export const perYearFor = (c: PayCadence) => CADENCES.find((x) => x.value === c)?.perYear ?? 12;
export const isScheduled = (p: IncomePeriod) => p.cadence !== "months";

// An income period within the year: a salary rate that runs either across a
// range of whole months (startMonth–endMonth, 1 = January) or across real pay
// dates from firstPayDate at a fixed cadence, plus any bonus paid during it.
// Either way it records a job that starts mid-year, a gap between jobs, or a
// raise landing in a month other than January, with its bonus attached.
export type IncomePeriod = {
  label: string;
  annualRate: number;
  startMonth: number; // 1–12, inclusive — "months" cadence only
  endMonth: number; // 1–12, inclusive — "months" cadence only
  bonus: number;
  cadence: PayCadence;
  firstPayDate: string; // "YYYY-MM-DD" — scheduled cadences only
  lastPayDate: string; // "" while the job is ongoing
};

export const clampMonth = (m: number) => Math.min(12, Math.max(1, Math.round(Number(m) || 1)));

export const periodMonths = (p: IncomePeriod) => Math.max(0, p.endMonth - p.startMonth + 1);

// ── Dates ────────────────────────────────────────────────────────────────────
// All date maths runs in UTC. Pay dates are calendar facts, not instants, and
// building them locally would shift them a day either side of a DST boundary.
export function parseDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

export const toISO = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
export const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
export const startOfYear = (y: number) => new Date(Date.UTC(y, 0, 1));
export const endOfYear = (y: number) => new Date(Date.UTC(y, 11, 31));

export const fmtDate = (d: Date) =>
  d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

// Move a stored date the same number of years, clamping Feb 29 into range.
export function shiftYears(iso: string, delta: number): string {
  const d = parseDate(iso);
  if (!d) return iso;
  const y = d.getUTCFullYear() + delta;
  return toISO(new Date(Date.UTC(y, d.getUTCMonth(), Math.min(d.getUTCDate(), daysInMonth(y, d.getUTCMonth())))));
}

// Twice-monthly pay runs on two days a month about 15 days apart — the 15th and
// the last day, the 1st and 16th, and so on. Derive the pair from the first
// payday rather than asking for both.
export function semiMonthlyAnchors(day: number): number[] {
  const other = day <= 15 ? day + 15 : day - 15;
  return [...new Set([day, other])].sort((a, b) => a - b);
}

// Every payday for one period falling in [from, to], never past the period's
// own last payday. Windows may run outside the tax year — an FSA plan year
// ending in June needs next year's paychecks to divide the election correctly.
export function payDatesBetween(p: IncomePeriod, from: Date, to: Date): Date[] {
  if (!isScheduled(p)) return [];
  const first = parseDate(p.firstPayDate);
  if (!first) return [];
  const lastPay = parseDate(p.lastPayDate);
  const stop = lastPay && lastPay < to ? lastPay : to;
  if (stop < first || stop < from) return [];
  const out: Date[] = [];

  if (p.cadence === "weekly" || p.cadence === "biweekly") {
    const step = p.cadence === "weekly" ? 7 : 14;
    // Jump straight to the window instead of stepping through the years since
    // the first payday, which may be well in the past for a long-held job.
    const skip = Math.max(0, Math.floor((from.getTime() - first.getTime()) / (step * 86400000)));
    let d = addDays(first, skip * step);
    while (d < from) d = addDays(d, step);
    for (; d <= stop; d = addDays(d, step)) out.push(d);
    return out;
  }

  const anchors = p.cadence === "monthly" ? [first.getUTCDate()] : semiMonthlyAnchors(first.getUTCDate());
  let m = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  for (; m <= stop; m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1))) {
    for (const a of anchors) {
      const y = m.getUTCFullYear();
      const mo = m.getUTCMonth();
      const d = new Date(Date.UTC(y, mo, Math.min(a, daysInMonth(y, mo))));
      if (d >= first && d >= from && d <= stop) out.push(d);
    }
  }
  out.sort((a, b) => a.getTime() - b.getTime());
  return out;
}

export const payDatesInYear = (p: IncomePeriod, year: number) =>
  payDatesBetween(p, startOfYear(year), endOfYear(year));

// Paychecks landing in a window across every scheduled period — the divisor
// for turning an annual election into a per-paycheck deduction.
export function paychecksBetween(periods: IncomePeriod[], from: Date, to: Date): number {
  return periods.reduce((n, p) => n + payDatesBetween(p, from, to).length, 0);
}

// Salary this period actually contributes to the tax year: scheduled periods
// pay a fixed slice of the annual rate per payday, so a mid-August start earns
// exactly the paychecks that land before New Year, not a fraction of a month.
export function periodSalary(p: IncomePeriod, year: number): number {
  if (isScheduled(p)) return (p.annualRate / perYearFor(p.cadence)) * payDatesInYear(p, year).length;
  return (p.annualRate * periodMonths(p)) / 12;
}

export const salaryFromPeriods = (periods: IncomePeriod[], year: number) =>
  periods.reduce((sum, p) => sum + periodSalary(p, year), 0);

export const bonusFromPeriods = (periods: IncomePeriod[]) =>
  periods.reduce((sum, p) => sum + (p.bonus || 0), 0);

// Months (1–12) a period touches: the months its paydays land in, or its plain
// month range.
export function periodMonthList(p: IncomePeriod, year: number): number[] {
  if (isScheduled(p)) return [...new Set(payDatesInYear(p, year).map((d) => d.getUTCMonth() + 1))];
  const out: number[] = [];
  for (let m = Math.max(1, p.startMonth); m <= Math.min(12, p.endMonth); m++) out.push(m);
  return out;
}

// Every month touched by at least one period. A Set, so two overlapping jobs
// still count as one month of coverage.
export function coveredMonths(periods: IncomePeriod[], year: number): Set<number> {
  const set = new Set<number>();
  for (const p of periods) for (const m of periodMonthList(p, year)) set.add(m);
  return set;
}

// Months covered by more than one period — legitimate if you hold two jobs at
// once, but worth flagging since the income adds up.
export function overlappingMonths(periods: IncomePeriod[], year: number): number[] {
  const count = new Map<number, number>();
  for (const p of periods) {
    for (const m of periodMonthList(p, year)) count.set(m, (count.get(m) ?? 0) + 1);
  }
  return [...count.entries()].filter(([, n]) => n > 1).map(([m]) => m).sort((a, b) => a - b);
}

// "Aug", "Aug–Dec", "Jan–Mar, Aug–Dec" — collapses consecutive months.
export function fmtMonths(months: number[]): string {
  if (!months.length) return "";
  const sorted = [...months].sort((a, b) => a - b);
  const runs: [number, number][] = [];
  for (const m of sorted) {
    const last = runs[runs.length - 1];
    if (last && m === last[1] + 1) last[1] = m;
    else runs.push([m, m]);
  }
  return runs
    .map(([a, b]) => (a === b ? MONTH_NAMES[a - 1] : `${MONTH_NAMES[a - 1]}–${MONTH_NAMES[b - 1]}`))
    .join(", ");
}

// A benefit plan's contract year. Blank dates mean the calendar tax year — the
// usual case for 401(k) and HSA, whose IRS limits are calendar-bound. Health
// and dependent-care FSAs often run on a different plan year (Jul–Jun, say),
// and the election divides across the paychecks inside *that* window, not the
// tax year's.
export type PlanWindow = { start: string; end: string };
export type PlanKey = "k401" | "hsa" | "fsaHealth" | "fsaDcare";

export const EMPTY_WINDOW: PlanWindow = { start: "", end: "" };

// Applied to periods that have never had a pay schedule set.
export const NO_SCHEDULE = { cadence: "months" as PayCadence, firstPayDate: "", lastPayDate: "" };

export function planRange(w: PlanWindow | undefined, year: number): { start: Date; end: Date } {
  return {
    start: parseDate(w?.start ?? "") ?? startOfYear(year),
    end: parseDate(w?.end ?? "") ?? endOfYear(year),
  };
}

export type IncomeState = {
  periods: IncomePeriod[];
  other: number;
  filing: "single" | "mfj";
  ageBand: AgeBand;
  hsaCoverage: "single" | "family";
  ficaExempt: boolean; // nonresident alien student (F-1/J-1/M-1/Q) FICA exemption
  stateCode: string;
  trad401: number; // Traditional 401(k), annual $, pre-tax
  roth401: number; // Roth 401(k), annual $, post-tax
  k401Employer: number;
  hsaContrib: number;
  fsaContrib: number;
  fsaDependentCare: number;
  tradIra: number; // Traditional IRA, $, pre-tax (deductible)
  rothIra: number; // Roth IRA, $, post-tax
  // Per-field entry mode ($ amount vs % of gross income). $ amounts above are
  // always the source of truth; % is purely a display/entry convenience.
  modes: Partial<Record<ContribKey, EntryMode>>;
  allocations: AllocationItem[];
  // What "monthly" means for take-home and allocations: spread the year's
  // take-home over all 12 months, or only over the months you actually earn.
  // Identical for a full year; very different for an August start.
  allocBasis: "worked" | "year";
  // Contract year per benefit account, for dividing an election across the
  // paychecks that actually fall inside it.
  plans: Record<PlanKey, PlanWindow>;
};

// Scalar contribution fields that support the $/% entry toggle.
export type ContribKey =
  | "trad401" | "roth401" | "k401Employer"
  | "hsaContrib" | "fsaContrib" | "fsaDependentCare"
  | "tradIra" | "rothIra";

export const DEFAULT: IncomeState = {
  periods: [
    {
      label: "Full year",
      annualRate: 0,
      startMonth: 1,
      endMonth: 12,
      bonus: 0,
      cadence: "months",
      firstPayDate: "",
      lastPayDate: "",
    },
  ],
  other: 0,
  filing: "single",
  ageBand: "under50",
  hsaCoverage: "single",
  ficaExempt: false,
  stateCode: "",
  trad401: 0,
  roth401: 0,
  k401Employer: 0,
  hsaContrib: 0,
  fsaContrib: 0,
  fsaDependentCare: 0,
  tradIra: 0,
  rothIra: 0,
  modes: {},
  allocations: [
    { label: "Rent / Housing", amount: 0 },
    { label: "Investments (taxable)", amount: 0 },
    { label: "Emergency Fund", amount: 0 },
    { label: "Discretionary", amount: 0 },
  ],
  allocBasis: "worked",
  plans: { k401: EMPTY_WINDOW, hsa: EMPTY_WINDOW, fsaHealth: EMPTY_WINDOW, fsaDcare: EMPTY_WINDOW },
};

// The most recent tax year with federal tables coded in this file. New years
// added to FEDERAL_BY_YEAR become the default automatically.
export const APP_TAX_YEAR = LATEST_FEDERAL_YEAR;
export const STORAGE_KEY = "income-organizer";

// A frozen, self-contained record saved to the log. Stores both the inputs and
// the computed headline results so a past year stays accurate even after its
// bracket tables are no longer in the code.
export type YearSnapshot = {
  id: string;
  year: number;
  savedAt: string; // ISO date
  state: IncomeState;
  results: {
    grossIncome: number;
    totalTax: number;
    takeHome: number;
    totalRetirement: number;
  };
};

// Top-level persisted shape: one editable IncomeState per year, plus the log.
export type Store = {
  activeYear: number;
  years: Record<string, IncomeState>;
  log: YearSnapshot[];
};

/* eslint-disable @typescript-eslint/no-explicit-any */
// Bring a single year's saved state up to the current shape, handling every
// legacy field rename (age50plus→ageBand, stateRate→stateCode, 401k %→$,
// salary→periods, period months→startMonth/endMonth, top-level bonus→period bonus).
export function migrateState(raw: any): IncomeState {
  const parsed = { ...raw };
  const validBands = ["under50", "50to54", "55to59", "60to63", "64plus"];
  if (!validBands.includes(parsed.ageBand)) {
    parsed.ageBand = parsed.ageBand === "50to59" || parsed.age50plus ? "50to54" : "under50";
  }
  if (parsed.stateCode === undefined) parsed.stateCode = "";
  const salary = typeof parsed.salary === "number" ? parsed.salary : 0;
  if (parsed.trad401 === undefined) {
    const p = parsed.trad401Pct ?? parsed.k401Pct ?? 0;
    parsed.trad401 = (p / 100) * salary;
  }
  if (parsed.roth401 === undefined && parsed.roth401Pct !== undefined) {
    parsed.roth401 = (parsed.roth401Pct / 100) * salary;
  }
  if (!Array.isArray(parsed.periods) || parsed.periods.length === 0) {
    parsed.periods = [
      { label: "Full year", annualRate: salary, startMonth: 1, endMonth: 12, bonus: 0, ...NO_SCHEDULE },
    ];
  } else {
    // Legacy periods carried only a month *count*. Lay them out back-to-back
    // starting in January, which is what that count implied.
    let cursor = 1;
    parsed.periods = parsed.periods.map((p: any) => {
      const bonus = Number(p.bonus) || 0;
      // Periods predating pay schedules stay on the whole-month cadence.
      const schedule = CADENCES.some((c) => c.value === p.cadence)
        ? { cadence: p.cadence as PayCadence, firstPayDate: p.firstPayDate ?? "", lastPayDate: p.lastPayDate ?? "" }
        : NO_SCHEDULE;
      if (Number.isFinite(p.startMonth) && Number.isFinite(p.endMonth)) {
        const startMonth = clampMonth(p.startMonth);
        return {
          label: p.label ?? "",
          annualRate: Number(p.annualRate) || 0,
          startMonth,
          endMonth: Math.max(startMonth, clampMonth(p.endMonth)),
          bonus,
          ...schedule,
        };
      }
      const len = Math.max(1, Math.min(12, Math.round(Number(p.months) || 0) || 12));
      const startMonth = clampMonth(cursor);
      const endMonth = Math.min(12, startMonth + len - 1);
      cursor = endMonth + 1;
      return {
        label: p.label ?? "",
        annualRate: Number(p.annualRate) || 0,
        startMonth,
        endMonth,
        bonus,
        ...schedule,
      };
    });
  }
  // A single annual bonus field used to sit next to salary; attach it to the
  // first period so it stays in the gross total.
  if (typeof parsed.bonus === "number" && parsed.bonus !== 0) {
    parsed.periods[0].bonus = (parsed.periods[0].bonus || 0) + parsed.bonus;
  }
  if (parsed.allocBasis !== "worked" && parsed.allocBasis !== "year") parsed.allocBasis = "worked";
  const plans: Record<PlanKey, PlanWindow> = { ...DEFAULT.plans };
  for (const key of ["k401", "hsa", "fsaHealth", "fsaDcare"] as PlanKey[]) {
    const w = parsed.plans?.[key];
    plans[key] = { start: typeof w?.start === "string" ? w.start : "", end: typeof w?.end === "string" ? w.end : "" };
  }
  parsed.plans = plans;
  if (typeof parsed.modes !== "object" || parsed.modes === null) parsed.modes = {};
  delete parsed.bonus;
  delete parsed.salary;
  delete parsed.age50plus;
  delete parsed.stateRate;
  delete parsed.k401Pct;
  delete parsed.trad401Pct;
  delete parsed.roth401Pct;
  return { ...DEFAULT, ...parsed };
}

export function freshStore(): Store {
  return { activeYear: APP_TAX_YEAR, years: { [APP_TAX_YEAR]: DEFAULT }, log: [] };
}

export function parseStore(parsed: any): Store {
  try {
    if (!parsed) return freshStore();
    if (parsed.years && typeof parsed.years === "object") {
      const years: Record<string, IncomeState> = {};
      for (const [yr, st] of Object.entries(parsed.years)) years[yr] = migrateState(st);
      const activeYear = parsed.activeYear ?? APP_TAX_YEAR;
      if (!years[activeYear]) years[activeYear] = DEFAULT;
      return { activeYear, years, log: Array.isArray(parsed.log) ? parsed.log : [] };
    }
    // legacy single-blob shape → wrap into the current year
    return { activeYear: APP_TAX_YEAR, years: { [APP_TAX_YEAR]: migrateState(parsed) }, log: [] };
  } catch {
    return freshStore();
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// Gross pay through take-home for one year's inputs.
export function computeTaxes(s: IncomeState, year: number) {
  const { tables } = federalFor(year);
  const salaryTotal = salaryFromPeriods(s.periods, year);
  const bonusTotal = bonusFromPeriods(s.periods);
  const grossIncome = salaryTotal + bonusTotal + s.other;

  // pre-tax deductions reduce AGI (Traditional 401k + Traditional IRA + HSA + FSAs)
  const preTaxDeductions = s.trad401 + s.tradIra + s.hsaContrib + s.fsaContrib + s.fsaDependentCare;
  const agi = Math.max(0, grossIncome - preTaxDeductions);
  const stdDeduction = tables.standardDeduction[s.filing];
  const taxableIncome = Math.max(0, agi - stdDeduction);

  const federalTax = calcFederalTax(taxableIncome, s.filing, tables);
  const brackets = s.filing === "single" ? tables.bracketsSingle : tables.bracketsMfj;
  const marginalRate = brackets.find((b) => taxableIncome <= b.up_to)?.rate ?? 0.37;

  // FICA — exempt for nonresident alien students (F-1/J-1/M-1/Q) under IRC §3121(b)(19)
  const ssTax = s.ficaExempt ? 0 : Math.min(grossIncome, tables.limits.ss_wage_base) * 0.062;
  const medicareTax = s.ficaExempt ? 0 : grossIncome * 0.0145 + Math.max(0, grossIncome - 200000) * 0.009;
  const ficaTax = ssTax + medicareTax;

  // state tax — progressive brackets applied to AGI
  const stateTax = calcStateTax(agi, s.stateCode, year);
  const totalTax = federalTax + ficaTax + stateTax;

  // post-tax (Roth 401k + Roth IRA come out of after-tax dollars)
  const netAfterTaxAndPretax = grossIncome - preTaxDeductions - totalTax;
  const postTaxRetirement = s.roth401 + s.rothIra;
  const takeHome = netAfterTaxAndPretax - postTaxRetirement;

  return {
    salaryTotal, bonusTotal, grossIncome, preTaxDeductions, agi, stdDeduction, taxableIncome,
    federalTax, marginalRate, ssTax, medicareTax, ficaTax, stateTax, totalTax,
    netAfterTaxAndPretax, postTaxRetirement, takeHome,
  };
}
