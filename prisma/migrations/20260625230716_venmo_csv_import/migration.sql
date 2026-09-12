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
    "counterparty" TEXT,
    "fundsCashoutId" TEXT,
    CONSTRAINT "Transaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Transaction" ("accountId", "amount", "createdAt", "date", "id", "isFee", "isTransfer", "logoUrl", "merchantName", "name", "pending", "personalNote", "pfcDetailed", "pfcPrimary", "plaidTxId", "updatedAt") SELECT "accountId", "amount", "createdAt", "date", "id", "isFee", "isTransfer", "logoUrl", "merchantName", "name", "pending", "personalNote", "pfcDetailed", "pfcPrimary", "plaidTxId", "updatedAt" FROM "Transaction";
DROP TABLE "Transaction";
ALTER TABLE "new_Transaction" RENAME TO "Transaction";
CREATE UNIQUE INDEX "Transaction_plaidTxId_key" ON "Transaction"("plaidTxId");
CREATE INDEX "Transaction_accountId_date_idx" ON "Transaction"("accountId", "date");
CREATE INDEX "Transaction_date_idx" ON "Transaction"("date");
CREATE INDEX "Transaction_isTransfer_isFee_idx" ON "Transaction"("isTransfer", "isFee");
CREATE INDEX "Transaction_pfcPrimary_idx" ON "Transaction"("pfcPrimary");
CREATE INDEX "Transaction_source_idx" ON "Transaction"("source");
CREATE INDEX "Transaction_fundsCashoutId_idx" ON "Transaction"("fundsCashoutId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
