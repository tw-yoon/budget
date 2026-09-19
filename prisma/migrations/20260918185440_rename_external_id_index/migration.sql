-- Finish the plaidTxId -> externalId rename by renaming its unique index.
--
-- SQLite's ALTER TABLE ... RENAME COLUMN repoints an index at the new column
-- but keeps the index's own name, so the previous migration left the database
-- carrying "Transaction_plaidTxId_key" over a column called externalId. Prisma
-- derives index names from the schema and saw that as drift, which would have
-- surfaced as a surprise RedefineIndex in whatever migration came next.
--
-- Separate from the previous migration rather than folded into it: that one is
-- already applied, and editing an applied migration invalidates its recorded
-- checksum. Splitting costs an extra folder and risks nothing.
DROP INDEX "Transaction_plaidTxId_key";
CREATE UNIQUE INDEX "Transaction_externalId_key" ON "Transaction"("externalId");
