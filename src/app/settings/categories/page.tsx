import { SettingsCategories } from "@/components/SettingsCategories";

export const metadata = {
  title: "Categories · Settings · Budget Claude",
};

export default function SettingsCategoriesPage() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <SettingsCategories />
    </main>
  );
}
