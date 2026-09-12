-- CreateTable
CREATE TABLE "DebitCard" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "last4" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DebitCard_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "cadence" TEXT NOT NULL DEFAULT 'MONTHLY',
    "nextDate" DATETIME,
    "merchantName" TEXT,
    "accountId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "streamId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "DebitCard_accountId_idx" ON "DebitCard"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_streamId_key" ON "Subscription"("streamId");

