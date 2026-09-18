# Settings Sections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Settings into a parent with four child routes — Categories, Rules, Connections, Analytics — and give Analytics a Normal/Pro detail mode.

**Architecture:** Almost all of this is relocation. `SettingsCategories`, `RulesDashboard`, `PlaidLink`, `ConnectedBanks` and `DebitCards` are lifted unchanged; only the pages that render them change. The one piece of new logic is the Analytics detail mode, whose parsing lives in an import-free module so `node:test` can load it directly.

**Tech Stack:** Next.js App Router (server components for the redirects, client components for the editors), React 19, Tailwind 4, `node:test` via Node's native TypeScript type stripping.

**Spec:** `docs/superpowers/specs/2026-09-17-settings-sections-design.md`

## Global Constraints

- **Read the bundled Next docs before writing framework code.** `AGENTS.md` mandates this: "This is NOT the Next.js you know." The docs live in `node_modules/next/dist/docs/`. The redirect reference is `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/redirect.md`.
- **`src/lib/analytics-mode.ts` must contain zero imports.** Node's type stripping lets `node:test` load a `.ts` file directly, but only while nothing in it needs a path alias resolved. A single `import` from `@/…` breaks the test suite. The same constraint governs `src/lib/links.ts`, `src/lib/plaid-errors.ts` and `src/lib/category-rename.ts`.
- **Normal is the default** — including when the stored value is missing, `null`, or unrecognised.
- **Lifted components are not modified.** `SettingsCategories`, `RulesDashboard`, `PlaidLink`, `ConnectedBanks` and `DebitCards` keep their current source exactly. Only their call sites move.
- **Do not start a dev server.** Verify with `npx tsc --noEmit`, `npm run build`, and `npm test`. A server started inside a task collides with the one the controller uses for final verification.
- **Do not touch `prisma/dev.db`.** It holds real financial data. Nothing in this plan requires a schema change, a migration, or a write to it.
- **Page wrapper idiom:** every page body is `<main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">`. Match it exactly.
- **Light/dark pairing idiom:** every colour utility gets its `dark:` partner, as in the surrounding components.

---

## File Structure

**Created:**
- `src/lib/analytics-mode.ts` — the mode type, the store key, and the resolver. Zero imports.
- `scripts/test-analytics-mode.mjs` — `node:test` coverage for the resolver.
- `src/app/settings/categories/page.tsx` — renders `SettingsCategories`.
- `src/app/settings/rules/page.tsx` — renders `RulesDashboard`.
- `src/app/settings/connections/page.tsx` — renders `SettingsConnections`.
- `src/app/settings/analytics/page.tsx` — renders `SettingsAnalytics`.
- `src/components/SettingsConnections.tsx` — composes the two `PlaidLink` buttons, `DebitCards` and `ConnectedBanks`, and owns the `/api/accounts` fetch they need.
- `src/components/SettingsAnalytics.tsx` — the Normal/Pro switch.

**Modified:**
- `src/app/settings/page.tsx` — becomes a redirect to `/settings/categories`.
- `src/app/rules/page.tsx` — becomes a permanent redirect to `/settings/rules`.
- `src/components/AccountsDashboard.tsx` — loses the connection-administration blocks.
- `src/components/AnalyticsDashboard.tsx` — gates the two dense charts on the mode.
- `src/components/SideNav.tsx` — Settings gains children; Rules leaves the top level.
- `package.json` — the new test file joins the `test` script.
- `README.md` — the Pages list and the Tests paragraph.

---

### Task 1: The analytics mode module

**Files:**
- Create: `src/lib/analytics-mode.ts`
- Test: `scripts/test-analytics-mode.mjs`
- Modify: `package.json:10`

**Interfaces:**
- Consumes: nothing.
- Produces: `type AnalyticsMode = "normal" | "pro"`; `const ANALYTICS_MODE_KEY: string`; `function resolveAnalyticsMode(stored: unknown): AnalyticsMode`. Tasks 4 and 5 import all three from `@/lib/analytics-mode`.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-analytics-mode.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  ANALYTICS_MODE_KEY,
  resolveAnalyticsMode,
} from "../src/lib/analytics-mode.ts";

