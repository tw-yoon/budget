"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useProMode } from "./useProMode";

const icon = (d: ReactNode) => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className="shrink-0"
  >
    {d}
  </svg>
);

type NavItem = {
  href: string;
  label: string;
  icon: ReactNode;
  /** Only listed in Pro. The route still answers; it explains itself there. */
  pro?: true;
  children?: { href: string; label: string; pro?: true }[];
};

// Collapsed mode shows each entry's icon alone.
// Three entries have children. Transactions nests Venmo and Zelle, which are
// the same ledger narrowed to one kind of payment; Settings nests
// configuration you set once, so it does not compete with the daily-use pages
// above; Benefits nests because one page of every card's credits, rates and
// earnings was a long scroll to reach anything at the bottom of it. Children
// get no icons of their own — collapsed, the parent stands for all of them,
// and clicking a parent lands on its first child: the ledger itself for
// Transactions, the redirect at /settings and /benefits for the other two.
const NAV: NavItem[] = [
  { href: "/accounts", label: "Accounts", icon: icon(<path d="M2 6.5 8 2.5l6 4M3.5 7v5M6.5 7v5M9.5 7v5M12.5 7v5M2 13.5h12" />) },
  {
    href: "/transactions",
    label: "Transactions",
    icon: icon(<path d="M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01" />),
    children: [
      { href: "/transactions", label: "Ledger" },
      { href: "/transactions/venmo", label: "Venmo" },
      { href: "/transactions/zelle", label: "Zelle" },
    ],
  },
  { href: "/analytics", label: "Analytics", icon: icon(<><path d="M8 2.5v5.5h5.5A5.5 5.5 0 1 1 8 2.5Z" /><path d="M10 2.2a4 4 0 0 1 3.8 3.8H10Z" /></>) },
  {
    href: "/benefits",
    label: "Benefits",
    icon: icon(<><rect x="1.8" y="3.5" width="12.4" height="9" rx="1.8" /><path d="M1.8 6.5h12.4M4 10h2.5" /></>),
    children: [
      { href: "/benefits/cards", label: "Cards" },
      { href: "/benefits/best", label: "Best card" },
      { href: "/benefits/flights", label: "Flights", pro: true },
    ],
  },
  { href: "/subscriptions", label: "Subscriptions", icon: icon(<path d="M13 6.5A5 5 0 0 0 4 5M3 9.5A5 5 0 0 0 12 11M4 2.5V5.2h2.7M12 13.5v-2.7H9.3" />) },
  { href: "/income", label: "Income", icon: icon(<path d="M8 2v12M10.5 5H7a1.8 1.8 0 0 0 0 3.6h2a1.8 1.8 0 0 1 0 3.6H5.5" />), pro: true },
  {
    href: "/settings",
    label: "Settings",
    icon: icon(<><circle cx="8" cy="8" r="2" /><path d="M8 1.8v1.9M8 12.3v1.9M1.8 8h1.9M12.3 8h1.9M3.6 3.6l1.3 1.3M11.1 11.1l1.3 1.3M12.4 3.6l-1.3 1.3M4.9 11.1l-1.3 1.3" /></>),
    children: [
      { href: "/settings/categories", label: "Categories" },
      { href: "/settings/rules", label: "Rules" },
      { href: "/settings/connections", label: "Connections" },
      { href: "/settings/access", label: "Remote Access" },
      { href: "/settings/mode", label: "Mode" },
      { href: "/settings/updates", label: "Updates" },
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
  const shown = (entry: { pro?: true }) => !entry.pro || mode === "pro";
  const items = NAV.filter(shown).map((item) => ({
    ...item,
    children: item.children?.filter(shown),
  }));
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
      className={`sticky top-0 z-50 flex h-screen shrink-0 flex-col self-start border-r border-line bg-panel2 transition-[width] duration-200 ${
        collapsed ? "w-[52px]" : "w-52"
      }`}
    >
      <Link
        href="/transactions"
        className={`flex h-[46px] shrink-0 items-center whitespace-nowrap text-[15px] font-semibold text-foreground ${
          collapsed ? "justify-center px-0" : "px-4"
        }`}
      >
        {collapsed ? "B" : "Budget"}
      </Link>

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 py-1">
        {items.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(item.href + "/");
          // A parent is never itself the destination — /settings redirects to
          // its first child, and /transactions is listed again as its own
          // first child — so when expanded it takes the quieter
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
                aria-label={item.label}
                className={`flex items-center gap-2 whitespace-nowrap rounded-[7px] px-2 py-1.5 text-[13px] ${
                  collapsed ? "justify-center" : ""
                } ${
                  filled
                    ? "bg-accent text-accent-contrast"
                    : active
                      ? "text-accent"
                      : "text-foreground hover:bg-black/5 dark:hover:bg-white/10"
                }`}
              >
                {item.icon}
                {!collapsed && item.label}
              </Link>
              {!collapsed &&
                item.children?.map((child) => {
                  const childActive = pathname === child.href;
                  return (
                    <Link
                      key={child.href}
                      href={child.href}
                      aria-current={childActive ? "page" : undefined}
                      className={`flex items-center whitespace-nowrap rounded-[7px] py-1.5 pl-8 pr-2 text-[13px] ${
                        childActive
                          ? "bg-accent text-accent-contrast"
                          : "text-foreground hover:bg-black/5 dark:hover:bg-white/10"
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
          where the rail is only wide enough for the icons. */}
      {!collapsed && (
        <div className="shrink-0 px-4 py-2 text-[11px] text-dim2">
          v{version}
        </div>
      )}

      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        title={`${collapsed ? "Expand" : "Collapse"} sidebar (⌘B)`}
        aria-expanded={!collapsed}
        className="flex h-[38px] shrink-0 items-center justify-center gap-2 whitespace-nowrap text-[11px] text-dim2 hover:text-accent"
      >
        {collapsed ? "▸" : "◂ Collapse"}
      </button>
    </aside>
  );
}
