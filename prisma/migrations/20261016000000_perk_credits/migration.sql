-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Transaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "externalId" TEXT NOT NULL,
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
    "priorItemId" TEXT,
    "benefitId" TEXT,
    "benefitDecision" TEXT,
    "perkPaired" BOOLEAN NOT NULL DEFAULT false,
    "noAutoPair" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Transaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Transaction_benefitId_fkey" FOREIGN KEY ("benefitId") REFERENCES "UserBenefit" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Transaction_linkedToId_fkey" FOREIGN KEY ("linkedToId") REFERENCES "Transaction" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Transaction" ("accountId", "amount", "counterparty", "createdAt", "date", "externalId", "fundsCashoutId", "id", "isFee", "isTransfer", "label", "linkedToId", "logoUrl", "merchantName", "name", "pending", "personalNote", "pfcDetailed", "pfcPrimary", "priorItemId", "source", "updatedAt", "userCategory", "userCategorySource") SELECT "accountId", "amount", "counterparty", "createdAt", "date", "externalId", "fundsCashoutId", "id", "isFee", "isTransfer", "label", "linkedToId", "logoUrl", "merchantName", "name", "pending", "personalNote", "pfcDetailed", "pfcPrimary", "priorItemId", "source", "updatedAt", "userCategory", "userCategorySource" FROM "Transaction";
DROP TABLE "Transaction";
ALTER TABLE "new_Transaction" RENAME TO "Transaction";
CREATE UNIQUE INDEX "Transaction_externalId_key" ON "Transaction"("externalId");
CREATE UNIQUE INDEX "Transaction_label_key" ON "Transaction"("label");
CREATE INDEX "Transaction_accountId_date_idx" ON "Transaction"("accountId", "date");
CREATE INDEX "Transaction_date_idx" ON "Transaction"("date");
CREATE INDEX "Transaction_isTransfer_isFee_idx" ON "Transaction"("isTransfer", "isFee");
CREATE INDEX "Transaction_pfcPrimary_idx" ON "Transaction"("pfcPrimary");
CREATE INDEX "Transaction_source_idx" ON "Transaction"("source");
CREATE INDEX "Transaction_fundsCashoutId_idx" ON "Transaction"("fundsCashoutId");
CREATE INDEX "Transaction_linkedToId_idx" ON "Transaction"("linkedToId");
CREATE INDEX "Transaction_priorItemId_idx" ON "Transaction"("priorItemId");
CREATE INDEX "Transaction_benefitId_idx" ON "Transaction"("benefitId");
CREATE TABLE "new_UserBenefit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userCardId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "amount" REAL NOT NULL,
    "period" TEXT NOT NULL,
    "matchCategories" TEXT NOT NULL DEFAULT '[]',
    "matchText" TEXT NOT NULL DEFAULT '[]',
    "perkActiveFrom" DATETIME,
    "usedManual" REAL,
    "manualOverrides" TEXT NOT NULL DEFAULT '{}',
    "pairedMerchants" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserBenefit_userCardId_fkey" FOREIGN KEY ("userCardId") REFERENCES "UserCard" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_UserBenefit" ("amount", "createdAt", "id", "manualOverrides", "matchCategories", "matchText", "name", "notes", "period", "perkActiveFrom", "usedManual", "userCardId") SELECT "amount", "createdAt", "id", "manualOverrides", "matchCategories", "matchText", "name", "notes", "period", "perkActiveFrom", "usedManual", "userCardId" FROM "UserBenefit";
DROP TABLE "UserBenefit";
ALTER TABLE "new_UserBenefit" RENAME TO "UserBenefit";
CREATE INDEX "UserBenefit_userCardId_idx" ON "UserBenefit"("userCardId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

