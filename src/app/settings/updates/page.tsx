import { SettingsUpdates } from "@/components/SettingsUpdates";

export const metadata = {
  title: "Updates · Settings · Budget Claude",
};

export default function SettingsUpdatesPage() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <SettingsUpdates />
    </main>
  );
}
