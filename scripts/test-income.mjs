import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT, computeTaxes, payDatesInYear, parseStore } from "../src/lib/income.ts";

const near = (a, b) => assert.ok(Math.abs(a - b) < 0.01, `${a} != ${b}`);
const withSalary = (annualRate, extra = {}) => ({
  ...DEFAULT,
  periods: [{ ...DEFAULT.periods[0], annualRate }],
  ...extra,
});

test("federal tax walks the 2026 single brackets", () => {
  const t = computeTaxes(withSalary(100000), 2026);
  near(t.taxableIncome, 85000);
  // 10% of 11,925 + 12% of 36,550 + 22% of 36,525
  near(t.federalTax, 1192.5 + 4386 + 8035.5);
  assert.equal(t.marginalRate, 0.22);
});

test("pre-tax 401(k) lowers AGI; Roth 401(k) only lowers take-home", () => {
  const base = computeTaxes(withSalary(100000), 2026);
  const trad = computeTaxes(withSalary(100000, { trad401: 10000 }), 2026);
  const roth = computeTaxes(withSalary(100000, { roth401: 10000 }), 2026);
  near(trad.agi, 90000);
  near(roth.agi, 100000);
  near(roth.takeHome, base.takeHome - 10000);
});

test("Social Security stops at the wage base; Medicare adds 0.9% over 200k", () => {
  const t = computeTaxes(withSalary(300000), 2026);
  near(t.ssTax, 176100 * 0.062);
  near(t.medicareTax, 300000 * 0.0145 + 100000 * 0.009);
});

test("FICA-exempt students pay no FICA", () => {
  const t = computeTaxes(withSalary(50000, { ficaExempt: true }), 2026);
  assert.equal(t.ssTax + t.medicareTax, 0);
});

test("take-home is gross minus deductions, taxes and Roth", () => {
  const t = computeTaxes(withSalary(80000, { trad401: 5000, rothIra: 3000, stateCode: "CA" }), 2026);
  assert.ok(t.stateTax > 0);
  near(t.takeHome, t.grossIncome - 5000 - t.totalTax - 3000);
});

test("a biweekly job starting Aug 7 earns only its 2026 paychecks", () => {
  const period = { ...DEFAULT.periods[0], annualRate: 52000, cadence: "biweekly", firstPayDate: "2026-08-07" };
  assert.equal(payDatesInYear(period, 2026).length, 11);
  near(computeTaxes({ ...DEFAULT, periods: [period] }, 2026).salaryTotal, 2000 * 11);
});

test("semimonthly pay on the 30th clamps to Feb 28", () => {
  const period = { ...DEFAULT.periods[0], cadence: "semimonthly", firstPayDate: "2026-01-15" };
  const feb = payDatesInYear(period, 2026).filter((d) => d.getUTCMonth() === 1);
  assert.deepEqual(feb.map((d) => d.getUTCDate()), [15, 28]);
});

test("a legacy saved blob migrates into the current shape", () => {
  const store = parseStore({ salary: 60000, k401Pct: 10, bonus: 5000, age50plus: true });
  const s = store.years[store.activeYear];
  assert.equal(s.periods[0].annualRate, 60000);
  assert.equal(s.periods[0].bonus, 5000);
  assert.equal(s.trad401, 6000);
  assert.equal(s.ageBand, "50to54");
  assert.equal("salary" in s, false);
});
