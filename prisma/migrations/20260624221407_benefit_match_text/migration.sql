-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_UserBenefit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userCardId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "amount" REAL NOT NULL,
    "period" TEXT NOT NULL,
    "matchCategories" TEXT NOT NULL DEFAULT '[]',
    "matchText" TEXT NOT NULL DEFAULT '[]',
    "usedManual" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserBenefit_userCardId_fkey" FOREIGN KEY ("userCardId") REFERENCES "UserCard" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_UserBenefit" ("amount", "createdAt", "id", "matchCategories", "name", "notes", "period", "usedManual", "userCardId") SELECT "amount", "createdAt", "id", "matchCategories", "name", "notes", "period", "usedManual", "userCardId" FROM "UserBenefit";
DROP TABLE "UserBenefit";
ALTER TABLE "new_UserBenefit" RENAME TO "UserBenefit";
CREATE INDEX "UserBenefit_userCardId_idx" ON "UserBenefit"("userCardId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
