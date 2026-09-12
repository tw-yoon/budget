import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Budget Claude</h1>
      <p className="mt-2 max-w-prose text-black/60 dark:text-white/60">
        Local-first personal budgeting. Your accounts and transactions sync from
        Plaid into a local SQLite database — nothing leaves your machine.
      </p>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href="/transactions"
          className="inline-flex items-center rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
        >
          View transactions →
        </Link>
      </div>
    </main>
  );
}
