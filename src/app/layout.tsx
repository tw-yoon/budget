import type { Metadata } from "next";
import "./globals.css";
import SideNav from "@/components/SideNav";
// Read here rather than in SideNav: this is a server component, so the version
// is inlined into the rendered HTML instead of shipping package.json to the
// browser. CHANGELOG.md documents what each version changed.
import { version } from "../../package.json";

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
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full">
        <SideNav version={version} />
        <div className="min-w-0 flex-1">{children}</div>
      </body>
    </html>
  );
}
