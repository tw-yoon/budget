import { redirect } from "next/navigation";

// Benefits has no index of its own; the card list is the default landing.
// Temporary rather than permanent on purpose: giving Benefits a real index
// later should not mean unwinding a 308 that browsers have already cached.
// Same reasoning as /settings.
export default function BenefitsPage() {
  redirect("/benefits/cards");
}
