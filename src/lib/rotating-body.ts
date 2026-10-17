import { REWARD_CATEGORIES, REWARD_UNITS } from "@/lib/rewards";
import { BONUS_EXTRA_CATEGORIES } from "@/lib/rotating";

const ALLOWED = [
  ...REWARD_CATEGORIES.filter((c) => c !== "OTHER" && c !== "ROTATING"),
  ...BONUS_EXTRA_CATEGORIES.map((e) => e.key),
] as string[];

export interface RotatingBody {
  multiplier: number;
  unit: string;
  categories: string[];
  merchants: string[];
  excludeMerchants: string[];
  cap: number | null;
  activated: boolean;
}

// Validates a PUT /api/user-cards/:id/rotating/:year/:quarter body. `baseUnit`
// is the unit of the card's OTHER rate: a bonus in another unit wouldn't
// compare against the card's own rates.
export function parseRotatingBody(
  body: unknown,
  baseUnit: string
): { ok: true; value: RotatingBody } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Body must be an object" };
  const b = body as Record<string, unknown>;
  const fail = (error: string) => ({ ok: false as const, error });

  if (typeof b.multiplier !== "number" || !Number.isFinite(b.multiplier) || b.multiplier <= 0)
    return fail("Rate must be greater than 0");
  if (typeof b.unit !== "string" || !(REWARD_UNITS as readonly string[]).includes(b.unit))
    return fail("Unit must be X or PERCENT");
  if (b.unit !== baseUnit)
    return fail(`Unit must match the card's base unit (${baseUnit})`);
  if (!Array.isArray(b.categories) || b.categories.some((c) => !ALLOWED.includes(c)))
    return fail(`Categories must be from: ${ALLOWED.join(", ")}`);
  const names = (v: unknown) =>
    Array.isArray(v) && v.every((m) => typeof m === "string")
      ? [...new Set((v as string[]).map((m) => m.trim()).filter(Boolean))]
      : null;
  const merchants = names(b.merchants);
  if (!merchants) return fail("Merchants must be a list of names");
  const excludeMerchants = names(b.excludeMerchants);
  if (!excludeMerchants) return fail("Excluded merchants must be a list of names");
  if (b.categories.length === 0 && merchants.length === 0)
    return fail("Add at least one category or merchant");
  if (b.cap !== null && (typeof b.cap !== "number" || !Number.isFinite(b.cap) || b.cap <= 0))
    return fail("Cap must be empty or greater than 0");
  if (typeof b.activated !== "boolean") return fail("Activated must be true or false");

  return {
    ok: true,
    value: {
      multiplier: b.multiplier,
      unit: b.unit,
      categories: [...new Set(b.categories as string[])],
      merchants,
      excludeMerchants,
      cap: b.cap,
      activated: b.activated,
    },
  };
}