test("a stored pro is honoured", () => {
  assert.equal(resolveAnalyticsMode("pro"), "pro");
});

test("a stored normal stays normal", () => {
  assert.equal(resolveAnalyticsMode("normal"), "normal");
});

test("an unrecognised string falls back to normal", () => {
  assert.equal(resolveAnalyticsMode("expert"), "normal");
  assert.equal(resolveAnalyticsMode(""), "normal");
  assert.equal(resolveAnalyticsMode("PRO"), "normal");
});

test("a missing value falls back to normal", () => {
  assert.equal(resolveAnalyticsMode(null), "normal");
  assert.equal(resolveAnalyticsMode(undefined), "normal");
});

test("a value of the wrong type resolves rather than throwing", () => {
  for (const value of [0, 1, true, false, {}, [], { mode: "pro" }, ["pro"]]) {
    assert.equal(resolveAnalyticsMode(value), "normal");
  }
});

test("the store key is stable", () => {
  // The key names a value already written to data/ui-state.json on the user's
  // machine; changing it silently resets their preference.
  assert.equal(ANALYTICS_MODE_KEY, "analytics-mode");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/test-analytics-mode.mjs`

Expected: FAIL — cannot find module `../src/lib/analytics-mode.ts`.

- [ ] **Step 3: Write the module**

Create `src/lib/analytics-mode.ts`:

```ts
/**
 * How much of the Analytics page to show.
 *
 * Deliberately free of imports — Node's native type stripping lets `node:test`
 * load this file directly, but only while nothing here needs a path alias
 * resolved. The same constraint governs `src/lib/links.ts`,
 * `src/lib/plaid-errors.ts` and `src/lib/category-rename.ts`.
 */

export type AnalyticsMode = "normal" | "pro";

/** The key this preference occupies in the shared ui-state store. */
export const ANALYTICS_MODE_KEY = "analytics-mode";

/**
 * Turn whatever the store holds into a mode.
 *
 * The store is shared across browsers and app versions and is a plain JSON
 * file a user can edit, so the stored value can be anything at all. Everything
 * that is not exactly "pro" resolves to Normal rather than throwing: a corrupt
 * preference must not take the Analytics page down with it.
 */
export function resolveAnalyticsMode(stored: unknown): AnalyticsMode {
  return stored === "pro" ? "pro" : "normal";
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test scripts/test-analytics-mode.mjs`

Expected: PASS, 6 tests.

- [ ] **Step 5: Add the suite to `npm test`**

In `package.json`, line 10, append the new file to the `node --test` list so it reads:

```json
    "test": "bash scripts/test-scrub.sh && bash scripts/test-launcher.sh && node --test scripts/test-links.mjs scripts/test-plaid-errors.mjs scripts/test-categories.mjs scripts/test-analytics-mode.mjs"
```

- [ ] **Step 6: Run the whole suite**

Run: `npm test`

Expected: PASS. The count rises from 39 to 45.

- [ ] **Step 7: Commit**

```bash
git add src/lib/analytics-mode.ts scripts/test-analytics-mode.mjs package.json
git commit -m "Add the analytics detail mode and its resolver"
```

---

### Task 2: Categories and Rules move to child routes

**Files:**
- Create: `src/app/settings/categories/page.tsx`
- Create: `src/app/settings/rules/page.tsx`
- Modify: `src/app/settings/page.tsx` (whole file)
- Modify: `src/app/rules/page.tsx` (whole file)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: the routes `/settings/categories` and `/settings/rules`, which Task 5 links to from the sidebar.

- [ ] **Step 1: Read the Next redirect documentation**

Run: `sed -n '1,60p' node_modules/next/dist/docs/01-app/03-api-reference/04-functions/redirect.md`

Confirm before writing: `redirect` is importable from `next/navigation`, works in a server component, throws to terminate rendering, and issues a 307. `permanentRedirect` is its 308 sibling — the doc's front-matter links to it.

- [ ] **Step 2: Create the categories route**

Create `src/app/settings/categories/page.tsx`:

```tsx
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
```

- [ ] **Step 3: Create the rules route**

Create `src/app/settings/rules/page.tsx`:

```tsx
import { RulesDashboard } from "@/components/RulesDashboard";

export const metadata = {
  title: "Rules · Settings · Budget Claude",
};

export default function SettingsRulesPage() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <RulesDashboard />
    </main>
  );
}
```

- [ ] **Step 4: Turn `/settings` into a redirect**

Replace the entire contents of `src/app/settings/page.tsx` with:

```tsx
import { redirect } from "next/navigation";

// Settings has no index of its own; Categories is the default landing. This is
// a temporary redirect rather than a permanent one on purpose — giving Settings
// a real index page later should not mean unwinding a 308 that browsers have
// already cached.
export default function SettingsPage() {
  redirect("/settings/categories");
}
```

Note the `metadata` export is gone: the page never renders, so a title on it would never be used.

- [ ] **Step 5: Turn `/rules` into a permanent redirect**

Replace the entire contents of `src/app/rules/page.tsx` with:

```tsx
import { permanentRedirect } from "next/navigation";

// /rules was a top-level page and may be bookmarked. The move under Settings is
// permanent, so say so with a 308 rather than a 307.
export default function RulesPage() {
  permanentRedirect("/settings/rules");
}
```

- [ ] **Step 6: Typecheck and build**

Run: `npx tsc --noEmit && npm run build`

Expected: both succeed. The build output lists `/settings/categories` and `/settings/rules` among the routes.

- [ ] **Step 7: Commit**

```bash
git add src/app/settings src/app/rules
git commit -m "Move the category and rules editors under Settings"
```

---

### Task 3: Connections moves off Accounts

**Files:**
- Create: `src/components/SettingsConnections.tsx`
- Create: `src/app/settings/connections/page.tsx`
- Modify: `src/components/AccountsDashboard.tsx:1-10` (imports), `:53-71` (empty state), `:100-111` (the two trailing blocks)

**Interfaces:**
- Consumes: `PlaidLink`, `ConnectedBanks`, `DebitCards` — all unchanged, with these signatures:
  - `PlaidLink({ onConnected?: () => void; itemId?: string; label?: string; variant?: "primary" | "link"; product?: "transactions" | "investments" })`
  - `ConnectedBanks({ banks: BankSummary[]; onChanged: () => void })`
  - `DebitCards({ debitCards: DebitCardDTO[]; checkingAccounts: AccountDTO[]; onChanged: () => void })`
- Produces: `export function SettingsConnections()` in `src/components/SettingsConnections.tsx`, and the route `/settings/connections`, which Task 5 links to.

**A ruling the spec does not cover.** Accounts has an empty state — "No accounts connected" — whose only action is the two `PlaidLink` buttons. Stripping `PlaidLink` from Accounts would leave a user with zero accounts staring at a dead end. The empty state therefore keeps its guidance but sends you to the new page with a `Link` instead of embedding the Plaid button. Accounts ends up with no Plaid button anywhere, which is what the spec asks for, and the empty state still leads somewhere.

- [ ] **Step 1: Create the Connections component**

Create `src/components/SettingsConnections.tsx`. The fetch, error and loading handling mirror `AccountsDashboard` exactly, because both read the same endpoint:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import type { AccountsResponse } from "@/types";
import { PlaidLink } from "./PlaidLink";
import { ConnectedBanks } from "./ConnectedBanks";
import { DebitCards } from "./DebitCards";

export function SettingsConnections() {
  const [data, setData] = useState<AccountsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Same endpoint Accounts reads: the response already carries `banks` and
  // `debitCards`, so administering connections needs no endpoint of its own.
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/accounts");
      if (!res.ok) throw new Error(`Failed to load (HTTP ${res.status})`);
      setData((await res.json()) as AccountsResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Intentional data-fetch effect on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  if (error) {
    return (
      <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
        {error}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-lg border border-black/10 px-4 py-6 text-center text-sm text-black/50 dark:border-white/10 dark:text-white/50">
        Loading…
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col gap-5 ${loading ? "opacity-60 transition-opacity" : ""}`}
    >
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Connections</h1>
        <p className="text-sm text-black/55 dark:text-white/55">
          Banks and debit cards. Accounts and transactions import from whatever
          is connected here.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <PlaidLink onConnected={load} />
        <PlaidLink
          product="investments"
          label="+ Connect investments (brokerage, 401k, HSA)"
          variant="link"
          onConnected={load}
        />
      </div>

      <DebitCards
        debitCards={data.debitCards}
        checkingAccounts={
          data.groups.find((g) => g.type === "DEPOSITORY")?.accounts ?? []
        }
        onChanged={load}
      />

      <ConnectedBanks banks={data.banks} onChanged={load} />
    </div>
  );
}
```

- [ ] **Step 2: Create the Connections route**

Create `src/app/settings/connections/page.tsx`:

```tsx
import { SettingsConnections } from "@/components/SettingsConnections";

