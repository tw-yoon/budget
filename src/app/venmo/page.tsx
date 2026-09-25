import { redirect } from "next/navigation";

// Venmo moved under Transactions. The old address still works for bookmarks;
// temporary rather than permanent for the same reason as /settings.
export default function VenmoPage() {
  redirect("/transactions/venmo");
}
