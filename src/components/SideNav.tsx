"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, useEffect, useState } from "react";
import { useProMode } from "./useProMode";

type NavItem = {
  href: string;
  label: string;
  code: string;
  /** Only listed in Pro. The route still answers; it explains itself there. */
  pro?: true;
  children?: { href: string; label: string }[];
};

// Collapsed mode shows terminal-style three-letter codes instead of icons.
// Two entries have children. Settings nests configuration you set once, so it
// does not compete with the daily-use pages above; Benefits nests because one
// page of every card's credits, rates and earnings was a long scroll to reach
// anything at the bottom of it. Children get no codes of their own —
// collapsed, the parent stands for all of them, and clicking a parent lands on
// its first child via the redirect at /settings and /benefits.
const NAV: NavItem[] = [
  { href: "/accounts", label: "Accounts", code: "ACC" },
  { href: "/transactions", label: "Transactions", code: "TRX" },
  { href: "/venmo", label: "Venmo", code: "VNM" },
  { href: "/zelle", label: "Zelle", code: "ZEL" },
  { href: "/analytics", label: "Analytics", code: "ANL" },
  {
    href: "/benefits",
    label: "Benefits",
    code: "BEN",
    children: [
      { href: "/benefits/cards", label: "Cards" },
      { href: "/benefits/best", label: "Best card" },
      { href: "/benefits/flights", label: "Flights" },
    ],
  },
  { href: "/subscriptions", label: "Subscriptions", code: "SUB" },
  { href: "/income", label: "Income", code: "INC", pro: true },
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

export default function SideNav({ version }: { version: string }) {
  const pathname = usePathname();
  // Pro entries stay out of the nav until the stored mode says otherwise —
  // including while it is still loading, so a Normal user never sees one
  // appear and then vanish. A Pro user's entries arrive a moment after mount,
  // which is the same way the Pro sections of Analytics behave.
  const { mode } = useProMode();
  const items = NAV.filter((item) => !item.pro || mode === "pro");
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
        {items.map((item) => {
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

      {/* Which build you are looking at — the same string the launcher
          reports and CHANGELOG.md is written against. Hidden when collapsed,
          where the rail is only wide enough for the three-letter codes. */}
      {!collapsed && (
        <div className="shrink-0 border-t border-line px-[18px] py-[7px] text-[10px] uppercase tracking-[.14em] text-muted2">
          v{version}
        </div>
      )}

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
