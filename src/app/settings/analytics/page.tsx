import { SettingsAnalytics } from "@/components/SettingsAnalytics";

export const metadata = {
  title: "Analytics · Settings · Budget Claude",
};

export default function SettingsAnalyticsPage() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <SettingsAnalytics />
    </main>
  );
}
