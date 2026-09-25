"use client";

import Link from "next/link";
import { useProMode } from "./useProMode";

/**
 * Wraps a page that only exists in Pro.
 *
 * Nothing is rendered until the stored mode arrives: Normal is the hook's
 * placeholder before then, not a fact about the user, so asserting it would
 * flash "turn on Pro" at someone who already has it. The route stays reachable
 * and explains itself rather than redirecting — a bookmark that silently lands
 * somewhere else is harder to understand than a page that says why it is empty
 * and where the switch is.
 *
 * `nested` is for a page inside a section layout that already supplies the
 * <main> and the page heading, as Benefits does; the notice then drops both.
 */
export function ProOnly({
  title,
  nested = false,
  children,
}: {
  title: string;
  nested?: boolean;
  children: React.ReactNode;
}) {
  const { mode, loading } = useProMode();

  if (loading) return null;
  if (mode === "pro") return <>{children}</>;

  const notice = (
    <>
      <p className="mt-2 max-w-prose text-sm text-black/55 dark:text-white/55">
        {title} is part of Pro. Nothing you have entered is lost — turn Pro on
        and it is here as you left it.
      </p>
      <Link
        href="/settings/mode"
        className="mt-6 inline-flex items-center rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
      >
        Settings → Mode
      </Link>
    </>
  );

  if (nested)
    return (
      <section className="py-8">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {notice}
      </section>
    );

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {notice}
    </main>
  );
}
