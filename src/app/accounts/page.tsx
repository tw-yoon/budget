import { AccountsDashboard } from "@/components/AccountsDashboard";

export const metadata = {
  title: "Accounts · Budget Claude",
};

export default function AccountsPage() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <div className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Accounts</h1>
        <p className="text-sm text-black/55 dark:text-white/55">
          Real-time balances from Plaid
        </p>
      </div>
      <AccountsDashboard />
    </main>
  );
}
