import { BenefitsDashboard } from "@/components/BenefitsDashboard";

export const metadata = {
  title: "Benefits · Budget Claude",
};

export default function BenefitsPage() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <div className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Card Benefits</h1>
        <p className="text-sm text-black/55 dark:text-white/55">
          Track credits and perks against your spending
        </p>
      </div>
      <BenefitsDashboard />
    </main>
  );
}
