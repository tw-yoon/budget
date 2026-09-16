/**
 * Refund links: connecting a money-in transaction to the purchase it offsets.
 *
 * Deliberately free of imports — Node's native type stripping lets `node:test`
 * load this file directly, but only while nothing here needs a path alias
 * resolved. Formatting and database access belong to the callers.
 *
 * Plaid sign convention throughout: amount > 0 is money out (a purchase),
 * amount < 0 is money in (a refund, payback, or income).
 */

export interface LinkSide {
  id: string;
  amount: number;
  linkedToId: string | null;
}

/**
 * Why a proposed refund-to-purchase link is invalid, or null if it is fine.
 * Chains are refused so a category never has to be resolved through more than
 * one hop.
 */
export function validateLink(refund: LinkSide, target: LinkSide): string | null {
  if (refund.id === target.id) return "A transaction cannot be linked to itself";
  if (refund.amount >= 0) return "Only a money-in transaction can be linked to a purchase";
  if (target.amount <= 0) return "A refund can only be linked to a purchase (money out)";
  if (target.linkedToId !== null) return "That transaction is itself linked to another purchase";
  return null;
}
