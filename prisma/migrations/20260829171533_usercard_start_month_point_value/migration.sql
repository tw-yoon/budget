-- AlterTable
ALTER TABLE "UserCard" ADD COLUMN "membershipStartMonth" INTEGER;
ALTER TABLE "UserCard" ADD COLUMN "pointValueCents" REAL NOT NULL DEFAULT 1;
