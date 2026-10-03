-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN "priorItemId" TEXT;

-- CreateTable
CREATE TABLE "ReconnectMerge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fromItemId" TEXT NOT NULL,
    "intoItemId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "snapshotFile" TEXT,
    "accountIds" TEXT NOT NULL DEFAULT '[]',
    "duplicates" INTEGER NOT NULL DEFAULT 0,
    "detail" TEXT NOT NULL DEFAULT '{}'
);

-- CreateIndex
CREATE INDEX "ReconnectMerge_fromItemId_idx" ON "ReconnectMerge"("fromItemId");

-- CreateIndex
CREATE INDEX "ReconnectMerge_intoItemId_idx" ON "ReconnectMerge"("intoItemId");

-- CreateIndex
CREATE INDEX "Transaction_priorItemId_idx" ON "Transaction"("priorItemId");
