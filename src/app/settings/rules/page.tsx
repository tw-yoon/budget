import { RulesDashboard } from "@/components/RulesDashboard";

export const metadata = {
  title: "Rules · Settings · Budget Claude",
};

export default function SettingsRulesPage() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <RulesDashboard />
    </main>
  );
}
