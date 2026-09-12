// State income tax brackets by year — single filer.
// Source: Tax Foundation, state revenue departments.
// To add a year: define a new `STATES_<year>` map and register it in
// STATES_BY_YEAR below. Consumers resolve the right dataset via
// statesForYear(year), which falls back to the most recent available year when
// a given year hasn't been loaded yet.

export type Bracket = { upTo: number; rate: number }; // rate as decimal

export type StateInfo = {
  name: string;
  brackets: Bracket[]; // progressive, single filer
};

// upTo: Infinity = top bracket (no ceiling)
const I = Infinity;

const STATES_2025: Record<string, StateInfo> = {
  AL: {
    name: "Alabama",
    brackets: [
      { upTo: 500, rate: 0.02 },
      { upTo: 3000, rate: 0.04 },
      { upTo: I, rate: 0.05 },
    ],
  },
  AK: {
    name: "Alaska",
    brackets: [{ upTo: I, rate: 0 }],
  },
  AZ: {
    name: "Arizona",
    brackets: [{ upTo: I, rate: 0.025 }],
  },
  AR: {
    name: "Arkansas",
    brackets: [
      { upTo: 4300, rate: 0.02 },
      { upTo: 8500, rate: 0.04 },
      { upTo: I, rate: 0.044 },
    ],
  },
  CA: {
    name: "California",
    brackets: [
      { upTo: 10756, rate: 0.01 },
      { upTo: 25499, rate: 0.02 },
      { upTo: 40245, rate: 0.04 },
      { upTo: 55866, rate: 0.06 },
      { upTo: 70606, rate: 0.08 },
      { upTo: 360659, rate: 0.093 },
      { upTo: 432787, rate: 0.103 },
      { upTo: 721314, rate: 0.113 },
      { upTo: 1000000, rate: 0.123 },
      { upTo: I, rate: 0.133 }, // mental health surtax
    ],
  },
  CO: {
    name: "Colorado",
    brackets: [{ upTo: I, rate: 0.044 }],
  },
  CT: {
    name: "Connecticut",
    brackets: [
      { upTo: 10000, rate: 0.02 },
      { upTo: 50000, rate: 0.045 },
      { upTo: 100000, rate: 0.055 },
      { upTo: 200000, rate: 0.06 },
      { upTo: 250000, rate: 0.065 },
      { upTo: 500000, rate: 0.069 },
      { upTo: I, rate: 0.0699 },
    ],
  },
  DE: {
    name: "Delaware",
    brackets: [
      { upTo: 2000, rate: 0 },
      { upTo: 5000, rate: 0.022 },
      { upTo: 10000, rate: 0.039 },
      { upTo: 20000, rate: 0.048 },
      { upTo: 25000, rate: 0.052 },
      { upTo: 60000, rate: 0.0555 },
      { upTo: I, rate: 0.066 },
    ],
  },
  FL: {
    name: "Florida",
    brackets: [{ upTo: I, rate: 0 }],
  },
  GA: {
    name: "Georgia",
    brackets: [{ upTo: I, rate: 0.0539 }],
  },
  HI: {
    name: "Hawaii",
    brackets: [
      { upTo: 2400, rate: 0.014 },
      { upTo: 4800, rate: 0.032 },
      { upTo: 9600, rate: 0.055 },
      { upTo: 14400, rate: 0.064 },
      { upTo: 19200, rate: 0.068 },
      { upTo: 24000, rate: 0.072 },
      { upTo: 36000, rate: 0.076 },
      { upTo: 48000, rate: 0.079 },
      { upTo: 150000, rate: 0.0825 },
      { upTo: 175000, rate: 0.09 },
      { upTo: 200000, rate: 0.1 },
      { upTo: I, rate: 0.11 },
    ],
  },
  ID: {
    name: "Idaho",
    brackets: [{ upTo: I, rate: 0.058 }],
  },
  IL: {
    name: "Illinois",
    brackets: [{ upTo: I, rate: 0.0495 }],
  },
  IN: {
    name: "Indiana",
    brackets: [{ upTo: I, rate: 0.0305 }],
  },
  IA: {
    name: "Iowa",
    brackets: [
      { upTo: 6210, rate: 0.044 },
      { upTo: 31050, rate: 0.0482 },
      { upTo: I, rate: 0.057 },
    ],
  },
  KS: {
    name: "Kansas",
    brackets: [
      { upTo: 15000, rate: 0.031 },
      { upTo: 30000, rate: 0.0525 },
      { upTo: I, rate: 0.057 },
    ],
  },
  KY: {
    name: "Kentucky",
    brackets: [{ upTo: I, rate: 0.04 }],
  },
  LA: {
    name: "Louisiana",
    brackets: [
      { upTo: 12500, rate: 0.02 },
      { upTo: 50000, rate: 0.03 },
      { upTo: I, rate: 0.04 },  // 2025 reduced rates
    ],
  },
  ME: {
    name: "Maine",
    brackets: [
      { upTo: 26050, rate: 0.058 },
      { upTo: 61600, rate: 0.0675 },
      { upTo: I, rate: 0.0715 },
    ],
  },
  MD: {
    name: "Maryland",
    brackets: [
      { upTo: 1000, rate: 0.02 },
      { upTo: 2000, rate: 0.03 },
      { upTo: 3000, rate: 0.04 },
      { upTo: 100000, rate: 0.0475 },
      { upTo: 125000, rate: 0.05 },
      { upTo: 150000, rate: 0.0525 },
      { upTo: 250000, rate: 0.055 },
      { upTo: I, rate: 0.0575 },
    ],
  },
  MA: {
    name: "Massachusetts",
    brackets: [
      { upTo: 1000000, rate: 0.05 },
      { upTo: I, rate: 0.09 }, // millionaire surtax
    ],
  },
  MI: {
    name: "Michigan",
    brackets: [{ upTo: I, rate: 0.0425 }],
  },
  MN: {
    name: "Minnesota",
    brackets: [
      { upTo: 31690, rate: 0.0535 },
      { upTo: 104090, rate: 0.068 },
      { upTo: 193240, rate: 0.0785 },
      { upTo: I, rate: 0.0985 },
    ],
  },
  MS: {
    name: "Mississippi",
    brackets: [
      { upTo: 10000, rate: 0 },
      { upTo: I, rate: 0.047 },
    ],
  },
  MO: {
    name: "Missouri",
    brackets: [
      { upTo: 1121, rate: 0 },
      { upTo: 2242, rate: 0.015 },
      { upTo: 3363, rate: 0.02 },
      { upTo: 4484, rate: 0.025 },
      { upTo: 5605, rate: 0.03 },
      { upTo: 6726, rate: 0.035 },
      { upTo: 7847, rate: 0.04 },
      { upTo: 8968, rate: 0.045 },
      { upTo: I, rate: 0.048 },
    ],
  },
  MT: {
    name: "Montana",
    brackets: [
      { upTo: 20500, rate: 0.047 },
      { upTo: I, rate: 0.059 },
    ],
  },
  NE: {
    name: "Nebraska",
    brackets: [
      { upTo: 3700, rate: 0.0246 },
      { upTo: 22170, rate: 0.0351 },
      { upTo: 35730, rate: 0.0501 },
      { upTo: I, rate: 0.0584 },
    ],
  },
  NV: {
    name: "Nevada",
    brackets: [{ upTo: I, rate: 0 }],
  },
  NH: {
    name: "New Hampshire",
    brackets: [{ upTo: I, rate: 0 }], // interest/dividends tax repealed 2025
  },
  NJ: {
    name: "New Jersey",
    brackets: [
      { upTo: 20000, rate: 0.014 },
      { upTo: 35000, rate: 0.0175 },
      { upTo: 40000, rate: 0.035 },
      { upTo: 75000, rate: 0.05525 },
      { upTo: 500000, rate: 0.0637 },
      { upTo: 1000000, rate: 0.0897 },
      { upTo: I, rate: 0.1075 },
    ],
  },
  NM: {
    name: "New Mexico",
    brackets: [
      { upTo: 5500, rate: 0.017 },
      { upTo: 11000, rate: 0.032 },
      { upTo: 16000, rate: 0.047 },
      { upTo: 210000, rate: 0.049 },
      { upTo: I, rate: 0.059 },
    ],
  },
  NY: {
    name: "New York",
    brackets: [
      { upTo: 17150, rate: 0.04 },
      { upTo: 23600, rate: 0.045 },
      { upTo: 27900, rate: 0.0525 },
      { upTo: 161550, rate: 0.0585 },
      { upTo: 323200, rate: 0.0625 },
      { upTo: 2155350, rate: 0.0685 },
      { upTo: 5000000, rate: 0.0965 },
      { upTo: 25000000, rate: 0.103 },
      { upTo: I, rate: 0.109 },
    ],
  },
  NC: {
    name: "North Carolina",
    brackets: [{ upTo: I, rate: 0.045 }],
  },
  ND: {
    name: "North Dakota",
    brackets: [
      { upTo: 44725, rate: 0 },
      { upTo: I, rate: 0.025 },
    ],
  },
  OH: {
    name: "Ohio",
    brackets: [
      { upTo: 26050, rate: 0 },
      { upTo: 100000, rate: 0.0275 },
      { upTo: I, rate: 0.035 },
    ],
  },
  OK: {
    name: "Oklahoma",
    brackets: [
      { upTo: 1000, rate: 0.0025 },
      { upTo: 2500, rate: 0.0075 },
      { upTo: 3750, rate: 0.0175 },
      { upTo: 4900, rate: 0.0275 },
      { upTo: 7200, rate: 0.0375 },
      { upTo: I, rate: 0.0475 },
    ],
  },
  OR: {
    name: "Oregon",
    brackets: [
      { upTo: 4050, rate: 0.0475 },
      { upTo: 10200, rate: 0.0675 },
      { upTo: 125000, rate: 0.0875 },
      { upTo: I, rate: 0.099 },
    ],
  },
  PA: {
    name: "Pennsylvania",
    brackets: [{ upTo: I, rate: 0.0307 }],
  },
  RI: {
    name: "Rhode Island",
    brackets: [
      { upTo: 77450, rate: 0.0375 },
      { upTo: 176050, rate: 0.0475 },
      { upTo: I, rate: 0.0599 },
    ],
  },
  SC: {
    name: "South Carolina",
    brackets: [
      { upTo: 3460, rate: 0 },
      { upTo: 17330, rate: 0.03 },
      { upTo: I, rate: 0.064 },
    ],
  },
  SD: {
    name: "South Dakota",
    brackets: [{ upTo: I, rate: 0 }],
  },
  TN: {
    name: "Tennessee",
    brackets: [{ upTo: I, rate: 0 }],
  },
  TX: {
    name: "Texas",
    brackets: [{ upTo: I, rate: 0 }],
  },
  UT: {
    name: "Utah",
    brackets: [{ upTo: I, rate: 0.0455 }],
  },
  VT: {
    name: "Vermont",
    brackets: [
      { upTo: 45400, rate: 0.0335 },
      { upTo: 110050, rate: 0.066 },
      { upTo: 229550, rate: 0.076 },
      { upTo: I, rate: 0.0875 },
    ],
  },
  VA: {
    name: "Virginia",
    brackets: [
      { upTo: 3000, rate: 0.02 },
      { upTo: 5000, rate: 0.03 },
      { upTo: 17000, rate: 0.05 },
      { upTo: I, rate: 0.0575 },
    ],
  },
  WA: {
    name: "Washington",
    brackets: [{ upTo: I, rate: 0 }],
  },
  WV: {
    name: "West Virginia",
    brackets: [
      { upTo: 10000, rate: 0.0236 },
      { upTo: 25000, rate: 0.0315 },
      { upTo: 40000, rate: 0.0354 },
      { upTo: 60000, rate: 0.0472 },
      { upTo: I, rate: 0.0512 },
    ],
  },
  WI: {
    name: "Wisconsin",
    brackets: [
      { upTo: 14320, rate: 0.035 },
      { upTo: 28640, rate: 0.044 },
      { upTo: 315310, rate: 0.053 },
      { upTo: I, rate: 0.0765 },
    ],
  },
  WY: {
    name: "Wyoming",
    brackets: [{ upTo: I, rate: 0 }],
  },
  DC: {
    name: "Washington D.C.",
    brackets: [
      { upTo: 10000, rate: 0.04 },
      { upTo: 40000, rate: 0.06 },
      { upTo: 60000, rate: 0.065 },
      { upTo: 250000, rate: 0.085 },
      { upTo: 500000, rate: 0.0925 },
      { upTo: 1000000, rate: 0.0975 },
      { upTo: I, rate: 0.1075 },
    ],
  },
};

