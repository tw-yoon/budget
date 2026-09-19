import { SettingsMode } from "@/components/SettingsMode";

export const metadata = {
  title: "Mode · Settings · Budget Claude",
};

export default function SettingsModePage() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <SettingsMode />
    </main>
  );
}
