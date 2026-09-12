import { SubscriptionsDashboard } from "@/components/SubscriptionsDashboard";

export const metadata = {
  title: "Subscriptions · Budget Claude",
};

export default function SubscriptionsPage() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <SubscriptionsDashboard />
    </main>
  );
}
