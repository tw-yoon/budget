import type { RewardCategory } from "@/lib/rewards";

/**
 * Curated earning-rate presets for popular cards. This is a STATIC SNAPSHOT
 * (~2025) — issuers change rates, caps, and categories often, so treat it as a
 * starting point and verify against your card's current terms. Rates are
 * editable after a card is added.
 */
export interface PresetRate {
  category: RewardCategory;
  multiplier: number;
  unit: "X" | "PERCENT";
  notes?: string;
}

/**
 * A statement credit / perk seeded alongside a card. `amount` is the credit
 * value tracked within each `period` window (e.g. $10 per MONTHLY for the Gold
 * dining credit). Merchant-specific credits are left to manual logging
 * (no matchCategories), since broad spend categories would over-count them.
 */
export interface PresetBenefit {
  name: string;
  amount: number;
  period: "MONTHLY" | "QUARTERLY" | "SEMIANNUAL" | "ANNUAL";
  notes?: string;
  /**
   * Keywords matched against the reimbursement (inflow) transaction's name —
   * e.g. Amex posts these credits back as a separate credit transaction like
   * "AMEX Dining Credit" or "Dunkin'". When set, progress auto-tracks from
   * those credits instead of requiring manual logging.
   */
  matchText?: string[];
  /**
   * A flat-value perk (a bundled subscription like Apple TV or DashPass)
   * rather than a statement credit. Nothing posts to the card, so progress
   * comes from the user switching the perk on once — see `perkActiveFrom` on
   * UserBenefit. Seeded switched off, since the perk is worth nothing until
   * it's actually activated with the issuer.
   */
  perk?: boolean;
}

export interface CardPreset {
  slug: string;
  issuer: "AMEX" | "CHASE" | "DISCOVER";
  name: string;
  /** Published annual fee (USD). A snapshot — editable per card after adding. */
  annualFee: number;
  rates: PresetRate[];
  benefits?: PresetBenefit[];
}