export const metadata = {
  title: "Connections · Settings · Budget Claude",
};

export default function SettingsConnectionsPage() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <SettingsConnections />
    </main>
  );
}
```

- [ ] **Step 3: Strip the administration blocks from Accounts**

In `src/components/AccountsDashboard.tsx`:

Replace the import block at lines 1-10 with:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { AccountsResponse } from "@/types";
import { formatCurrency } from "@/lib/format";
import { NetWorthCard } from "./NetWorthCard";
import { AccountCard } from "./AccountCard";
```

Replace the empty-state block — the `if (data && data.summary.accountCount === 0)` branch — with:

```tsx
  if (data && data.summary.accountCount === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-black/10 px-6 py-16 text-center dark:border-white/10">
        <p className="text-sm font-medium">No accounts connected</p>
        <p className="mx-auto max-w-md text-sm text-black/55 dark:text-white/55">
          Connect a bank under Settings to import accounts and transactions. In
          sandbox, log in with <span className="font-medium">user_good</span> /{" "}
          <span className="font-medium">pass_good</span>.
        </p>
        <Link
          href="/settings/connections"
          className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
        >
          Connect a bank
        </Link>
      </div>
    );
  }
```

In the main return, delete the whole `<DebitCards … />` element (its `debitCards`, `checkingAccounts` and `onChanged` props included) and the whole `<ConnectedBanks banks={data.banks} onChanged={load} />` element. Leave everything above them — `NetWorthCard` and the `data.groups.map(…)` block — exactly as it is. After the deletion the return's last three lines are the `</div>` closing the account-groups block, the `</div>` closing the outer wrapper, and `);`.

