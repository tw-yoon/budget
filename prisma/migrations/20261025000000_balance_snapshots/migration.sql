-- CreateTable
CREATE TABLE "BalanceSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "takenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "netWorth" REAL NOT NULL,
    "accounts" TEXT NOT NULL
);

-- CreateIndex
CREATE INDEX "BalanceSnapshot_takenAt_idx" ON "BalanceSnapshot"("takenAt");
