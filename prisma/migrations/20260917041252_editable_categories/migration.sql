-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "CategoryMapping" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pfcPrimary" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    CONSTRAINT "CategoryMapping_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Category_name_key" ON "Category"("name");

-- CreateIndex
CREATE UNIQUE INDEX "CategoryMapping_pfcPrimary_key" ON "CategoryMapping"("pfcPrimary");

-- CreateIndex
CREATE INDEX "CategoryMapping_categoryId_idx" ON "CategoryMapping"("categoryId");

-- Seed: the 23 categories RULE_CATEGORIES produces today (the P2P list unioned
-- with Plaid's primaries, humanized), so the list starts as what the app
-- already offered.
INSERT INTO "Category" ("id", "name", "createdAt") VALUES
  ('cat_bank_fees','Bank Fees',CURRENT_TIMESTAMP),
  ('cat_dining','Dining',CURRENT_TIMESTAMP),
  ('cat_entertainment','Entertainment',CURRENT_TIMESTAMP),
  ('cat_food_and_drink','Food and Drink',CURRENT_TIMESTAMP),
  ('cat_general_merchandise','General Merchandise',CURRENT_TIMESTAMP),
  ('cat_general_services','General Services',CURRENT_TIMESTAMP),
  ('cat_government_and_non_profit','Government and Non Profit',CURRENT_TIMESTAMP),
  ('cat_groceries','Groceries',CURRENT_TIMESTAMP),
  ('cat_home_improvement','Home Improvement',CURRENT_TIMESTAMP),
  ('cat_housing','Housing',CURRENT_TIMESTAMP),
  ('cat_income','Income',CURRENT_TIMESTAMP),
  ('cat_loan_payments','Loan Payments',CURRENT_TIMESTAMP),
  ('cat_medical','Medical',CURRENT_TIMESTAMP),
  ('cat_other','Other',CURRENT_TIMESTAMP),
  ('cat_personal_care','Personal Care',CURRENT_TIMESTAMP),
  ('cat_reimbursement','Reimbursement',CURRENT_TIMESTAMP),
  ('cat_rent_and_utilities','Rent and Utilities',CURRENT_TIMESTAMP),
  ('cat_shopping','Shopping',CURRENT_TIMESTAMP),
  ('cat_transfer','Transfer',CURRENT_TIMESTAMP),
  ('cat_transfer_in','Transfer In',CURRENT_TIMESTAMP),
  ('cat_transfer_out','Transfer Out',CURRENT_TIMESTAMP),
  ('cat_transportation','Transportation',CURRENT_TIMESTAMP),
  ('cat_travel','Travel',CURRENT_TIMESTAMP);

-- Defensive: any parent category already present in the data that the constants
-- somehow did not contain. Normally inserts nothing; guarantees a category in
-- use can never be missing from the list that governs it.
INSERT INTO "Category" ("id", "name", "createdAt")
SELECT 'cat_seeded_' || REPLACE(LOWER(parent), ' ', '_'), parent, CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT
    CASE WHEN INSTR("userCategory", ' > ') > 0
         THEN SUBSTR("userCategory", 1, INSTR("userCategory", ' > ') - 1)
         ELSE "userCategory" END AS parent
  FROM "Transaction" WHERE "userCategory" IS NOT NULL
)
WHERE parent NOT IN (SELECT "name" FROM "Category");

-- Seed the mapping: each Plaid primary points at the category named exactly
-- what humanizePfc(primary) returns today. This is what makes the migration
-- behaviour-preserving — resolving through the map yields the same string the
-- code produces now.
INSERT INTO "CategoryMapping" ("id", "pfcPrimary", "categoryId") VALUES
  ('map_income','INCOME','cat_income'),
  ('map_transfer_in','TRANSFER_IN','cat_transfer_in'),
  ('map_transfer_out','TRANSFER_OUT','cat_transfer_out'),
  ('map_loan_payments','LOAN_PAYMENTS','cat_loan_payments'),
  ('map_bank_fees','BANK_FEES','cat_bank_fees'),
  ('map_entertainment','ENTERTAINMENT','cat_entertainment'),
  ('map_food_and_drink','FOOD_AND_DRINK','cat_food_and_drink'),
  ('map_general_merchandise','GENERAL_MERCHANDISE','cat_general_merchandise'),
  ('map_general_services','GENERAL_SERVICES','cat_general_services'),
  ('map_government_and_non_profit','GOVERNMENT_AND_NON_PROFIT','cat_government_and_non_profit'),
  ('map_home_improvement','HOME_IMPROVEMENT','cat_home_improvement'),
  ('map_medical','MEDICAL','cat_medical'),
  ('map_personal_care','PERSONAL_CARE','cat_personal_care'),
  ('map_rent_and_utilities','RENT_AND_UTILITIES','cat_rent_and_utilities'),
  ('map_transportation','TRANSPORTATION','cat_transportation'),
  ('map_travel','TRAVEL','cat_travel');