- [ ] **Step 4: Verify nothing still references the removed imports**

Run: `grep -n "PlaidLink\|DebitCards\|ConnectedBanks" src/components/AccountsDashboard.tsx`

Expected: no output. If anything matches, it is a leftover reference that the typecheck in the next step would catch anyway — remove it.

- [ ] **Step 5: Typecheck and build**

Run: `npx tsc --noEmit && npm run build`

Expected: both succeed, with `/settings/connections` listed in the route output.

- [ ] **Step 6: Commit**

```bash
git add src/components/SettingsConnections.tsx src/app/settings/connections src/components/AccountsDashboard.tsx
git commit -m "Move bank and debit-card administration under Settings"
```

---

### Task 4: The analytics detail mode

**Files:**
- Create: `src/components/SettingsAnalytics.tsx`
- Create: `src/app/settings/analytics/page.tsx`
- Modify: `src/components/AnalyticsDashboard.tsx` — imports, one new state hook, and the render's chart region

**Interfaces:**
- Consumes: `ANALYTICS_MODE_KEY`, `resolveAnalyticsMode`, `type AnalyticsMode` from `@/lib/analytics-mode` (Task 1); `loadSynced(key: string): Promise<unknown>` and `pushSynced(key: string, value: unknown): void` from `@/lib/ui-state`.
- Produces: `export function SettingsAnalytics()` in `src/components/SettingsAnalytics.tsx`, and the route `/settings/analytics`, which Task 5 links to.

- [ ] **Step 1: Create the switch component**

