import type { Metadata } from "next";
import "./globals.css";
import SideNav from "@/components/SideNav";

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
        <SideNav />
        <div className="min-w-0 flex-1">{children}</div>
      </body>
    </html>
  );
}
