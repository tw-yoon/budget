/**
 * Maps a transaction's spending category onto the reward category its card
 * earns under, so points can be estimated from synced spend.
 *
 * Plaid's PFC *primary* is too coarse to do this: FOOD_AND_DRINK covers both
 * restaurants and supermarkets, which most cards pay differently (Amex Gold
 * pays 4X on each but under separate caps). So the detailed code drives the
 * mapping, with the primary as a fallback when it's missing.
 *
 * This is an ESTIMATE. Issuer bonus categories are defined by merchant codes
 * and carry caps and exclusions ("first $50k per year", "excluding Walmart and
 * Target") that Plaid's categories know nothing about, and that this app keeps
 * only as free text on the rate. Treat the output as an approximation.
 */

import type { RewardCategory } from "@/lib/rewards";

const BY_DETAILED: Record<string, RewardCategory> = {
  // Dining — takeout and delivery included, matching how issuers treat them.
  FOOD_AND_DRINK_RESTAURANT: "DINING",
  FOOD_AND_DRINK_FAST_FOOD: "DINING",
  FOOD_AND_DRINK_COFFEE: "DINING",
  FOOD_AND_DRINK_BEER_WINE_AND_LIQUOR: "DINING",
  FOOD_AND_DRINK_OTHER_FOOD_AND_DRINK: "DINING",
  FOOD_AND_DRINK_VENDING_MACHINES: "DINING",

  FOOD_AND_DRINK_GROCERIES: "GROCERIES",

  TRAVEL_FLIGHTS: "TRAVEL",
  TRAVEL_LODGING: "TRAVEL",
  TRAVEL_RENTAL_CARS: "TRAVEL",
  TRAVEL_OTHER_TRAVEL: "TRAVEL",

  TRANSPORTATION_GAS: "GAS",

  TRANSPORTATION_PUBLIC_TRANSIT: "TRANSIT",
  TRANSPORTATION_TAXIS_AND_RIDE_SHARES: "TRANSIT",
  TRANSPORTATION_PARKING: "TRANSIT",
  TRANSPORTATION_TOLLS: "TRANSIT",
  TRANSPORTATION_BIKES_AND_SCOOTERS: "TRANSIT",
  TRANSPORTATION_OTHER_TRANSPORTATION: "TRANSIT",

  ENTERTAINMENT_TV_AND_MOVIES: "ENTERTAINMENT",
  ENTERTAINMENT_MUSIC_AND_AUDIO: "ENTERTAINMENT",
  ENTERTAINMENT_VIDEO_GAMES: "ENTERTAINMENT",
  ENTERTAINMENT_SPORTING_EVENTS_AMUSEMENT_PARKS_AND_MUSEUMS: "ENTERTAINMENT",
  ENTERTAINMENT_CASINOS_AND_GAMBLING: "ENTERTAINMENT",
  ENTERTAINMENT_OTHER_ENTERTAINMENT: "ENTERTAINMENT",

  MEDICAL_PHARMACIES_AND_SUPPLEMENTS: "DRUGSTORES",
};

// Deliberately absent: ONLINE_SHOPPING. The only rate using it is Sapphire
// Preferred's *online grocery* bonus, and Plaid has no code for that — its
// marketplace and electronics codes would pay 3X on Amazon, which the card
// doesn't. Superstores, convenience stores, and warehouse clubs are absent for
// the same reason: Amex excludes them from the 4X supermarket category. Both
// fall to OTHER and earn the base rate, so this under-credits rather than over-.


// Coarser fallback for rows with no detailed code. Deliberately conservative:
// FOOD_AND_DRINK maps to dining rather than groceries because restaurants
// dominate that primary, and a wrong guess here inflates a bonus category.
const BY_PRIMARY: Record<string, RewardCategory> = {
  FOOD_AND_DRINK: "DINING",
  TRAVEL: "TRAVEL",
  TRANSPORTATION: "TRANSIT",
  ENTERTAINMENT: "ENTERTAINMENT",
};

// User-facing category names (from the transactions tab's override menu) that
// correspond to a reward category. An override wins over Plaid's guess, so what
// you see in the transactions tab is what earns here.
const BY_USER_CATEGORY: Record<string, RewardCategory> = {
  "Food and Drink": "DINING",
  Groceries: "GROCERIES",
  Travel: "TRAVEL",
  Transportation: "TRANSIT",
  Entertainment: "ENTERTAINMENT",
  Medical: "DRUGSTORES",
};

/**
 * The reward category a transaction earns under. A user override on the
 * transaction takes precedence, then the detailed PFC code, then the primary.
 * Anything unrecognized falls to OTHER, which every card's base rate covers.
 */
export function rewardCategoryFor(tx: {
  userCategory: string | null;
  pfcPrimary: string;
  pfcDetailed: string | null;
}): RewardCategory {
  if (tx.userCategory) {
    // Overrides may be "Parent > Sub"; only the parent maps to a rate.
    const parent = tx.userCategory.split(">")[0].trim();
    // An override with no reward equivalent (Rent and Utilities, or a name you
    // invented) earns the base rate. Don't fall through to Plaid's guess — that
    // would contradict the category you explicitly chose.
    return BY_USER_CATEGORY[parent] ?? "OTHER";
  }
  if (tx.pfcDetailed && BY_DETAILED[tx.pfcDetailed]) return BY_DETAILED[tx.pfcDetailed];
  return BY_PRIMARY[tx.pfcPrimary] ?? "OTHER";
}
