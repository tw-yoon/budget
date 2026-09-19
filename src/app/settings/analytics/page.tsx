import { permanentRedirect } from "next/navigation";

// The Normal/Pro switch stopped being an Analytics-only setting when splitting
// arrived in the ledger. Permanent rather than temporary: this route is not
// coming back, and the settings-sections work set the same precedent for
// /rules.
export default function SettingsAnalyticsPage() {
  permanentRedirect("/settings/mode");
}
