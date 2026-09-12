import { TransactionLedger } from "@/components/TransactionLedger";

export const metadata = {
  title: "Transactions · Budget Claude",
};

export default function TransactionsPage() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <TransactionLedger />
    </main>
  );
}
