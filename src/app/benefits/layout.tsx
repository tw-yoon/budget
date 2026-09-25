// One header for every Benefits page, so the three read as one section rather
// than three unrelated screens — the same shape Settings uses.
export default function BenefitsLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <div className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Card Benefits</h1>
        <p className="text-sm text-black/55 dark:text-white/55">
          Track credits and perks against your spending
        </p>
      </div>
      {children}
    </main>
  );
}
