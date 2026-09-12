-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_UserCard" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "issuer" TEXT NOT NULL,
    "name" TEXT,
    "last4" TEXT NOT NULL,
    "membershipStartYear" INTEGER NOT NULL,
    "annualFee" REAL NOT NULL DEFAULT 0,
    "accountId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_UserCard" ("accountId", "createdAt", "id", "issuer", "last4", "membershipStartYear", "name") SELECT "accountId", "createdAt", "id", "issuer", "last4", "membershipStartYear", "name" FROM "UserCard";
DROP TABLE "UserCard";
ALTER TABLE "new_UserCard" RENAME TO "UserCard";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
