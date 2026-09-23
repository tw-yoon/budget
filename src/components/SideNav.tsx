"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, useEffect, useState } from "react";

type NavItem = {
  href: string;
  label: string;
  code: string;
  children?: { href: string; label: string }[];
};

// Collapsed mode shows terminal-style three-letter codes instead of icons.
// Settings is the one entry with children: they are configuration you set once,
// so they nest rather than competing with the daily-use pages above. They get no
// codes of their own — collapsed, the parent stands for all of them, and
// clicking it lands on Categories via the redirect at /settings.
const NAV: NavItem[] = [
  { href: "/accounts", label: "Accounts", code: "ACC" },
  { href: "/transactions", label: "Transactions", code: "TRX" },
  { href: "/venmo", label: "Venmo", code: "VNM" },
  { href: "/zelle", label: "Zelle", code: "ZEL" },
  { href: "/analytics", label: "Analytics", code: "ANL" },
  { href: "/benefits", label: "Benefits", code: "BEN" },
  { href: "/subscriptions", label: "Subscriptions", code: "SUB" },
  { href: "/income", label: "Income", code: "INC" },
  {
    href: "/settings",
    label: "Settings",
    code: "SET",
    children: [
      { href: "/settings/categories", label: "Categories" },
      { href: "/settings/rules", label: "Rules" },
      { href: "/settings/connections", label: "Connections" },
      { href: "/settings/mode", label: "Mode" },
    ],
  },
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
          // A parent is never itself the destination — /settings redirects to
          // its first child — so when expanded it takes the quieter
          // accent-text treatment and leaves the filled highlight to whichever
          // child is open. Collapsed, children aren't rendered at all, so the
          // parent carries the filled highlight itself, same as every other
          // entry.
          const filled = active && (collapsed || !item.children);
          return (
            <Fragment key={item.href}>
              <Link
                href={item.href}
                title={collapsed ? item.label : undefined}
                aria-current={filled ? "page" : undefined}
                className={`flex items-center whitespace-nowrap border-b border-line py-[11px] text-[11px] uppercase tracking-[.12em] ${
                  collapsed ? "justify-center px-0" : "px-[18px]"
                } ${
                  filled
                    ? "bg-accent text-accent-contrast"
                    : active
                      ? "text-accent"
                      : "text-muted2 hover:text-accent"
                }`}
              >
                {collapsed ? item.code : item.label}
              </Link>
              {!collapsed &&
                item.children?.map((child) => {
                  const childActive = pathname === child.href;
                  return (
                    <Link
                      key={child.href}
                      href={child.href}
                      aria-current={childActive ? "page" : undefined}
                      className={`flex items-center whitespace-nowrap border-b border-line py-[9px] pl-[34px] pr-[18px] text-[10px] uppercase tracking-[.12em] ${
                        childActive
                          ? "bg-accent text-accent-contrast"
                          : "text-muted2 hover:text-accent"
                      }`}
                    >
                      {child.label}
                    </Link>
                  );
                })}
            </Fragment>
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