// ── Registry ─────────────────────────────────────────────────────────────────
// Each year maps state code → brackets. Register new years here as states
// publish them; everything downstream picks them up automatically.
export const STATES_BY_YEAR: Record<number, Record<string, StateInfo>> = {
  2025: STATES_2025,
};

const STATE_YEARS = Object.keys(STATES_BY_YEAR)
  .map(Number)
  .sort((a, b) => a - b);

// The most recent tax year we have state brackets coded for.
export const LATEST_STATE_TAX_YEAR = STATE_YEARS[STATE_YEARS.length - 1];

// Resolve the best dataset for a requested year: exact match, else the most
// recent prior year available, else the earliest we have.
export function statesForYear(year: number): {
  dataYear: number;
  states: Record<string, StateInfo>;
} {
  if (STATES_BY_YEAR[year]) return { dataYear: year, states: STATES_BY_YEAR[year] };
  const prior = STATE_YEARS.filter((y) => y <= year);
  const dataYear = prior.length ? prior[prior.length - 1] : STATE_YEARS[0];
  return { dataYear, states: STATES_BY_YEAR[dataYear] };
}

// Progressive bracket calculation against the dataset in effect for `year`.
export function calcStateTax(income: number, code: string, year: number): number {
  const { states } = statesForYear(year);
  const state = states[code];
  if (!state || income <= 0) return 0;
  let tax = 0;
  let prev = 0;
  for (const b of state.brackets) {
    if (income <= prev) break;
    tax += (Math.min(income, b.upTo) - prev) * b.rate;
    prev = b.upTo;
  }
  return tax;
}

export function effectiveStateRate(income: number, code: string, year: number): number {
  if (income <= 0) return 0;
  return calcStateTax(income, code, year) / income;
}
