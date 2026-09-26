import { redirect } from "next/navigation";

// There is no start page: the app opens on the ledger. A plain redirect (307),
// not permanent, so a start page could come back without stale browser caches.
export default function Home() {
  redirect("/transactions");
}
