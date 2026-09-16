-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Transaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "plaidTxId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "date" DATETIME NOT NULL,
    "name" TEXT NOT NULL,
    "merchantName" TEXT,
    "pfcPrimary" TEXT NOT NULL DEFAULT 'UNCATEGORIZED',
    "pfcDetailed" TEXT,
    "logoUrl" TEXT,
    "pending" BOOLEAN NOT NULL DEFAULT false,
    "isTransfer" BOOLEAN NOT NULL DEFAULT false,
    "isFee" BOOLEAN NOT NULL DEFAULT false,
    "personalNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'PLAID',
    "userCategory" TEXT,
    "userCategorySource" TEXT,
    "counterparty" TEXT,
    "fundsCashoutId" TEXT,
    "label" INTEGER,
    "linkedToId" TEXT,
    CONSTRAINT "Transaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Transaction_linkedToId_fkey" FOREIGN KEY ("linkedToId") REFERENCES "Transaction" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Transaction" ("accountId", "amount", "counterparty", "createdAt", "date", "fundsCashoutId", "id", "isFee", "isTransfer", "logoUrl", "merchantName", "name", "pending", "personalNote", "pfcDetailed", "pfcPrimary", "plaidTxId", "source", "updatedAt", "userCategory", "userCategorySource") SELECT "accountId", "amount", "counterparty", "createdAt", "date", "fundsCashoutId", "id", "isFee", "isTransfer", "logoUrl", "merchantName", "name", "pending", "personalNote", "pfcDetailed", "pfcPrimary", "plaidTxId", "source", "updatedAt", "userCategory", "userCategorySource" FROM "Transaction";
DROP TABLE "Transaction";
ALTER TABLE "new_Transaction" RENAME TO "Transaction";
CREATE UNIQUE INDEX "Transaction_plaidTxId_key" ON "Transaction"("plaidTxId");
CREATE UNIQUE INDEX "Transaction_label_key" ON "Transaction"("label");
CREATE INDEX "Transaction_accountId_date_idx" ON "Transaction"("accountId", "date");
CREATE INDEX "Transaction_date_idx" ON "Transaction"("date");
CREATE INDEX "Transaction_isTransfer_isFee_idx" ON "Transaction"("isTransfer", "isFee");
CREATE INDEX "Transaction_pfcPrimary_idx" ON "Transaction"("pfcPrimary");
CREATE INDEX "Transaction_source_idx" ON "Transaction"("source");
CREATE INDEX "Transaction_fundsCashoutId_idx" ON "Transaction"("fundsCashoutId");
CREATE INDEX "Transaction_linkedToId_idx" ON "Transaction"("linkedToId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;


-- Backfill: oldest transaction is #1. Ordering by date then createdAt keeps
-- the numbering deterministic when several rows share a date.
UPDATE "Transaction" SET "label" = (SELECT rn FROM
  (SELECT id, ROW_NUMBER() OVER (ORDER BY "date" ASC, "createdAt" ASC) rn FROM "Transaction") s
  WHERE s.id = "Transaction"."id");
