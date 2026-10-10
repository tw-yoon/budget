import { prisma } from "@/lib/prisma";
import { nextLabelFrom } from "@/lib/labels";

// One label-writing job at a time (Plaid syncs, Venmo imports), across every
// request. nextLabel() reads the max label and adds one, so two jobs
// interleaving would hand out the same label and fail the unique constraint.
let queue: Promise<unknown> = Promise.resolve();

export function withLabelLock<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job);
  queue = run.catch(() => {});
  return run;
}

/**
 * The display serial for the next transaction to be created. Callers hold
 * withLabelLock, so reading the maximum and adding one is safe. Labels are never reused: a deleted transaction leaves a
 * permanent gap on purpose.
 */
export async function nextLabel(): Promise<number> {
  const top = await prisma.transaction.findFirst({
    where: { label: { not: null } },
    orderBy: { label: "desc" },
    select: { label: true },
  });
  return nextLabelFrom(top?.label ?? null);
}
