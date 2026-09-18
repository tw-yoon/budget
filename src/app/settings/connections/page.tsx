import { SettingsConnections } from "@/components/SettingsConnections";

export const metadata = {
  title: "Connections · Settings · Budget Claude",
};

export default function SettingsConnectionsPage() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <SettingsConnections />
    </main>
  );
}
