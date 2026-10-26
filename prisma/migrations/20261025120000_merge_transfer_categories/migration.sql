-- Fold "Transfer In" and "Transfer Out" into "Transfer". Only "Transfer" is the
-- exclusion marker analytics honours; the other two were seeded from Plaid's
-- primaries and read as ordinary categories, so money tagged "Transfer In"
-- netted against spending like a refund. Keyed on names, not ids, so a database
-- whose rows were seeded differently still merges.

INSERT OR IGNORE INTO "Category" ("id", "name", "createdAt")
VALUES ('cat_transfer', 'Transfer', CURRENT_TIMESTAMP);

-- Subcategories move under Transfer; one Transfer already has is kept as is.
INSERT OR IGNORE INTO "Subcategory" ("id", "categoryId", "name", "createdAt")
SELECT s."id" || '_transfer', (SELECT "id" FROM "Category" WHERE "name" = 'Transfer'), s."name", s."createdAt"
FROM "Subcategory" s JOIN "Category" c ON c."id" = s."categoryId"
WHERE c."name" IN ('Transfer In', 'Transfer Out');

-- "Transfer In" → "Transfer", "Transfer In > Sub" → "Transfer > Sub".
UPDATE "Transaction" SET "userCategory" = 'Transfer' || SUBSTR("userCategory", 12)
WHERE "userCategory" = 'Transfer In' OR "userCategory" GLOB 'Transfer In > *';
UPDATE "Transaction" SET "userCategory" = 'Transfer' || SUBSTR("userCategory", 13)
WHERE "userCategory" = 'Transfer Out' OR "userCategory" GLOB 'Transfer Out > *';

UPDATE "TransactionSplit" SET "userCategory" = 'Transfer' || SUBSTR("userCategory", 12)
WHERE "userCategory" = 'Transfer In' OR "userCategory" GLOB 'Transfer In > *';
UPDATE "TransactionSplit" SET "userCategory" = 'Transfer' || SUBSTR("userCategory", 13)
WHERE "userCategory" = 'Transfer Out' OR "userCategory" GLOB 'Transfer Out > *';

UPDATE "CategoryRule" SET "category" = 'Transfer' || SUBSTR("category", 12)
WHERE "category" = 'Transfer In' OR "category" GLOB 'Transfer In > *';
UPDATE "CategoryRule" SET "category" = 'Transfer' || SUBSTR("category", 13)
WHERE "category" = 'Transfer Out' OR "category" GLOB 'Transfer Out > *';

-- Plaid's TRANSFER_IN / TRANSFER_OUT (and anything else mapped there) now
-- resolve to Transfer.
UPDATE "CategoryMapping" SET "categoryId" = (SELECT "id" FROM "Category" WHERE "name" = 'Transfer')
WHERE "categoryId" IN (SELECT "id" FROM "Category" WHERE "name" IN ('Transfer In', 'Transfer Out'));

DELETE FROM "Subcategory"
WHERE "categoryId" IN (SELECT "id" FROM "Category" WHERE "name" IN ('Transfer In', 'Transfer Out'));
DELETE FROM "Category" WHERE "name" IN ('Transfer In', 'Transfer Out');
