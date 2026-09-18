import { redirect } from "next/navigation";

// Settings has no index of its own; Categories is the default landing. This is
// a temporary redirect rather than a permanent one on purpose — giving Settings
// a real index page later should not mean unwinding a 308 that browsers have
// already cached.
export default function SettingsPage() {
  redirect("/settings/categories");
}
