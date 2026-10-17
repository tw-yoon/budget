-- CreateTable
CREATE TABLE "RotatingBonus" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userCardId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "quarter" INTEGER NOT NULL,
    "multiplier" REAL NOT NULL,
    "unit" TEXT NOT NULL,
    "categories" TEXT NOT NULL,
    "merchants" TEXT NOT NULL,
    "excludeMerchants" TEXT NOT NULL DEFAULT '[]',
    "cap" REAL,
    "activated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RotatingBonus_userCardId_fkey" FOREIGN KEY ("userCardId") REFERENCES "UserCard" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "RotatingBonus_userCardId_idx" ON "RotatingBonus"("userCardId");

-- CreateIndex
CREATE UNIQUE INDEX "RotatingBonus_userCardId_year_quarter_key" ON "RotatingBonus"("userCardId", "year", "quarter");