Create `src/components/SettingsAnalytics.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { loadSynced, pushSynced } from "@/lib/ui-state";
import {
  ANALYTICS_MODE_KEY,
  resolveAnalyticsMode,
  type AnalyticsMode,
} from "@/lib/analytics-mode";

const MODES: { value: AnalyticsMode; label: string; blurb: string }[] = [
  {
    value: "normal",
    label: "Normal",
    blurb: "Summary cards, spending by category, and the monthly trend.",
  },
  {
    value: "pro",
    label: "Pro",
    blurb:
      "Everything in Normal, plus the cash-flow diagram and the cumulative spending graph.",
  },
];

export function SettingsAnalytics() {
  // Normal until the stored value arrives, which is also the default if it
  // never does.
  const [mode, setMode] = useState<AnalyticsMode>("normal");

  useEffect(() => {
    let cancelled = false;
    void loadSynced(ANALYTICS_MODE_KEY).then((stored) => {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (!cancelled) setMode(resolveAnalyticsMode(stored));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function choose(next: AnalyticsMode) {
    setMode(next);
    pushSynced(ANALYTICS_MODE_KEY, next);
  }

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
        <p className="text-sm text-black/55 dark:text-white/55">
          How much detail the Analytics page shows.
        </p>
      </header>

      <div className="flex flex-col gap-3">
        {MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            onClick={() => choose(m.value)}
            aria-pressed={mode === m.value}
            className={`rounded-lg border px-4 py-3 text-left transition-colors ${
              mode === m.value
                ? "border-foreground bg-black/[0.03] dark:bg-white/[0.06]"
                : "border-black/10 hover:border-black/30 dark:border-white/10 dark:hover:border-white/30"
            }`}
          >
            <span className="flex items-center gap-2 text-sm font-medium">
              {m.label}
              {mode === m.value && (
                <span className="rounded bg-foreground px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-background">
                  Current
                </span>
              )}
            </span>
            <span className="mt-1 block text-sm text-black/55 dark:text-white/55">
              {m.blurb}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create the route**

Create `src/app/settings/analytics/page.tsx`:

```tsx
import { SettingsAnalytics } from "@/components/SettingsAnalytics";

export const metadata = {
  title: "Analytics · Settings · Budget Claude",
};

export default function SettingsAnalyticsPage() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <SettingsAnalytics />
    </main>
  );
}
```

- [ ] **Step 3: Teach AnalyticsDashboard the mode**

In `src/components/AnalyticsDashboard.tsx`, add to the imports at the top of the file:

```tsx
import Link from "next/link";
import { loadSynced } from "@/lib/ui-state";
import {
  ANALYTICS_MODE_KEY,
  resolveAnalyticsMode,
  type AnalyticsMode,
} from "@/lib/analytics-mode";
```

Add one state hook beside the existing ones, directly after the `const [error, setError] = useState<string | null>(null);` line:

```tsx
  // Normal until the stored preference arrives; Normal for good if it never
  // does, or if what it holds is not a mode we recognise.
  const [mode, setMode] = useState<AnalyticsMode>("normal");
```

Add its loader beside the existing mount effect:

```tsx
  useEffect(() => {
    let cancelled = false;
    void loadSynced(ANALYTICS_MODE_KEY).then((stored) => {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (!cancelled) setMode(resolveAnalyticsMode(stored));
    });
    return () => {
      cancelled = true;
    };
  }, []);
