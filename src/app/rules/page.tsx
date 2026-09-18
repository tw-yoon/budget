import { permanentRedirect } from "next/navigation";

// /rules was a top-level page and may be bookmarked. The move under Settings is
// permanent, so say so with a 308 rather than a 307.
export default function RulesPage() {
  permanentRedirect("/settings/rules");
}
