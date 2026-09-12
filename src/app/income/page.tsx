"use client";

import { useState, useEffect, useCallback } from "react";
import { statesForYear, calcStateTax, effectiveStateRate, type StateInfo } from "@/data/state-tax-brackets";
import { loadSynced, pushSynced } from "@/lib/ui-state";

// ── Federal tax tables by year ───────────────────────────────────────────────
// Each tax year holds its own IRS limits, brackets, and standard deduction. To
// add a year (e.g. when the IRS publishes 2027 figures), drop in a new entry —
// nothing else needs to change. Consumers resolve the right tables with
// federalFor(year), which falls back to the most recent coded year.
type FederalLimits = {
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

type TaxBracket = { up_to: number; rate: number };

type FederalTables = {
  limits: FederalLimits;
  bracketsSingle: TaxBracket[];
  bracketsMfj: TaxBracket[];
  standardDeduction: { single: number; mfj: number };
};

const FEDERAL_BY_YEAR: Record<number, FederalTables> = {
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

const FEDERAL_YEARS = Object.keys(FEDERAL_BY_YEAR)
  .map(Number)
  .sort((a, b) => a - b);

// The most recent tax year we have federal figures coded for.
const LATEST_FEDERAL_YEAR = FEDERAL_YEARS[FEDERAL_YEARS.length - 1];

// Resolve federal tables for a year: exact match, else the most recent prior
// year available, else the earliest we have.
function federalFor(year: number): { dataYear: number; tables: FederalTables } {
  if (FEDERAL_BY_YEAR[year]) return { dataYear: year, tables: FEDERAL_BY_YEAR[year] };
  const prior = FEDERAL_YEARS.filter((y) => y <= year);
  const dataYear = prior.length ? prior[prior.length - 1] : FEDERAL_YEARS[0];
  return { dataYear, tables: FEDERAL_BY_YEAR[dataYear] };
}

type AgeBand = "under50" | "50to54" | "55to59" | "60to63" | "64plus";

const AGE_BANDS: { value: AgeBand; label: string }[] = [
  { value: "under50", label: "Under 50" },
  { value: "50to54", label: "50–54" },
  { value: "55to59", label: "55–59 (HSA catch-up)" },
  { value: "60to63", label: "60–63 (super catch-up)" },
  { value: "64plus", label: "64+" },
];

const is50plus = (band: AgeBand) => band !== "under50";
const is55plus = (band: AgeBand) => band === "55to59" || band === "60to63" || band === "64plus";

function k401LimitFor(band: AgeBand, L: FederalLimits): number {
  if (band === "under50") return L.k401_under50;
  if (band === "60to63") return L.k401_60to63;
  return L.k401_50to59_64plus; // 50–54, 55–59, and 64+
}

function k401TotalLimitFor(band: AgeBand, L: FederalLimits): number {
  return band === "under50" ? L.k401_total_under50 : L.k401_total_50plus;
}

function calcFederalTax(
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

type EntryMode = "$" | "%";
type AllocationItem = { label: string; amount: number; mode?: EntryMode };

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// How a period pays out. "months" is the coarse mode — a salary rate spread
// over a range of whole months. The others schedule real pay dates from a
// first payday, which is what actually determines how much of a year's salary
// you see and how a deduction divides across paychecks.
type PayCadence = "months" | "weekly" | "biweekly" | "semimonthly" | "monthly";

const CADENCES: { value: PayCadence; label: string; perYear: number }[] = [
  { value: "months", label: "Whole months", perYear: 12 },
  { value: "weekly", label: "Weekly", perYear: 52 },
  { value: "biweekly", label: "Every 2 weeks", perYear: 26 },
  { value: "semimonthly", label: "Twice a month", perYear: 24 },
  { value: "monthly", label: "Monthly", perYear: 12 },
];

const perYearFor = (c: PayCadence) => CADENCES.find((x) => x.value === c)?.perYear ?? 12;
const isScheduled = (p: IncomePeriod) => p.cadence !== "months";

// An income period within the year: a salary rate that runs either across a
// range of whole months (startMonth–endMonth, 1 = January) or across real pay
// dates from firstPayDate at a fixed cadence, plus any bonus paid during it.
// Either way it records a job that starts mid-year, a gap between jobs, or a
// raise landing in a month other than January, with its bonus attached.
type IncomePeriod = {
  label: string;
  annualRate: number;
  startMonth: number; // 1–12, inclusive — "months" cadence only
  endMonth: number; // 1–12, inclusive — "months" cadence only
  bonus: number;
  cadence: PayCadence;
  firstPayDate: string; // "YYYY-MM-DD" — scheduled cadences only
  lastPayDate: string; // "" while the job is ongoing
};

const clampMonth = (m: number) => Math.min(12, Math.max(1, Math.round(Number(m) || 1)));

const periodMonths = (p: IncomePeriod) => Math.max(0, p.endMonth - p.startMonth + 1);

// ── Dates ────────────────────────────────────────────────────────────────────
// All date maths runs in UTC. Pay dates are calendar facts, not instants, and
// building them locally would shift them a day either side of a DST boundary.
function parseDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

const toISO = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
const startOfYear = (y: number) => new Date(Date.UTC(y, 0, 1));
const endOfYear = (y: number) => new Date(Date.UTC(y, 11, 31));

const fmtDate = (d: Date) =>
  d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

// Move a stored date the same number of years, clamping Feb 29 into range.
function shiftYears(iso: string, delta: number): string {
  const d = parseDate(iso);
  if (!d) return iso;
  const y = d.getUTCFullYear() + delta;
  return toISO(new Date(Date.UTC(y, d.getUTCMonth(), Math.min(d.getUTCDate(), daysInMonth(y, d.getUTCMonth())))));
}

// Twice-monthly pay runs on two days a month about 15 days apart — the 15th and
// the last day, the 1st and 16th, and so on. Derive the pair from the first
// payday rather than asking for both.
function semiMonthlyAnchors(day: number): number[] {
  const other = day <= 15 ? day + 15 : day - 15;
  return [...new Set([day, other])].sort((a, b) => a - b);
}

// Every payday for one period falling in [from, to], never past the period's
// own last payday. Windows may run outside the tax year — an FSA plan year
// ending in June needs next year's paychecks to divide the election correctly.
function payDatesBetween(p: IncomePeriod, from: Date, to: Date): Date[] {
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

const payDatesInYear = (p: IncomePeriod, year: number) =>
  payDatesBetween(p, startOfYear(year), endOfYear(year));

// Paychecks landing in a window across every scheduled period — the divisor
// for turning an annual election into a per-paycheck deduction.
function paychecksBetween(periods: IncomePeriod[], from: Date, to: Date): number {
  return periods.reduce((n, p) => n + payDatesBetween(p, from, to).length, 0);
}

// Salary this period actually contributes to the tax year: scheduled periods
// pay a fixed slice of the annual rate per payday, so a mid-August start earns
// exactly the paychecks that land before New Year, not a fraction of a month.
function periodSalary(p: IncomePeriod, year: number): number {
  if (isScheduled(p)) return (p.annualRate / perYearFor(p.cadence)) * payDatesInYear(p, year).length;
  return (p.annualRate * periodMonths(p)) / 12;
}

const salaryFromPeriods = (periods: IncomePeriod[], year: number) =>
  periods.reduce((sum, p) => sum + periodSalary(p, year), 0);

const bonusFromPeriods = (periods: IncomePeriod[]) =>
  periods.reduce((sum, p) => sum + (p.bonus || 0), 0);

// Months (1–12) a period touches: the months its paydays land in, or its plain
// month range.
function periodMonthList(p: IncomePeriod, year: number): number[] {
  if (isScheduled(p)) return [...new Set(payDatesInYear(p, year).map((d) => d.getUTCMonth() + 1))];
  const out: number[] = [];
  for (let m = Math.max(1, p.startMonth); m <= Math.min(12, p.endMonth); m++) out.push(m);
  return out;
}

// Every month touched by at least one period. A Set, so two overlapping jobs
// still count as one month of coverage.
function coveredMonths(periods: IncomePeriod[], year: number): Set<number> {
  const set = new Set<number>();
  for (const p of periods) for (const m of periodMonthList(p, year)) set.add(m);
  return set;
}

// Months covered by more than one period — legitimate if you hold two jobs at
// once, but worth flagging since the income adds up.
function overlappingMonths(periods: IncomePeriod[], year: number): number[] {
  const count = new Map<number, number>();
  for (const p of periods) {
    for (const m of periodMonthList(p, year)) count.set(m, (count.get(m) ?? 0) + 1);
  }
  return [...count.entries()].filter(([, n]) => n > 1).map(([m]) => m).sort((a, b) => a - b);
}

// "Aug", "Aug–Dec", "Jan–Mar, Aug–Dec" — collapses consecutive months.
function fmtMonths(months: number[]): string {
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
type PlanWindow = { start: string; end: string };
type PlanKey = "k401" | "hsa" | "fsaHealth" | "fsaDcare";

const EMPTY_WINDOW: PlanWindow = { start: "", end: "" };

// Applied to periods that have never had a pay schedule set.
const NO_SCHEDULE = { cadence: "months" as PayCadence, firstPayDate: "", lastPayDate: "" };

function planRange(w: PlanWindow | undefined, year: number): { start: Date; end: Date } {
  return {
    start: parseDate(w?.start ?? "") ?? startOfYear(year),
    end: parseDate(w?.end ?? "") ?? endOfYear(year),
  };
}

type IncomeState = {
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
type ContribKey =
  | "trad401" | "roth401" | "k401Employer"
  | "hsaContrib" | "fsaContrib" | "fsaDependentCare"
  | "tradIra" | "rothIra";

const DEFAULT: IncomeState = {
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
const APP_TAX_YEAR = LATEST_FEDERAL_YEAR;
const STORAGE_KEY = "income-organizer";

// A frozen, self-contained record saved to the log. Stores both the inputs and
// the computed headline results so a past year stays accurate even after its
// bracket tables are no longer in the code.
type YearSnapshot = {
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
type Store = {
  activeYear: number;
  years: Record<string, IncomeState>;
  log: YearSnapshot[];
};

function fmt(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

// Per-paycheck figures are payroll-form values — they need the cents.
function fmtCents(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
}

function pct(n: number, total: number) {
  if (total === 0) return "0%";
  return ((n / total) * 100).toFixed(1) + "%";
}

function Row({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between py-1.5 border-b border-black/5 dark:border-white/5 last:border-0 ${warn ? "text-amber-600 dark:text-amber-400" : ""}`}>
      <span className="text-sm">{label}</span>
      <span className="font-mono text-sm font-medium tabular-nums">
        {value}
        {sub && <span className="ml-1.5 text-xs text-black/40 dark:text-white/40">{sub}</span>}
      </span>
    </div>
  );
}

// A money input with an independent $/% toggle. The stored value is always a $
// amount; when mode is "%", the field shows and accepts a percentage of `base`
// (gross income for contributions, monthly take-home for allocations).
function MoneyInput({
  label, value, onChange, base, mode, onModeChange, step, hint, max,
}: {
  label: string; value: number; onChange: (v: number) => void;
  base: number; mode: EntryMode; onModeChange: (m: EntryMode) => void;
  step?: number; hint?: string; max?: number;
}) {
  const isPct = mode === "%";
  const display = isPct ? (base > 0 ? Math.round((value / base) * 10000) / 100 : 0) : value;
  // The equivalent in the other unit, shown as a subtle hint.
  const equiv = isPct
    ? fmt(value)
    : base > 0
      ? `${((value / base) * 100).toFixed(1)}% of ${label.includes("Allocation") ? "take-home" : "gross"}`
      : null;
  return (
    <div className="flex flex-col gap-0.5">
      <label className="text-xs text-black/50 dark:text-white/50">{label}</label>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onModeChange(isPct ? "$" : "%")}
          title="Toggle between dollar amount and percent of gross income"
          className="w-6 shrink-0 rounded border border-black/10 dark:border-white/10 py-1 text-sm font-medium text-black/50 hover:text-foreground dark:text-white/50"
        >
          {isPct ? "%" : "$"}
        </button>
        <input
          type="number"
          min={0}
          max={isPct ? undefined : max}
          step={isPct ? 0.5 : (step ?? 1)}
          value={display || ""}
          onChange={(e) => {
            const raw = Number(e.target.value) || 0;
            onChange(isPct ? (base > 0 ? (raw / 100) * base : 0) : raw);
          }}
          placeholder="0"
          className="w-full rounded border border-black/10 dark:border-white/10 bg-transparent px-2 py-1 text-sm font-mono tabular-nums focus:outline-none focus:ring-1 focus:ring-black/20 dark:focus:ring-white/20"
        />
      </div>
      {(hint || equiv) && (
        <span className="text-xs text-black/35 dark:text-white/35">
          {hint}
          {hint && equiv && " · "}
          {equiv}
        </span>
      )}
    </div>
  );
}

// Cycled per-period fills so adjacent jobs read as distinct blocks.
const PERIOD_TINTS = [
  "bg-blue-500/70",
  "bg-emerald-500/70",
  "bg-amber-500/70",
  "bg-violet-500/70",
  "bg-rose-500/70",
];

// A 12-cell calendar bar showing which months each income period covers, so
// gaps between jobs and mid-year starts are obvious at a glance.
function MonthStrip({ periods, year }: { periods: IncomePeriod[]; year: number }) {
  const owner = new Map<number, number>(); // month → first period covering it
  const doubled = new Set<number>();
  periods.forEach((p, i) => {
    for (const m of periodMonthList(p, year)) {
      if (owner.has(m)) doubled.add(m);
      else owner.set(m, i);
    }
  });
  return (
    <div className="flex gap-0.5">
      {MONTH_NAMES.map((name, i) => {
        const m = i + 1;
        const idx = owner.get(m);
        const label = idx === undefined ? "no income" : periods[idx].label || `Period ${idx + 1}`;
        return (
          <div
            key={name}
            title={`${name} · ${label}${doubled.has(m) ? " (+ overlapping period)" : ""}`}
            className={`flex-1 rounded-sm py-0.5 text-center text-[10px] font-medium ${
              idx === undefined
                ? "bg-black/[0.06] text-black/30 dark:bg-white/[0.08] dark:text-white/30"
                : `${PERIOD_TINTS[idx % PERIOD_TINTS.length]} text-white`
            } ${doubled.has(m) ? "ring-1 ring-amber-500" : ""}`}
          >
            {name}
          </div>
        );
      })}
    </div>
  );
}

function Section({ title, info, children }: { title: string; info?: React.ReactNode; children: React.ReactNode }) {
  const [showInfo, setShowInfo] = useState(false);
  return (
    <div className="rounded-lg border border-black/10 dark:border-white/10 p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">{title}</h2>
        {info && (
          <button
            type="button"
            onClick={() => setShowInfo((v) => !v)}
            className="shrink-0 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
          >
            {showInfo ? "Hide" : "What's this?"}
          </button>
        )}
      </div>
      {info && showInfo && (
        <div className="mb-3 rounded-md border border-black/10 bg-black/[0.02] p-3 text-xs leading-relaxed text-black/60 dark:border-white/10 dark:bg-white/[0.03] dark:text-white/60">
          {info}
        </div>
      )}
      {children}
    </div>
  );
}

// One labelled explanation line inside an info panel.
function InfoItem({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <p className="mb-1.5 last:mb-0">
      <strong className="text-black/75 dark:text-white/75">{term}:</strong> {children}
    </p>
  );
}

// Renders the selected state's income-tax brackets as a small table for the
// dataset in effect for `year` (falls back to the latest available year).
function StateBracketsInfo({ code, year }: { code: string; year: number }) {
  const { dataYear, states } = statesForYear(year);
  const st: StateInfo | undefined = states[code];
  const stale = dataYear !== year;
  const staleNote = stale ? ` (latest available; ${year} not yet published)` : "";
  if (!code || !st) {
    return <p>Select a state above to see its {dataYear} income-tax brackets{staleNote} (single filer).</p>;
  }
  const noTax = st.brackets.every((b) => b.rate === 0);
  if (noTax) {
    return (
      <p>
        <strong>{st.name}</strong> has no state income tax on wages.
      </p>
    );
  }
  const flat = st.brackets.length === 1;
  const dollars = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
  return (
    <div>
      <p className="mb-2">
        <strong>{st.name}</strong> {flat ? "flat tax" : `${dataYear} brackets`}
        {staleNote} (single filer), applied to your AGI:
      </p>
      <table className="w-full tabular-nums">
        <thead>
          <tr className="text-black/40 dark:text-white/40">
            <th className="py-0.5 text-left font-medium">Taxable income</th>
            <th className="py-0.5 text-right font-medium">Rate</th>
          </tr>
        </thead>
        <tbody>
          {st.brackets.map((b, i) => {
            const prev = i === 0 ? 0 : st.brackets[i - 1].upTo;
            const range = !Number.isFinite(b.upTo)
              ? `${dollars(prev)} and up`
              : i === 0
                ? `Up to ${dollars(b.upTo)}`
                : `${dollars(prev)} – ${dollars(b.upTo)}`;
            return (
              <tr key={i} className="border-t border-black/5 dark:border-white/5">
                <td className="py-0.5 text-left">{range}</td>
                <td className="py-0.5 text-right font-medium">{(b.rate * 100).toFixed(2)}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function NumberInput({
  label, value, onChange, prefix, suffix, min, max, step, hint,
}: {
  label: string; value: number; onChange: (v: number) => void;
  prefix?: string; suffix?: string; min?: number; max?: number; step?: number; hint?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <label className="text-xs text-black/50 dark:text-white/50">{label}</label>
      <div className="flex items-center gap-1">
        {prefix && <span className="text-sm text-black/40 dark:text-white/40">{prefix}</span>}
        <input
          type="number"
          min={min ?? 0}
          max={max}
          step={step ?? 1}
          value={value || ""}
          onChange={(e) => onChange(Number(e.target.value) || 0)}
          placeholder="0"
          className="w-full rounded border border-black/10 dark:border-white/10 bg-transparent px-2 py-1 text-sm font-mono tabular-nums focus:outline-none focus:ring-1 focus:ring-black/20 dark:focus:ring-white/20"
        />
        {suffix && <span className="text-sm text-black/40 dark:text-white/40">{suffix}</span>}
      </div>
      {hint && <span className="text-xs text-black/35 dark:text-white/35">{hint}</span>}
    </div>
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */
// Bring a single year's saved state up to the current shape, handling every
// legacy field rename (age50plus→ageBand, stateRate→stateCode, 401k %→$,
// salary→periods, period months→startMonth/endMonth, top-level bonus→period bonus).
function migrateState(raw: any): IncomeState {
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

function freshStore(): Store {
  return { activeYear: APP_TAX_YEAR, years: { [APP_TAX_YEAR]: DEFAULT }, log: [] };
}

function parseStore(parsed: any): Store {
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

export default function IncomePage() {
  const [store, setStore] = useState<Store>(freshStore);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // server copy (data/ui-state.json) wins; falls back to this browser's
      // localStorage, which also seeds the server on the first load
      const v = await loadSynced(STORAGE_KEY);
      if (cancelled) return;
      setStore(parseStore(v));
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

  const saveStore = useCallback((next: Store) => {
    setStore(next);
    pushSynced(STORAGE_KEY, next);
  }, []);

  const s = store.years[store.activeYear] ?? DEFAULT;

  // Tax tables in effect for the active year (fall back to the latest coded
  // year when that exact year hasn't been loaded).
  const fed = federalFor(store.activeYear);
  const L = fed.tables.limits;
  const stateData = statesForYear(store.activeYear);
  const fedStale = fed.dataYear !== store.activeYear;
  const stateStale = stateData.dataYear !== store.activeYear;

  const upd = (patch: Partial<IncomeState>) =>
    saveStore({ ...store, years: { ...store.years, [store.activeYear]: { ...s, ...patch } } });

  // Edit one period, keeping its range valid: moving the start past the end
  // drags the end along, and vice versa.
  const updPeriod = (i: number, patch: Partial<IncomePeriod>) => {
    const next = [...s.periods];
    const merged = { ...next[i], ...patch };
    if (patch.startMonth !== undefined) merged.endMonth = Math.max(merged.endMonth, merged.startMonth);
    if (patch.endMonth !== undefined) merged.startMonth = Math.min(merged.startMonth, merged.endMonth);
    next[i] = merged;
    upd({ periods: next });
  };

  // A new period fills the first stretch of months nothing covers yet — the
  // months before a mid-year start, or the gap left by a job change. With the
  // year already full, it appends after the last period instead.
  const addPeriod = () => {
    const taken = coveredMonths(s.periods, store.activeYear);
    const firstFree = Array.from({ length: 12 }, (_, i) => i + 1).find((m) => !taken.has(m));
    let startMonth: number;
    let endMonth: number;
    if (firstFree === undefined) {
      startMonth = clampMonth(s.periods.reduce((m, p) => Math.max(m, p.endMonth), 0) + 1);
      endMonth = 12;
    } else {
      startMonth = firstFree;
      endMonth = firstFree;
      while (endMonth < 12 && !taken.has(endMonth + 1)) endMonth++;
    }
    upd({
      periods: [...s.periods, { label: "", annualRate: 0, startMonth, endMonth, bonus: 0, ...NO_SCHEDULE }],
    });
  };

  const updPlan = (key: PlanKey, patch: Partial<PlanWindow>) =>
    upd({ plans: { ...s.plans, [key]: { ...s.plans[key], ...patch } } });

  const modeOf = (key: ContribKey): EntryMode => s.modes[key] ?? "$";
  const setMode = (key: ContribKey, m: EntryMode) => upd({ modes: { ...s.modes, [key]: m } });

  const switchYear = (year: number) => {
    const years = { ...store.years };
    if (!years[year]) years[year] = DEFAULT;
    saveStore({ ...store, activeYear: year, years });
  };

  // Add the next calendar year, carrying over the current year's settings as a
  // starting point (you typically just bump the numbers year to year).
  const addYear = () => {
    const next = Math.max(...Object.keys(store.years).map(Number)) + 1;
    const delta = next - store.activeYear;
    const copy = structuredClone(s);
    // Pay dates and plan windows are anchored to a calendar; carrying them over
    // verbatim would leave next year's paydays sitting in this year.
    copy.periods = copy.periods.map((p) => ({
      ...p,
      firstPayDate: shiftYears(p.firstPayDate, delta),
      lastPayDate: shiftYears(p.lastPayDate, delta),
    }));
    for (const key of Object.keys(copy.plans) as PlanKey[]) {
      copy.plans[key] = {
        start: shiftYears(copy.plans[key].start, delta),
        end: shiftYears(copy.plans[key].end, delta),
      };
    }
    saveStore({ ...store, activeYear: next, years: { ...store.years, [next]: copy } });
  };

  const sortedYears = Object.keys(store.years)
    .map(Number)
    .sort((a, b) => b - a);

  // --- calculations ---
  const year = store.activeYear;
  const salaryTotal = salaryFromPeriods(s.periods, year);
  const bonusTotal = bonusFromPeriods(s.periods);
  const covered = coveredMonths(s.periods, year);
  const monthsWorked = covered.size;
  const gapMonths = Array.from({ length: 12 }, (_, i) => i + 1).filter((m) => !covered.has(m));
  const overlaps = overlappingMonths(s.periods, year);
  const grossIncome = salaryTotal + bonusTotal + s.other;

  // Paychecks landing inside the tax year, across every scheduled period.
  const scheduled = s.periods.filter(isScheduled);
  const paychecksThisYear = paychecksBetween(s.periods, startOfYear(year), endOfYear(year));
  const hasSchedule = scheduled.length > 0;

  // 401(k): Traditional + Roth share one elective deferral limit
  const k401Limit = k401LimitFor(s.ageBand, L);
  const k401TotalLimit = k401TotalLimitFor(s.ageBand, L);
  const trad401 = s.trad401; // pre-tax
  const roth401 = s.roth401; // post-tax
  const k401Elective = trad401 + roth401; // counts toward elective limit
  const k401Total = k401Elective + s.k401Employer; // counts toward total-additions limit

  // IRA: Traditional + Roth share one contribution limit
  const iraLimit = is50plus(s.ageBand) ? L.roth_ira_catchup : L.roth_ira;
  const iraTotal = s.tradIra + s.rothIra;
  const rothLimit = iraLimit; // Roth IRA shares the IRA limit (further reduced by income phase-out below)

  const hsaLimit =
    (s.hsaCoverage === "family" ? L.hsa_family : L.hsa_single) +
    (is55plus(s.ageBand) ? L.hsa_catchup : 0);

  // pre-tax deductions reduce AGI (Traditional 401k + Traditional IRA + HSA + FSAs)
  const preTaxDeductions = trad401 + s.tradIra + s.hsaContrib + s.fsaContrib + s.fsaDependentCare;
  const agi = Math.max(0, grossIncome - preTaxDeductions);
  const stdDeduction = fed.tables.standardDeduction[s.filing];
  const taxableIncome = Math.max(0, agi - stdDeduction);

  // federal tax
  const federalTax = calcFederalTax(taxableIncome, s.filing, fed.tables);
  const effectiveFedRate = grossIncome > 0 ? federalTax / grossIncome : 0;
  const marginalRate = (() => {
    const brackets = s.filing === "single" ? fed.tables.bracketsSingle : fed.tables.bracketsMfj;
    for (const b of brackets) if (taxableIncome <= b.up_to) return b.rate;
    return 0.37;
  })();

  // FICA
  // FICA — exempt for nonresident alien students (F-1/J-1/M-1/Q) under IRC §3121(b)(19)
  const ssTaxable = Math.min(grossIncome, L.ss_wage_base);
  const ssTax = s.ficaExempt ? 0 : ssTaxable * 0.062;
  const medicareTax = s.ficaExempt ? 0 : grossIncome * 0.0145 + Math.max(0, grossIncome - 200000) * 0.009;
  const ficaTax = ssTax + medicareTax;

  // state tax — progressive brackets applied to AGI
  const stateTax = calcStateTax(agi, s.stateCode, store.activeYear);
  const stateEffRate = effectiveStateRate(agi, s.stateCode, store.activeYear);
  const stateMarginalRate = (() => {
    const st = stateData.states[s.stateCode];
    if (!st) return 0;
    for (const b of st.brackets) if (agi <= b.upTo) return b.rate;
    return st.brackets[st.brackets.length - 1].rate;
  })();

  const totalTax = federalTax + ficaTax + stateTax;

  // post-tax (Roth 401k + Roth IRA come out of after-tax dollars)
  const netAfterTaxAndPretax = grossIncome - preTaxDeductions - totalTax;
  const postTaxRetirement = roth401 + s.rothIra;
  const takeHome = netAfterTaxAndPretax - postTaxRetirement;

  // "Monthly" means take-home divided over either the months you actually earn
  // or all 12 — a partial year makes these very different numbers.
  const basisMonths = s.allocBasis === "worked" ? Math.max(1, monthsWorked) : 12;
  const monthlyTakeHome = takeHome / basisMonths;
  const totalAllocated = s.allocations.reduce((sum, a) => sum + a.amount, 0);
  const unallocated = monthlyTakeHome - totalAllocated;

  // Roth phase-out
  const rothPhaseoutStart = s.filing === "mfj" ? L.roth_phaseout_mfj_start : L.roth_phaseout_single_start;
  const rothPhaseoutEnd = s.filing === "mfj" ? L.roth_phaseout_mfj_end : L.roth_phaseout_single_end;
  const modifiedAgi = agi; // simplified: MAGI ≈ AGI for most W-2 earners
  let effectiveRothLimit = rothLimit;
  if (modifiedAgi >= rothPhaseoutEnd) {
    effectiveRothLimit = 0;
  } else if (modifiedAgi > rothPhaseoutStart) {
    effectiveRothLimit = rothLimit * (1 - (modifiedAgi - rothPhaseoutStart) / (rothPhaseoutEnd - rothPhaseoutStart));
  }

  // violations
  type Violation = { label: string; detail: string; severity: "error" | "warn" };
  const violations: Violation[] = [];

  if (k401Elective > k401Limit) {
    violations.push({ label: "401(k) over elective limit", detail: `Traditional + Roth 401(k) ${fmt(k401Elective)} > ${fmt(k401Limit)} employee limit`, severity: "error" });
  }
  if (k401Total > k401TotalLimit) {
    violations.push({ label: "401(k) over total-additions limit", detail: `employee + employer ${fmt(k401Total)} > ${fmt(k401TotalLimit)} combined limit`, severity: "error" });
  }
  if (iraTotal > iraLimit) {
    violations.push({ label: "IRA over limit", detail: `Traditional + Roth IRA ${fmt(iraTotal)} > ${fmt(iraLimit)} combined limit`, severity: "error" });
  }
  if (s.hsaContrib > hsaLimit) {
    violations.push({ label: "HSA over limit", detail: `${fmt(s.hsaContrib)} > ${fmt(hsaLimit)} limit`, severity: "error" });
  }
  if (s.fsaContrib > L.fsa_health) {
    violations.push({ label: "Health FSA over limit", detail: `${fmt(s.fsaContrib)} > ${fmt(L.fsa_health)} limit`, severity: "error" });
  }
  if (s.fsaDependentCare > L.fsa_dependent_care) {
    violations.push({ label: "Dependent Care FSA over limit", detail: `${fmt(s.fsaDependentCare)} > ${fmt(L.fsa_dependent_care)} limit`, severity: "error" });
  }
  if (s.rothIra > effectiveRothLimit && effectiveRothLimit === 0) {
    violations.push({ label: "Roth IRA — income too high", detail: `MAGI ${fmt(modifiedAgi)} exceeds Roth limit for ${s.filing === "mfj" ? "MFJ" : "single"}`, severity: "error" });
  } else if (s.rothIra > effectiveRothLimit) {
    violations.push({ label: "Roth IRA over limit", detail: `${fmt(s.rothIra)} > ${fmt(effectiveRothLimit)} effective limit (phase-out)`, severity: "error" });
  }
  if (takeHome < 0) {
    violations.push({ label: "Negative take-home", detail: "Deductions + taxes exceed gross income", severity: "error" });
  }
  if (unallocated < 0) {
    violations.push({ label: "Over-allocated", detail: `Monthly allocations exceed take-home by ${fmt(Math.abs(unallocated))}`, severity: "warn" });
  }
  if (overlaps.length > 0) {
    violations.push({
      label: "Overlapping income periods",
      detail: `${fmtMonths(overlaps)} covered by more than one period — those salaries are being added together`,
      severity: "warn",
    });
  }
  for (const p of s.periods) {
    if (isScheduled(p) && !parseDate(p.firstPayDate)) {
      violations.push({
        label: "Pay schedule missing a first payday",
        detail: `"${p.label || "Untitled period"}" is on a ${p.cadence} schedule with no first pay date, so it earns nothing`,
        severity: "error",
      });
    }
  }

  const totalRetirement = k401Total + iraTotal + s.hsaContrib;

  // Each benefit account, resolved against its own contract year: the paychecks
  // that fall inside that window are what an annual election divides across.
  const planGroups: {
    key: PlanKey;
    title: string;
    note: string;
    rows: { label: string; amount: number }[];
  }[] = [
    {
      key: "k401",
      title: "401(k)",
      note: "IRS limit is calendar-year",
      rows: [
        { label: "Traditional", amount: trad401 },
        { label: "Roth", amount: roth401 },
        { label: "Employer match", amount: s.k401Employer },
      ],
    },
    {
      key: "hsa",
      title: "HSA",
      note: "IRS limit is calendar-year",
      rows: [{ label: "Contribution", amount: s.hsaContrib }],
    },
    {
      key: "fsaHealth",
      title: "Health FSA",
      note: "plan year set by your employer",
      rows: [{ label: "Election", amount: s.fsaContrib }],
    },
    {
      key: "fsaDcare",
      title: "Dependent Care FSA",
      note: "plan year set by your employer",
      rows: [{ label: "Election", amount: s.fsaDependentCare }],
    },
  ];

  const planViews = planGroups.map((g) => {
    const { start, end } = planRange(s.plans[g.key], year);
    return { ...g, start, end, checks: paychecksBetween(s.periods, start, end) };
  });

  const saveSnapshot = () => {
    const snap: YearSnapshot = {
      id: `${store.activeYear}-${Date.now()}`,
      year: store.activeYear,
      savedAt: new Date().toISOString(),
      state: structuredClone(s),
      results: { grossIncome, totalTax, takeHome, totalRetirement },
    };
    // newest first
    saveStore({ ...store, log: [snap, ...store.log] });
  };

  const deleteSnapshot = (id: string) =>
    saveStore({ ...store, log: store.log.filter((x) => x.id !== id) });

  if (!loaded) return null;

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Income Organizer</h1>
        <div className="flex items-center gap-2">
          <label className="text-sm text-black/50 dark:text-white/50">Year</label>
          <select
            value={store.activeYear}
            onChange={(e) => switchYear(Number(e.target.value))}
            className="rounded border border-black/10 dark:border-white/10 bg-transparent px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-black/20 dark:focus:ring-white/20"
          >
            {sortedYears.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <button
            onClick={addYear}
            className="rounded border border-black/10 dark:border-white/10 px-2 py-1 text-sm text-black/60 hover:text-foreground dark:text-white/60"
            title="Add next year (copies current settings)"
          >
            + Year
          </button>
        </div>
        <button
          onClick={saveSnapshot}
          className="rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background transition-opacity hover:opacity-90"
        >
          Save {store.activeYear} to log
        </button>
        <span className="ml-auto text-xs text-black/40 dark:text-white/40">
          {fedStale ? `using ${fed.dataYear} IRS tables for ${store.activeYear}` : `${fed.dataYear} IRS limits`} · saved locally
        </span>
      </div>

      {violations.length > 0 && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40 p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-red-600 dark:text-red-400">Violations</p>
          <ul className="space-y-1">
            {violations.map((v, i) => (
              <li key={i} className={`text-sm ${v.severity === "error" ? "text-red-700 dark:text-red-300" : "text-amber-700 dark:text-amber-300"}`}>
                <span className="font-medium">{v.label}</span>
                <span className="ml-2 text-black/50 dark:text-white/40">{v.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* LEFT: inputs */}
        <div className="space-y-5">
          <Section
            title="Gross Income (Annual)"
            info={
              <>
                <InfoItem term="Income periods">
                  One period per job or salary rate. Enter the <strong>annual rate</strong>{" "}
                  (what the offer letter says) — only the part of the year the period covers
                  counts toward this year&apos;s gross.
                </InfoItem>
                <InfoItem term="Whole months">
                  The quick option: pick a <strong>from</strong> and <strong>to</strong>{" "}
                  month. A {fmt(120000)} rate over Aug–Dec counts as {fmt(50000)}, five
                  twelfths of the year.
                </InfoItem>
                <InfoItem term="A real pay schedule">
                  More accurate. Pick a cadence and your <strong>first payday</strong>, and
                  each payday pays the same slice of the annual rate — {fmt(120000)} paid
                  every two weeks is {fmtCents(120000 / 26)} a check, and starting mid-August
                  earns whatever number of checks actually land before New Year. Set a{" "}
                  <strong>last payday</strong> when the job ends; leave it blank while it
                  runs.
                </InfoItem>
                <InfoItem term="Gaps &amp; job changes">
                  Months no period covers earn nothing — leave a gap between jobs and the
                  strip above shows it.
                </InfoItem>
                <InfoItem term="Bonus per period">
                  Bonuses attach to the period that paid them, so a signing bonus at the new
                  job stays with that job rather than floating loose in the year.
                </InfoItem>
              </>
            }
          >
            <div className="space-y-2">
              <MonthStrip periods={s.periods} year={year} />
              {s.periods.map((p, i) => {
                const sched = isScheduled(p);
                const dates = payDatesInYear(p, year);
                const earned = periodSalary(p, year) + (p.bonus || 0);
                const perCheck = sched ? p.annualRate / perYearFor(p.cadence) : 0;
                return (
                  <div key={i} className="rounded-md border border-black/10 dark:border-white/10 p-2.5">
                    <div className="flex items-center gap-2">
                      <input
                        value={p.label}
                        onChange={(e) => updPeriod(i, { label: e.target.value })}
                        placeholder={`e.g. ${i === 0 ? "Old job" : "New job"}`}
                        className="min-w-0 flex-1 rounded border border-black/10 dark:border-white/10 bg-transparent px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-black/20 dark:focus:ring-white/20"
                      />
                      <span className="shrink-0 font-mono text-xs tabular-nums text-black/40 dark:text-white/40">
                        {sched ? `${dates.length} checks` : `${periodMonths(p)} mo`} · {fmt(earned)}
                      </span>
                      <button
                        onClick={() => upd({ periods: s.periods.filter((_, j) => j !== i) })}
                        disabled={s.periods.length === 1}
                        className="w-4 shrink-0 text-lg leading-none text-black/30 hover:text-red-500 dark:text-white/30 disabled:opacity-20"
                        title="Remove period"
                      >
                        ×
                      </button>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-3">
                      <NumberInput
                        label="Salary $/yr"
                        value={p.annualRate}
                        onChange={(v) => updPeriod(i, { annualRate: v })}
                        prefix="$"
                        step={1000}
                      />
                      <div className="flex flex-col gap-0.5">
                        <label className="text-xs text-black/50 dark:text-white/50">Paid</label>
                        <select
                          value={p.cadence}
                          onChange={(e) => updPeriod(i, { cadence: e.target.value as PayCadence })}
                          className="rounded border border-black/10 dark:border-white/10 bg-transparent px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-black/20 dark:focus:ring-white/20"
                        >
                          {CADENCES.map((c) => (
                            <option key={c.value} value={c.value}>{c.label}</option>
                          ))}
                        </select>
                      </div>
                      {sched ? (
                        <>
                          <div className="flex flex-col gap-0.5">
                            <label className="text-xs text-black/50 dark:text-white/50">First payday</label>
                            <input
                              type="date"
                              value={p.firstPayDate}
                              onChange={(e) => updPeriod(i, { firstPayDate: e.target.value })}
                              className="rounded border border-black/10 dark:border-white/10 bg-transparent px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-black/20 dark:focus:ring-white/20"
                            />
                          </div>
                          <div className="flex flex-col gap-0.5">
                            <label className="text-xs text-black/50 dark:text-white/50">Last payday</label>
                            <input
                              type="date"
                              value={p.lastPayDate}
                              onChange={(e) => updPeriod(i, { lastPayDate: e.target.value })}
                              className="rounded border border-black/10 dark:border-white/10 bg-transparent px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-black/20 dark:focus:ring-white/20"
                            />
                            <span className="text-xs text-black/35 dark:text-white/35">blank = ongoing</span>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="flex flex-col gap-0.5">
                            <label className="text-xs text-black/50 dark:text-white/50">From</label>
                            <select
                              value={p.startMonth}
                              onChange={(e) => updPeriod(i, { startMonth: Number(e.target.value) })}
                              className="rounded border border-black/10 dark:border-white/10 bg-transparent px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-black/20 dark:focus:ring-white/20"
                            >
                              {MONTH_NAMES.map((m, mi) => (
                                <option key={m} value={mi + 1}>{m}</option>
                              ))}
                            </select>
                          </div>
                          <div className="flex flex-col gap-0.5">
                            <label className="text-xs text-black/50 dark:text-white/50">To</label>
                            <select
                              value={p.endMonth}
                              onChange={(e) => updPeriod(i, { endMonth: Number(e.target.value) })}
                              className="rounded border border-black/10 dark:border-white/10 bg-transparent px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-black/20 dark:focus:ring-white/20"
                            >
                              {MONTH_NAMES.map((m, mi) => (
                                <option key={m} value={mi + 1}>{m}</option>
                              ))}
                            </select>
                          </div>
                        </>
                      )}
                      <NumberInput
                        label="Bonus"
                        value={p.bonus}
                        onChange={(v) => updPeriod(i, { bonus: v })}
                        prefix="$"
                        step={500}
                      />
                    </div>
                    {sched && dates.length > 0 && (
                      <p className="mt-1.5 text-xs text-black/40 dark:text-white/40">
                        {fmtCents(perCheck)} gross per paycheck · {dates.length} in {year} ·{" "}
                        {fmtDate(dates[0])} → {fmtDate(dates[dates.length - 1])}
                      </p>
                    )}
                  </div>
                );
              })}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  onClick={addPeriod}
                  className="text-xs text-black/40 hover:text-black dark:text-white/40 dark:hover:text-white"
                >
                  + add period (new job, raise, or gap)
                </button>
                <span className="text-xs text-black/40 dark:text-white/40">
                  {monthsWorked}/12 mo
                  {hasSchedule && ` · ${paychecksThisYear} paychecks`} · salary {fmt(salaryTotal)}
                  {bonusTotal > 0 && ` + bonus ${fmt(bonusTotal)}`}
                </span>
              </div>
              {gapMonths.length > 0 && (
                <p className="text-xs text-black/40 dark:text-white/40">
                  No income in {fmtMonths(gapMonths)} — {12 - monthsWorked} month
                  {12 - monthsWorked === 1 ? "" : "s"} of this year earn nothing.
                </p>
              )}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <NumberInput
                label="Other income"
                value={s.other}
                onChange={(v) => upd({ other: v })}
                prefix="$"
                hint="not tied to a period"
              />
            </div>
            <div className="mt-3 flex gap-4 text-xs text-black/50 dark:text-white/50 flex-wrap">
              <label className="flex items-center gap-1.5 cursor-pointer">
                Filing:
                <select
                  value={s.filing}
                  onChange={(e) => upd({ filing: e.target.value as "single" | "mfj" })}
                  className="ml-1 rounded border border-black/10 dark:border-white/10 bg-transparent px-1.5 py-0.5 text-xs focus:outline-none"
                >
                  <option value="single">Single</option>
                  <option value="mfj">Married (MFJ)</option>
                </select>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                Age:
                <select
                  value={s.ageBand}
                  onChange={(e) => upd({ ageBand: e.target.value as AgeBand })}
                  className="ml-1 rounded border border-black/10 dark:border-white/10 bg-transparent px-1.5 py-0.5 text-xs focus:outline-none"
                >
                  {AGE_BANDS.map((b) => (
                    <option key={b.value} value={b.value}>{b.label}</option>
                  ))}
                </select>
              </label>
            </div>
            <label className="mt-3 flex items-start gap-2 text-xs text-black/50 dark:text-white/50 cursor-pointer">
              <input
                type="checkbox"
                checked={s.ficaExempt}
                onChange={(e) => upd({ ficaExempt: e.target.checked })}
                className="mt-0.5"
              />
              <span>
                International student (nonresident alien)
                <span className="block text-black/35 dark:text-white/35">
                  Exempt from Social Security &amp; Medicare on F-1/J-1/M-1/Q visa wages (IRC §3121(b)(19))
                </span>
              </span>
            </label>
          </Section>

          <Section
            title="401(k) — Employer Plan"
            info={
              <>
                <InfoItem term="Traditional 401(k)">
                  Contributions come out <strong>pre-tax</strong>, lowering your taxable income
                  now. Growth is tax-deferred; withdrawals in retirement are taxed as income.
                </InfoItem>
                <InfoItem term="Roth 401(k)">
                  Contributions are <strong>after-tax</strong> (no deduction today), but growth
                  and qualified withdrawals are <strong>tax-free</strong>. No income limit,
                  unlike a Roth IRA.
                </InfoItem>
                <InfoItem term="Shared employee limit">
                  Traditional + Roth together can&apos;t exceed {fmt(k401Limit)} this year
                  {s.ageBand !== "under50" ? " (includes your age catch-up)" : ""}.
                </InfoItem>
                <InfoItem term="Employer match">
                  Free money that counts toward the higher {fmt(k401TotalLimit)}
                  {" "}combined (employee + employer) limit, not the elective limit.
                </InfoItem>
              </>
            }
          >
            <div className="grid grid-cols-2 gap-3">
              <MoneyInput
                label="Traditional 401(k)"
                value={s.trad401}
                onChange={(v) => upd({ trad401: v })}
                base={grossIncome}
                mode={modeOf("trad401")}
                onModeChange={(m) => setMode("trad401", m)}
                step={100}
                hint="pre-tax"
              />
              <MoneyInput
                label="Roth 401(k)"
                value={s.roth401}
                onChange={(v) => upd({ roth401: v })}
                base={grossIncome}
                mode={modeOf("roth401")}
                onModeChange={(m) => setMode("roth401", m)}
                step={100}
                hint="post-tax"
              />
              <MoneyInput
                label="Employer match"
                value={s.k401Employer}
                onChange={(v) => upd({ k401Employer: v })}
                base={grossIncome}
                mode={modeOf("k401Employer")}
                onModeChange={(m) => setMode("k401Employer", m)}
                hint={`counts toward ${fmt(k401TotalLimit)} total limit`}
              />
              <div className="flex flex-col justify-end pb-1 text-xs">
                <span className={k401Elective > k401Limit ? "text-amber-600 dark:text-amber-400" : "text-black/40 dark:text-white/40"}>
                  Elective: {fmt(k401Elective)} / {fmt(k401Limit)}
                </span>
                <span className="text-black/35 dark:text-white/35">Trad + Roth share this limit</span>
              </div>
            </div>
          </Section>

          <Section
            title="IRA"
            info={
              <>
                <InfoItem term="Traditional IRA">
                  <strong>Pre-tax</strong> and deductible (if you qualify), lowering taxable
                  income now; withdrawals are taxed later. Anyone with earned income can
                  contribute.
                </InfoItem>
                <InfoItem term="Roth IRA">
                  <strong>After-tax</strong> contributions grow and are withdrawn
                  <strong> tax-free</strong>. But eligibility <strong>phases out</strong> at
                  higher income — {fmt(rothPhaseoutStart)}–{fmt(rothPhaseoutEnd)} for{" "}
                  {s.filing === "mfj" ? "married filing jointly" : "single filers"}.
                </InfoItem>
                <InfoItem term="Shared limit">
                  Traditional + Roth IRA together cap at {fmt(iraLimit)} this year
                  {s.ageBand !== "under50" ? " (includes 50+ catch-up)" : ""} — separate from
                  your 401(k).
                </InfoItem>
              </>
            }
          >
            <div className="grid grid-cols-2 gap-3">
              <MoneyInput
                label="Traditional IRA"
                value={s.tradIra}
                onChange={(v) => upd({ tradIra: v })}
                base={grossIncome}
                mode={modeOf("tradIra")}
                onModeChange={(m) => setMode("tradIra", m)}
                hint="pre-tax (deductible)"
              />
              <MoneyInput
                label="Roth IRA"
                value={s.rothIra}
                onChange={(v) => upd({ rothIra: v })}
                base={grossIncome}
                mode={modeOf("rothIra")}
                onModeChange={(m) => setMode("rothIra", m)}
                hint="post-tax"
              />
              <div className="col-span-2 text-xs">
                <span className={iraTotal > iraLimit ? "text-amber-600 dark:text-amber-400" : "text-black/40 dark:text-white/40"}>
                  IRA total: {fmt(iraTotal)} / {fmt(iraLimit)} combined limit
                </span>
                {effectiveRothLimit < rothLimit && (
                  <span className="ml-2 text-amber-600 dark:text-amber-400">
                    · Roth capped at {fmt(Math.round(effectiveRothLimit))} (income phase-out)
                  </span>
                )}
              </div>
            </div>
          </Section>

          <Section
            title="HSA / FSA"
            info={
              <>
                <InfoItem term="HSA (Health Savings Account)">
                  <strong>Triple tax advantage</strong>: pre-tax in, tax-free growth, tax-free
                  out for medical costs. Requires a high-deductible health plan. Money{" "}
                  <strong>rolls over</strong> yearly and is yours to keep. {fmt(L.hsa_single)}{" "}
                  self / {fmt(L.hsa_family)} family
                  {is55plus(s.ageBand) ? `, +${fmt(L.hsa_catchup)} at 55+` : ""}.
                </InfoItem>
                <InfoItem term="Health Care FSA">
                  Pre-tax dollars for medical expenses, but largely{" "}
                  <strong>use-it-or-lose-it</strong> each year (up to {fmt(L.fsa_carryover)}{" "}
                  can carry over). {fmt(L.fsa_health)} limit.
                </InfoItem>
                <InfoItem term="Dependent Care FSA">
                  Pre-tax dollars for childcare / dependent care so you can work. Also
                  use-it-or-lose-it. {fmt(L.fsa_dependent_care)} household limit.
                </InfoItem>
              </>
            }
          >
            <div className="grid grid-cols-2 gap-3">
              <div>
                <MoneyInput
                  label="HSA contribution"
                  value={s.hsaContrib}
                  onChange={(v) => upd({ hsaContrib: v })}
                  base={grossIncome}
                  mode={modeOf("hsaContrib")}
                  onModeChange={(m) => setMode("hsaContrib", m)}
                  hint={`${fmt(hsaLimit)} limit`}
                />
                <div className="mt-1 flex gap-2 text-xs text-black/50 dark:text-white/50">
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input type="radio" name="hsaCov" value="single" checked={s.hsaCoverage === "single"} onChange={() => upd({ hsaCoverage: "single" })} />
                    Self
                  </label>
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input type="radio" name="hsaCov" value="family" checked={s.hsaCoverage === "family"} onChange={() => upd({ hsaCoverage: "family" })} />
                    Family
                  </label>
                </div>
              </div>
              <MoneyInput
                label="Health Care FSA"
                value={s.fsaContrib}
                onChange={(v) => upd({ fsaContrib: v })}
                base={grossIncome}
                mode={modeOf("fsaContrib")}
                onModeChange={(m) => setMode("fsaContrib", m)}
                hint={`${fmt(L.fsa_health)} limit`}
              />
              <MoneyInput
                label="Dependent Care FSA"
                value={s.fsaDependentCare}
                onChange={(v) => upd({ fsaDependentCare: v })}
                base={grossIncome}
                mode={modeOf("fsaDependentCare")}
                onModeChange={(m) => setMode("fsaDependentCare", m)}
                hint={`${fmt(L.fsa_dependent_care)} limit`}
              />
            </div>
          </Section>

          <Section
            title={`State Tax (${stateData.dataYear} brackets${stateStale ? "*" : ""})`}
            info={<StateBracketsInfo code={s.stateCode} year={store.activeYear} />}
          >
            <div className="flex flex-col gap-0.5">
              <label className="text-xs text-black/50 dark:text-white/50">State</label>
              <select
                value={s.stateCode}
                onChange={(e) => upd({ stateCode: e.target.value })}
                className="rounded border border-black/10 dark:border-white/10 bg-transparent px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-black/20 dark:focus:ring-white/20"
              >
                <option value="">None / not set</option>
                {Object.entries(stateData.states).map(([code, info]) => (
                  <option key={code} value={code}>{code} – {info.name}</option>
                ))}
              </select>
              {stateStale && (
                <span className="mt-1 text-xs text-black/40 dark:text-white/40">
                  *Using {stateData.dataYear} brackets — {store.activeYear} not yet published.
                </span>
              )}
            </div>
          </Section>

          <Section title="Take-Home Allocation (Monthly)">
            {monthsWorked < 12 && (
              <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
                <span className="text-black/50 dark:text-white/50">Monthly means:</span>
                {([
                  ["worked", `${Math.max(1, monthsWorked)} months worked`],
                  ["year", "all 12 months"],
                ] as const).map(([val, label]) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => upd({ allocBasis: val })}
                    className={`rounded border px-2 py-0.5 ${
                      s.allocBasis === val
                        ? "border-transparent bg-foreground text-background"
                        : "border-black/10 text-black/50 hover:text-foreground dark:border-white/10 dark:text-white/50"
                    }`}
                  >
                    {label}
                  </button>
                ))}
                <span className="w-full text-black/35 dark:text-white/35">
                  {s.allocBasis === "worked"
                    ? "Take-home split across earning months only — what actually lands each payday."
                    : "Take-home spread evenly over the whole year, savings for the off months included."}
                </span>
              </div>
            )}
            <div className="space-y-2">
              {s.allocations.map((a, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={a.label}
                    onChange={(e) => {
                      const next = [...s.allocations];
                      next[i] = { ...next[i], label: e.target.value };
                      upd({ allocations: next });
                    }}
                    className="flex-1 rounded border border-black/10 dark:border-white/10 bg-transparent px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-black/20 dark:focus:ring-white/20"
                  />
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        const next = [...s.allocations];
                        next[i] = { ...next[i], mode: (a.mode ?? "$") === "%" ? "$" : "%" };
                        upd({ allocations: next });
                      }}
                      title="Toggle between dollar amount and percent of monthly take-home"
                      className="w-6 shrink-0 rounded border border-black/10 dark:border-white/10 py-1 text-sm font-medium text-black/50 hover:text-foreground dark:text-white/50"
                    >
                      {(a.mode ?? "$") === "%" ? "%" : "$"}
                    </button>
                    <input
                      type="number"
                      min={0}
                      step={(a.mode ?? "$") === "%" ? 0.5 : 1}
                      value={
                        (a.mode ?? "$") === "%"
                          ? (monthlyTakeHome > 0 ? Math.round((a.amount / monthlyTakeHome) * 10000) / 100 : 0) || ""
                          : a.amount || ""
                      }
                      onChange={(e) => {
                        const raw = Number(e.target.value) || 0;
                        const amount = (a.mode ?? "$") === "%"
                          ? (monthlyTakeHome > 0 ? (raw / 100) * monthlyTakeHome : 0)
                          : raw;
                        const next = [...s.allocations];
                        next[i] = { ...next[i], amount };
                        upd({ allocations: next });
                      }}
                      placeholder="0"
                      className="w-28 rounded border border-black/10 dark:border-white/10 bg-transparent px-2 py-1 text-sm font-mono tabular-nums focus:outline-none focus:ring-1 focus:ring-black/20 dark:focus:ring-white/20"
                    />
                  </div>
                  <button
                    onClick={() => upd({ allocations: s.allocations.filter((_, j) => j !== i) })}
                    className="text-black/30 hover:text-red-500 dark:text-white/30 text-lg leading-none"
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                onClick={() => upd({ allocations: [...s.allocations, { label: "", amount: 0 }] })}
                className="mt-1 text-xs text-black/40 hover:text-black dark:text-white/40 dark:hover:text-white"
              >
                + add row
              </button>
            </div>
          </Section>
        </div>

        {/* RIGHT: summary */}
        <div className="space-y-5">
          <Section title="Income Summary">
            <Row
              label="Salary (prorated)"
              value={fmt(salaryTotal)}
              sub={
                hasSchedule
                  ? `${paychecksThisYear} paychecks${monthsWorked < 12 ? ` · ${fmtMonths([...covered])}` : ""}`
                  : monthsWorked < 12
                    ? `${fmtMonths([...covered])} · ${monthsWorked} of 12 mo`
                    : undefined
              }
            />
            {bonusTotal > 0 && <Row label="Bonus" value={fmt(bonusTotal)} />}
            {s.other > 0 && <Row label="Other income" value={fmt(s.other)} />}
            <Row label="Gross income" value={fmt(grossIncome)} />
            <Row label="Traditional 401(k)" value={`− ${fmt(trad401)}`} sub={pct(trad401, grossIncome)} />
            {s.tradIra > 0 && <Row label="Traditional IRA" value={`− ${fmt(s.tradIra)}`} />}
            <Row label="HSA" value={`− ${fmt(s.hsaContrib)}`} />
            <Row label="Health Care FSA" value={`− ${fmt(s.fsaContrib)}`} />
            {s.fsaDependentCare > 0 && <Row label="Dependent Care FSA" value={`− ${fmt(s.fsaDependentCare)}`} />}
            <Row label="AGI" value={fmt(agi)} />
            <Row label="Standard deduction" value={`− ${fmt(stdDeduction)}`} />
            <Row label="Taxable income" value={fmt(taxableIncome)} />
          </Section>

          <Section title="Tax Breakdown">
            <Row label="Federal income tax" value={`− ${fmt(federalTax)}`} sub={`${(effectiveFedRate * 100).toFixed(1)}% effective · ${(marginalRate * 100).toFixed(0)}% marginal`} />
            <Row label="Social Security" value={`− ${fmt(ssTax)}`} sub={s.ficaExempt ? "exempt (intl student)" : "6.2%"} />
            <Row label="Medicare" value={`− ${fmt(medicareTax)}`} sub={s.ficaExempt ? "exempt (intl student)" : grossIncome > 200000 ? "1.45% + 0.9% surtax" : "1.45%"} />
            <Row
              label={`State tax${s.stateCode ? ` (${s.stateCode})` : ""}`}
              value={`− ${fmt(stateTax)}`}
              sub={s.stateCode ? `${(stateEffRate * 100).toFixed(2)}% effective · ${(stateMarginalRate * 100).toFixed(2)}% marginal` : "no state selected"}
            />
            <div className="mt-1 border-t border-black/10 dark:border-white/10 pt-1">
              <Row label="Total taxes" value={fmt(totalTax)} sub={pct(totalTax, grossIncome)} />
            </div>
          </Section>

          <Section title="Post-Tax Flow">
            <Row label="After tax + pre-tax deductions" value={fmt(netAfterTaxAndPretax)} />
            {roth401 > 0 && <Row label="Roth 401(k)" value={`− ${fmt(roth401)}`} />}
            <Row label="Roth IRA" value={`− ${fmt(s.rothIra)}`} />
            <div className="mt-1 border-t border-black/10 dark:border-white/10 pt-1">
              <Row
                label="Monthly take-home"
                value={fmt(monthlyTakeHome)}
                sub={basisMonths === 12 ? "over 12 months" : `over ${basisMonths} months worked`}
              />
              {basisMonths !== 12 && (
                <Row label="…if spread over the year" value={fmt(takeHome / 12)} sub="over 12 months" />
              )}
              {paychecksThisYear > 0 && (
                <Row
                  label="Per paycheck"
                  value={fmtCents(takeHome / paychecksThisYear)}
                  sub={`${paychecksThisYear} paychecks`}
                />
              )}
              <Row label="Annual take-home" value={fmt(takeHome)} />
            </div>
          </Section>

          <Section title="Retirement Picture">
            <Row label="Traditional 401(k)" value={fmt(trad401)} sub="pre-tax" />
            <Row label="Roth 401(k)" value={fmt(roth401)} sub="post-tax" />
            <Row label="401(k) elective (Trad + Roth)" value={fmt(k401Elective)} sub={`${pct(k401Elective, k401Limit)} of ${fmt(k401Limit)} limit`} warn={k401Elective > k401Limit} />
            <Row label="401(k) employer" value={fmt(s.k401Employer)} sub="employer match" />
            <Row label="401(k) grand total" value={fmt(k401Total)} sub={`${pct(k401Total, k401TotalLimit)} of ${fmt(k401TotalLimit)} limit`} warn={k401Total > k401TotalLimit} />
            <div className="my-1 border-t border-black/10 dark:border-white/10" />
            <Row label="Traditional IRA" value={fmt(s.tradIra)} sub="pre-tax" />
            <Row label="Roth IRA" value={fmt(s.rothIra)} sub={effectiveRothLimit < rothLimit ? `phase-out cap ${fmt(Math.round(effectiveRothLimit))}` : "post-tax"} warn={s.rothIra > effectiveRothLimit} />
            <Row label="IRA total (Trad + Roth)" value={fmt(iraTotal)} sub={`${pct(iraTotal, iraLimit)} of ${fmt(iraLimit)} limit`} warn={iraTotal > iraLimit} />
            <div className="my-1 border-t border-black/10 dark:border-white/10" />
            <Row label="HSA" value={fmt(s.hsaContrib)} sub={`${pct(s.hsaContrib, hsaLimit)} of ${fmt(hsaLimit)} limit`} warn={s.hsaContrib > hsaLimit} />
            {s.fsaContrib > 0 && <Row label="Health Care FSA" value={fmt(s.fsaContrib)} sub={`${pct(s.fsaContrib, L.fsa_health)} of ${fmt(L.fsa_health)} limit`} warn={s.fsaContrib > L.fsa_health} />}
            {s.fsaDependentCare > 0 && <Row label="Dependent Care FSA" value={fmt(s.fsaDependentCare)} sub={`${pct(s.fsaDependentCare, L.fsa_dependent_care)} of ${fmt(L.fsa_dependent_care)} limit`} warn={s.fsaDependentCare > L.fsa_dependent_care} />}
            <div className="mt-1 border-t border-black/10 dark:border-white/10 pt-1">
              <Row label="Total retirement / year" value={fmt(totalRetirement)} />
            </div>
          </Section>

          <Section title="Allocation Check (Monthly)">
            {s.allocations.map((a, i) => (
              <Row key={i} label={a.label || `Row ${i + 1}`} value={fmt(a.amount)} sub={pct(a.amount, monthlyTakeHome)} />
            ))}
            <div className="mt-1 border-t border-black/10 dark:border-white/10 pt-1">
              <Row
                label="Monthly take-home"
                value={fmt(monthlyTakeHome)}
                sub={basisMonths === 12 ? "over 12 months" : `over ${basisMonths} months worked`}
              />
              <Row
                label="Unallocated"
                value={fmt(unallocated)}
                sub={unallocated >= 0 ? "available" : "over-allocated"}
                warn={unallocated < 0}
              />
            </div>
          </Section>
        </div>
      </div>

      <div className="mt-6">
        <Section
          title="Per-Paycheck Contributions"
          info={
            <>
              <InfoItem term="Why the plan year matters">
                A 401(k) or HSA limit is <strong>calendar-year</strong>, but an FSA runs on
                whatever <strong>plan year</strong> your employer sets — often something like
                Jul–Jun. Your election is divided across the paychecks inside{" "}
                <em>that</em> window, not the tax year, so the two rarely match.
              </InfoItem>
              <InfoItem term="Reading these cards">
                Each card takes the annual amount you entered above and divides it by the
                paychecks falling inside its window — the figure you&apos;d actually type
                into a payroll election form.
              </InfoItem>
              <InfoItem term="Leaving dates blank">
                A blank window means the calendar year ({year}). Set dates only where your
                plan genuinely differs.
              </InfoItem>
              <InfoItem term="Two jobs at once">
                Paychecks from every scheduled period inside the window are counted together,
                so the per-paycheck figure is an average across employers rather than a
                single payroll setting.
              </InfoItem>
            </>
          }
        >
          {!hasSchedule && (
            <p className="mb-3 rounded-md border border-black/10 bg-black/[0.02] p-3 text-xs text-black/50 dark:border-white/10 dark:bg-white/[0.03] dark:text-white/50">
              Set an income period to a real pay cadence above (instead of{" "}
              <strong>whole months</strong>) to get per-paycheck amounts. Plan windows below
              still record each account&apos;s contract year.
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {planViews.map((g) => {
              const custom = !!(s.plans[g.key].start || s.plans[g.key].end);
              return (
                <div key={g.key} className="rounded-md border border-black/10 dark:border-white/10 p-3">
                  <div className="mb-2 flex items-baseline justify-between gap-2">
                    <h3 className="text-sm font-medium">{g.title}</h3>
                    <span className="shrink-0 font-mono text-xs tabular-nums text-black/40 dark:text-white/40">
                      {g.checks} {g.checks === 1 ? "check" : "checks"}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex flex-col gap-0.5">
                      <label className="text-xs text-black/50 dark:text-white/50">Plan start</label>
                      <input
                        type="date"
                        value={s.plans[g.key].start}
                        onChange={(e) => updPlan(g.key, { start: e.target.value })}
                        className="rounded border border-black/10 dark:border-white/10 bg-transparent px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-black/20 dark:focus:ring-white/20"
                      />
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <label className="text-xs text-black/50 dark:text-white/50">Plan end</label>
                      <input
                        type="date"
                        value={s.plans[g.key].end}
                        onChange={(e) => updPlan(g.key, { end: e.target.value })}
                        className="rounded border border-black/10 dark:border-white/10 bg-transparent px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-black/20 dark:focus:ring-white/20"
                      />
                    </div>
                  </div>
                  <p className="mt-1 text-xs text-black/35 dark:text-white/35">
                    {custom
                      ? `${fmtDate(g.start)} ${g.start.getUTCFullYear()} → ${fmtDate(g.end)} ${g.end.getUTCFullYear()}`
                      : `calendar ${year} · ${g.note}`}
                  </p>
                  <div className="mt-2 border-t border-black/10 pt-1 dark:border-white/10">
                    {g.rows.map((r) => (
                      <Row
                        key={r.label}
                        label={r.label}
                        value={g.checks > 0 ? fmtCents(r.amount / g.checks) : "—"}
                        sub={g.checks > 0 ? `of ${fmt(r.amount)}` : fmt(r.amount)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      </div>

      {store.log.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">
            Year Log
          </h2>
          <div className="overflow-x-auto rounded-lg border border-black/10 dark:border-white/10">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-black/10 dark:border-white/10 text-left text-xs text-black/40 dark:text-white/40">
                  <th className="px-3 py-2 font-medium">Year</th>
                  <th className="px-3 py-2 font-medium">Saved</th>
                  <th className="px-3 py-2 text-right font-medium">Gross</th>
                  <th className="px-3 py-2 text-right font-medium">Total tax</th>
                  <th className="px-3 py-2 text-right font-medium">Take-home</th>
                  <th className="px-3 py-2 text-right font-medium">Retirement</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="font-mono tabular-nums">
                {store.log.map((snap) => (
                  <tr key={snap.id} className="border-b border-black/5 dark:border-white/5 last:border-0">
                    <td className="px-3 py-2 font-sans font-medium">{snap.year}</td>
                    <td className="px-3 py-2 font-sans text-black/50 dark:text-white/50">
                      {new Date(snap.savedAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}
                    </td>
                    <td className="px-3 py-2 text-right">{fmt(snap.results.grossIncome)}</td>
                    <td className="px-3 py-2 text-right">{fmt(snap.results.totalTax)}</td>
                    <td className="px-3 py-2 text-right">{fmt(snap.results.takeHome)}</td>
                    <td className="px-3 py-2 text-right">{fmt(snap.results.totalRetirement)}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => deleteSnapshot(snap.id)}
                        className="text-black/30 hover:text-red-500 dark:text-white/30"
                        title="Delete snapshot"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-black/35 dark:text-white/35">
            Snapshots are frozen records — editing a year above doesn&apos;t change saved rows. Save again to capture an update.
          </p>
        </div>
      )}
    </main>
  );
}
