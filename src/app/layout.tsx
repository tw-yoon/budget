import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";
import SideNav from "@/components/SideNav";
// Read here rather than in SideNav: this is a server component, so the version
// is inlined into the rendered HTML instead of shipping package.json to the
// browser. CHANGELOG.md documents what each version changed.
import { version } from "../../package.json";
import { THEME_KEY } from "@/lib/theme";

// Applies a saved light/dark choice during HTML parse, before anything paints.
// The preference lives in the shared ui-state store, which is read over the
// network — far too late to decide a palette — but pushSynced mirrors every
// write into localStorage, so this browser's copy is readable synchronously.
// Anything unexpected (or nothing stored) leaves the attribute off, which is
// "system": globals.css then follows prefers-color-scheme.
const applyStoredTheme = `try{var v=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(v){try{v=JSON.parse(v)}catch(e){}if(v==="light"||v==="dark"){document.documentElement.dataset.theme=v}}}catch(e){}`;

export const metadata: Metadata = {
  title: "Budget Claude",
  description: "Local-first personal budgeting",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // The script below sets data-theme before React hydrates, which is exactly
    // the mismatch this attribute is for: the server cannot know the choice,
    // and repainting after hydration would be the flash it exists to prevent.
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <body className="flex min-h-full">
        <Script id="apply-stored-theme" strategy="beforeInteractive">
          {applyStoredTheme}
        </Script>
        <SideNav version={version} />
        <div className="min-w-0 flex-1">{children}</div>
      </body>
    </html>
  );
}
