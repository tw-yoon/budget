import { P2pCategorizer } from "@/components/P2pCategorizer";

export const metadata = {
  title: "Venmo · Budget Claude",
};

export default function VenmoPage() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <P2pCategorizer
        title="Venmo"
        subtitle="Categorize Venmo payments — changes flow straight into Transactions & Analytics."
        endpoint="/api/venmo"
        showImport
        emptyHint={
          <>
            Drop your{" "}
            <code className="rounded bg-black/[0.06] px-1 py-0.5 text-xs dark:bg-white/10">
              VenmoStatement_*.csv
            </code>{" "}
            exports in your Downloads folder, then hit Import / re-sync CSV.
          </>
        }
      />
    </main>
  );
}
