"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

// Collapsed mode shows terminal-style three-letter codes instead of icons.
const NAV = [
  { href: "/accounts", label: "Accounts", code: "ACC" },
  { href: "/transactions", label: "Transactions", code: "TRX" },
  { href: "/venmo", label: "Venmo", code: "VNM" },
  { href: "/zelle", label: "Zelle", code: "ZEL" },
  { href: "/analytics", label: "Analytics", code: "ANL" },
  { href: "/benefits", label: "Benefits", code: "BEN" },
  { href: "/subscriptions", label: "Subscriptions", code: "SUB" },
  { href: "/rules", label: "Rules", code: "RUL" },
  { href: "/income", label: "Income", code: "INC" },
];

const STORAGE_KEY = "sidebar-collapsed";

export default function SideNav() {
  const pathname = usePathname();
  // Collapsed by default; a saved preference (if any) overrides on mount.
  const [collapsed, setCollapsed] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stored !== null) setCollapsed(stored === "true");
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(collapsed));
  }, [collapsed]);

  // ⌘B (or Ctrl-B) toggles the sidebar from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === "b" || e.key === "B")) {
        e.preventDefault();
        setCollapsed((c) => !c);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <aside
      className={`sticky top-0 z-50 flex h-screen shrink-0 flex-col self-start border-r border-line bg-panel transition-[width] duration-200 ${
        collapsed ? "w-[52px]" : "w-52"
      }`}
    >
      <Link
        href="/"
        className={`flex h-[46px] shrink-0 items-center whitespace-nowrap border-b border-line font-bold tracking-[.14em] text-accent ${
          collapsed ? "justify-center px-0" : "px-[18px]"
        }`}
      >
        {collapsed ? "B" : "BUDGET"}
        <span className="blink">_</span>
      </Link>

      <nav className="flex flex-1 flex-col overflow-y-auto">
        {NAV.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              aria-current={active ? "page" : undefined}
              className={`flex items-center whitespace-nowrap border-b border-line py-[11px] text-[11px] uppercase tracking-[.12em] ${
                collapsed ? "justify-center px-0" : "px-[18px]"
              } ${
                active
                  ? "bg-accent text-accent-contrast"
                  : "text-muted2 hover:text-accent"
              }`}
            >
              {collapsed ? item.code : item.label}
            </Link>
          );
        })}
      </nav>

      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        title={`${collapsed ? "Expand" : "Collapse"} sidebar (⌘B)`}
        aria-expanded={!collapsed}
        className="flex h-[38px] shrink-0 items-center justify-center gap-2 whitespace-nowrap border-t border-line text-[10px] uppercase tracking-[.14em] text-muted2 hover:text-accent"
      >
        {collapsed ? "▸" : "◂ Collapse"}
      </button>
    </aside>
  );
}