export const CARD_PRESETS: CardPreset[] = [
  // ─── Amex (Membership Rewards points; Blue Cash earns cash back) ───────────
  {
    slug: "amex-gold",
    issuer: "AMEX",
    name: "Gold Card",
    annualFee: 325,
    rates: [
      { category: "DINING", multiplier: 4, unit: "X", notes: "Restaurants worldwide, up to $50k/yr then 1X" },
      { category: "GROCERIES", multiplier: 4, unit: "X", notes: "US supermarkets, up to $25k/yr then 1X" },
      {
        category: "TRAVEL",
        multiplier: 3,
        unit: "X",
        notes: "Flights direct or via Amex Travel; 5X prepaid hotels & 2X prepaid car rentals/cruises via Amex Travel",
      },
      { category: "OTHER", multiplier: 1, unit: "X" },
    ],
    benefits: [
      {
        name: "Uber Cash",
        amount: 10,
        period: "MONTHLY",
        notes:
          "Add the Gold Card to your Uber account; U.S. rides and Uber Eats. Expires at month end — no rollover",
        matchText: ["Uber Cash"],
      },
      {
        name: "Dining Credit",
        amount: 10,
        period: "MONTHLY",
        notes:
          "Grubhub (incl. Seamless), Buffalo Wild Wings, Five Guys, The Cheesecake Factory, Wonder. Enrollment required",
        matchText: ["Dining Credit"],
      },
      {
        name: "Dunkin' Credit",
        amount: 7,
        period: "MONTHLY",
        notes: "U.S. Dunkin' locations, bought directly (not delivery apps). Enrollment required",
        matchText: ["Dunkin"],
      },
      {
        name: "Resy Credit",
        amount: 50,
        period: "SEMIANNUAL",
        notes:
          "Qualifying U.S. Resy restaurants ($50 Jan–Jun, $50 Jul–Dec). Adds Tock from 09/15/2026. Enrollment required",
        matchText: ["Resy"],
      },
      {
        name: "The Hotel Collection Credit",
        amount: 100,
        period: "ANNUAL",
        notes:
          "$100 per stay of 2+ nights booked through Amex Travel. Applied at the property toward eligible charges, not as a statement credit — so log it by hand, and raise the amount if you book more than one stay",
      },
    ],
  },
  {
    slug: "amex-platinum",
    issuer: "AMEX",
    name: "The Platinum Card",
    annualFee: 695,
    rates: [
      { category: "TRAVEL", multiplier: 5, unit: "X", notes: "Flights direct/Amex Travel & prepaid hotels via Amex Travel" },
      { category: "OTHER", multiplier: 1, unit: "X" },
    ],
  },
  {
    slug: "amex-blue-cash-preferred",
    issuer: "AMEX",
    name: "Blue Cash Preferred",
    annualFee: 95,
    rates: [
      { category: "GROCERIES", multiplier: 6, unit: "PERCENT", notes: "US supermarkets, up to $6k/yr then 1%" },
      { category: "ENTERTAINMENT", multiplier: 6, unit: "PERCENT", notes: "Select US streaming" },
      { category: "TRANSIT", multiplier: 3, unit: "PERCENT" },
      { category: "GAS", multiplier: 3, unit: "PERCENT", notes: "US gas stations" },
      { category: "OTHER", multiplier: 1, unit: "PERCENT" },
    ],
  },
  {
    slug: "amex-green",
    issuer: "AMEX",
    name: "Green Card",
    annualFee: 150,
    rates: [
      { category: "TRAVEL", multiplier: 3, unit: "X" },
      { category: "DINING", multiplier: 3, unit: "X" },
      { category: "TRANSIT", multiplier: 3, unit: "X" },
      { category: "OTHER", multiplier: 1, unit: "X" },
    ],
  },

  // ─── Chase (Ultimate Rewards points) ──────────────────────────────────────
  {
    slug: "chase-sapphire-reserve",
    issuer: "CHASE",
    name: "Sapphire Reserve",
    annualFee: 550,
    rates: [
      { category: "TRAVEL", multiplier: 3, unit: "X", notes: "General travel; higher via Chase Travel" },
      { category: "DINING", multiplier: 3, unit: "X" },
      { category: "OTHER", multiplier: 1, unit: "X" },
    ],
  },
  {
    slug: "chase-sapphire-preferred",
    issuer: "CHASE",
    name: "Sapphire Preferred",
    annualFee: 95,
    rates: [
      { category: "DINING", multiplier: 3, unit: "X", notes: "Restaurants incl. takeout and eligible delivery" },
      { category: "GAS", multiplier: 3, unit: "X", notes: "Gas stations and EV charging" },
      {
        category: "ONLINE_SHOPPING",
        multiplier: 3,
        unit: "X",
        notes: "Online groceries, excl. Walmart/Target & wholesale clubs",
      },
      { category: "ENTERTAINMENT", multiplier: 3, unit: "X", notes: "Select top streaming services" },
      {
        category: "TRAVEL",
        multiplier: 2,
        unit: "X",
        notes:
          "All other travel; 5X via Chase Travel, 3X vacation homes at top brands, 5X on Lyft rides through 09/30/2027",
      },
      {
        category: "OTHER",
        multiplier: 1,
        unit: "X",
        notes: "5X on Peloton equipment/accessories over $150, up to $5k, through 12/31/2027",
      },
    ],
    benefits: [
      {
        name: "Chase Travel Hotel Credit",
        amount: 100,
        period: "ANNUAL",
        notes: "Hotel stays booked through Chase Travel. Resets on your account anniversary, not Jan 1",
        matchText: ["Hotel Credit"],
      },
      {
        name: "Apple TV",
        amount: 155.88,
        period: "ANNUAL",
        notes: "12+ months complimentary. One-time activation required by 12/31/2026",
        perk: true,
      },
      {
        name: "DashPass",
        amount: 119.88,
        period: "ANNUAL",
        notes: "12+ months complimentary on DoorDash and Caviar. Activate by 12/31/2027",
        perk: true,
      },
      {
        name: "DoorDash Non-Restaurant Credit",
        amount: 10,
        period: "MONTHLY",
        notes:
          "$10 off one non-restaurant order per calendar month, once DashPass is activated. A checkout discount — nothing posts to the card, so log it by hand. Does not roll over",
      },
      {
        name: "Global Entry / TSA PreCheck / NEXUS",
        amount: 120,
        period: "ANNUAL",
        notes: "Up to $120, once every four years — log it in the year you pay the application fee",
      },
    ],
  },
  {
    slug: "chase-freedom-unlimited",
    issuer: "CHASE",
    name: "Freedom Unlimited",
    annualFee: 0,
    rates: [
      { category: "DINING", multiplier: 3, unit: "X" },
      { category: "DRUGSTORES", multiplier: 3, unit: "X" },
      { category: "TRAVEL", multiplier: 5, unit: "X", notes: "Booked via Chase Travel" },
      { category: "OTHER", multiplier: 1.5, unit: "X" },
    ],
  },
  {
    slug: "chase-freedom-flex",
    issuer: "CHASE",
    name: "Freedom Flex",
    annualFee: 0,
    rates: [
      { category: "DINING", multiplier: 3, unit: "PERCENT" },
      { category: "DRUGSTORES", multiplier: 3, unit: "PERCENT" },
      { category: "TRAVEL", multiplier: 5, unit: "PERCENT", notes: "Booked via Chase Travel" },
      { category: "ROTATING", multiplier: 5, unit: "PERCENT", notes: "Rotating quarterly categories, up to $1,500/quarter (activation required)" },
      { category: "OTHER", multiplier: 1, unit: "PERCENT" },
    ],
  },

  // ─── Discover (cash back) ──────────────────────────────────────────────────
  {
    slug: "discover-it-cash-back",
    issuer: "DISCOVER",
    name: "Discover it Cash Back",
    annualFee: 0,
    rates: [
      { category: "ROTATING", multiplier: 5, unit: "PERCENT", notes: "Rotating quarterly categories, up to $1,500/quarter (activation required)" },
      { category: "OTHER", multiplier: 1, unit: "PERCENT" },
    ],
  },
  {
    slug: "discover-it-chrome",
    issuer: "DISCOVER",
    name: "Discover it Chrome",
    annualFee: 0,
    rates: [
      { category: "GAS", multiplier: 2, unit: "PERCENT", notes: "Combined w/ dining, up to $1,000/quarter" },
      { category: "DINING", multiplier: 2, unit: "PERCENT", notes: "Combined w/ gas, up to $1,000/quarter" },
      { category: "OTHER", multiplier: 1, unit: "PERCENT" },
    ],
  },
  {
    slug: "discover-it-miles",
    issuer: "DISCOVER",
    name: "Discover it Miles",
    annualFee: 0,
    rates: [{ category: "OTHER", multiplier: 1.5, unit: "X" }],
  },
];
