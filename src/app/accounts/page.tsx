import { AccountsDashboard } from "@/components/AccountsDashboard";

export const metadata = {
  title: "Accounts · Budget Claude",
};

export default function AccountsPage() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <div className="mb-5">
        <h1>Accounts</h1>
        <p className="text-sm text-muted2">
          Real-time balances from Plaid
        </p>
      </div>
      <AccountsDashboard />
    </main>
  );
}
