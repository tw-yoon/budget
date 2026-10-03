import { SettingsAccess } from "@/components/SettingsAccess";

export const metadata = { title: "Remote Access · Settings · Budget Claude" };

export default function SettingsAccessPage() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <SettingsAccess />
    </main>
  );
}