```

- [ ] **Step 4: Gate the two dense charts**

In the same file, replace the chart region at the end of the return — currently `<CashFlowSankey />`, `<SpendingGraph />`, and the two-column grid — with:

```tsx
      {mode === "pro" && (
        <>
          <CashFlowSankey />
          <SpendingGraph />
        </>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <CategoryChart />
        <MonthlyTrendChart />
      </div>

      {mode === "normal" && (
        <p className="text-center text-xs text-black/45 dark:text-white/45">
          Cash flow and cumulative spending are hidden in Normal mode —{" "}
          <Link
            href="/settings/analytics"
            className="underline underline-offset-2 hover:text-foreground"
          >
            switch to Pro in Settings
          </Link>
          .
        </p>
      )}
```

The line matters: without it the two charts simply vanish and the page reads as broken rather than simplified.

- [ ] **Step 5: Typecheck and build**

Run: `npx tsc --noEmit && npm run build`

Expected: both succeed, with `/settings/analytics` in the route output.

- [ ] **Step 6: Commit**

```bash
git add src/components/SettingsAnalytics.tsx src/app/settings/analytics src/components/AnalyticsDashboard.tsx
git commit -m "Give Analytics a Normal and Pro detail mode"
```

---

### Task 5: Sidebar nesting and documentation

**Files:**
- Modify: `src/components/SideNav.tsx:7-20` (the `NAV` array) and `:65-87` (the `<nav>` render)
- Modify: `README.md` — the Pages list and the Tests paragraph

**Interfaces:**
- Consumes: the four routes from Tasks 2, 3 and 4 — `/settings/categories`, `/settings/rules`, `/settings/connections`, `/settings/analytics`.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Restructure the NAV array**

In `src/components/SideNav.tsx`, replace the comment and `NAV` declaration (lines 7-20) with:

```tsx
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
      { href: "/settings/analytics", label: "Analytics" },
    ],
  },
];
```

The top-level `Rules` entry is gone — that is the point of the change, not an oversight.

- [ ] **Step 2: Import Fragment**

Change the React import at line 5 to:

```tsx
import { Fragment, useEffect, useState } from "react";
```

- [ ] **Step 3: Render the children**

Replace the whole `<nav>` block with:

```tsx
      <nav className="flex flex-1 flex-col overflow-y-auto">
        {NAV.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(item.href + "/");
          // A parent is never itself the destination — /settings redirects to
          // its first child — so it takes the quieter accent-text treatment and
          // leaves the filled highlight to whichever child is open.
          const filled = active && !item.children;
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
```

- [ ] **Step 4: Typecheck and build**

Run: `npx tsc --noEmit && npm run build`

Expected: both succeed.

- [ ] **Step 5: Update the README Pages list**

In `README.md`, in the `## Pages` section: change the `/accounts` line, delete the `/rules` line, and add the Settings entries. The list becomes:

```markdown
- `/` — home
- `/accounts` — balances, net worth, due dates
- `/transactions` — ledger with search & filters; connect a refund to the purchase it pays back
- `/venmo` — categorize Venmo payments, or connect a payback to what it covers; changes flow into Transactions & Analytics
- `/zelle` — categorize or connect Zelle payments from your bank feed the same way
- `/analytics` — spending by category, monthly trend, top merchants
- `/benefits` — card earning rates + statement credits + "best card by category"
- `/subscriptions` — detected recurring subscriptions and their monthly total
- `/income` — income and tax organizer
- `/settings/categories` — rename, merge and delete categories
- `/settings/rules` — auto-assign a category when a transaction matches a rule
- `/settings/connections` — connect/disconnect banks, reconnect, manage debit cards
- `/settings/analytics` — how much detail the Analytics page shows
```

- [ ] **Step 6: Update the README Tests paragraph**

In the `## Tests` section, the sentence listing what the `.mjs` suites cover currently reads "refund linking, the wording of a failed sync". Change that phrase to:

```markdown
refund linking, the wording of a failed sync, category renaming, the analytics
detail mode
```

- [ ] **Step 7: Run the full suite**

Run: `npm test`

Expected: PASS. `scripts/test-scrub.sh` also passes — it checks that no personal data or absolute home path is about to be published, and the README edits must not introduce one.

- [ ] **Step 8: Commit**

```bash
git add src/components/SideNav.tsx README.md
git commit -m "Nest the Settings pages in the sidebar"
```

---

## Verification after all tasks

Behavioural, since almost everything here is relocation. The controller runs these against a preview server:

1. `/settings` lands on Categories; the category editor works — rename, merge confirmation, delete refusal on "Transfer".
2. `/rules` lands on `/settings/rules` with a 308; the rules editor works.
3. `/settings/connections` lists banks and debit cards, and both Plaid buttons open Link.
4. Accounts shows net worth, groups, balances and due dates, and no administration blocks.
5. The sidebar shows four indented children under Settings when expanded, only `SET` when collapsed, and the open child is highlighted.
6. Analytics in Normal shows summary cards, category chart and monthly trend, plus the line pointing at Settings; switching to Pro adds the Sankey and the spending graph; the choice survives a reload.
