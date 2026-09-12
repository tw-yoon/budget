-- CreateTable
CREATE TABLE "RewardRate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userCardId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "multiplier" REAL NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'X',
    "notes" TEXT,
    CONSTRAINT "RewardRate_userCardId_fkey" FOREIGN KEY ("userCardId") REFERENCES "UserCard" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "RewardRate_userCardId_idx" ON "RewardRate"("userCardId");

-- CreateIndex
CREATE UNIQUE INDEX "RewardRate_userCardId_category_key" ON "RewardRate"("userCardId", "category");

