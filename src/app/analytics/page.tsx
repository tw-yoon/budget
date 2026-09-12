import { AnalyticsDashboard } from "@/components/AnalyticsDashboard";

export const metadata = {
  title: "Analytics · Budget Claude",
};

export default function AnalyticsPage() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <AnalyticsDashboard />
    </main>
  );
}
