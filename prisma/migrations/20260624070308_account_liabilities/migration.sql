-- AlterTable
ALTER TABLE "Account" ADD COLUMN "lastStatementBalance" REAL;
ALTER TABLE "Account" ADD COLUMN "minimumPaymentAmount" REAL;
ALTER TABLE "Account" ADD COLUMN "nextPaymentDueDate" DATETIME;

