import { prisma } from "@/lib/prisma";
import { nextLabelFrom } from "@/lib/labels";

/**
 * The display serial for the next transaction to be created. Syncs are
 * serialized in this single-user app, so reading the maximum and adding one
 * needs no locking. Labels are never reused: a deleted transaction leaves a
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
