-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "plaidAccountId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "officialName" TEXT,
    "mask" TEXT,
    "type" TEXT NOT NULL,
    "subtype" TEXT,
    "currentBalance" REAL NOT NULL,
    "availableBalance" REAL,
    "balanceFetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "nextPaymentDueDate" DATETIME,
    "lastStatementBalance" REAL,
    "minimumPaymentAmount" REAL,
    "paymentIsOverdue" BOOLEAN,
    "displayName" TEXT,
    "manualDueDay" INTEGER,
    "manualCreditLimit" REAL,
    CONSTRAINT "Account_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "PlaidItem" ("itemId") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Account" ("availableBalance", "balanceFetchedAt", "createdAt", "currentBalance", "id", "itemId", "lastStatementBalance", "manualDueDay", "mask", "minimumPaymentAmount", "name", "nextPaymentDueDate", "officialName", "paymentIsOverdue", "plaidAccountId", "subtype", "type", "updatedAt") SELECT "availableBalance", "balanceFetchedAt", "createdAt", "currentBalance", "id", "itemId", "lastStatementBalance", "manualDueDay", "mask", "minimumPaymentAmount", "name", "nextPaymentDueDate", "officialName", "paymentIsOverdue", "plaidAccountId", "subtype", "type", "updatedAt" FROM "Account";
DROP TABLE "Account";
ALTER TABLE "new_Account" RENAME TO "Account";
CREATE UNIQUE INDEX "Account_plaidAccountId_key" ON "Account"("plaidAccountId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

