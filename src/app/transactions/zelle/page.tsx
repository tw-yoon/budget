import { P2pCategorizer } from "@/components/P2pCategorizer";

export const metadata = {
  title: "Zelle · Transactions · Budget Claude",
};

export default function ZellePage() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <P2pCategorizer
        title="Zelle"
        subtitle="Categorize Zelle payments from your bank feed — tagged ones count toward Transactions & Analytics; the rest stay ignored."
        endpoint="/api/zelle"
        emptyHint={
          <>
            Zelle payments arrive automatically with your bank sync. Once a
            connected account has Zelle activity, it shows up here to categorize.
          </>
        }
      />
    </main>
  );
}
