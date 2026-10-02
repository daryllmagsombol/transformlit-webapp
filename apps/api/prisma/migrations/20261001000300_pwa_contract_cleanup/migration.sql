-- Align the offline reader schema with the GraphQL contract.
--
-- Additive policy: this migration only backfills and tightens a constraint. It
-- never removes data and is safe to re-run against the previous client.
--
-- 1. `conflict_copies.sourceEntityId` is non-null in the GraphQL contract and is
--    always written by the server (stale edit, delete-vs-edit, and copy
--    retargets all carry a source entity). Enforce it at the database so the DB
--    and SDL cannot drift. Any historical null is backfilled with the row's own
--    immutable id, which preserves the copy identity without inventing a
--    foreign entity id; the operation that produced such a row originally
--    referenced itself, so this is the honest value.
--
-- 2. `book_progress.clientEntityId` was added speculatively and is never read or
--    written (progress is keyed by `(userId, bookId)` with a revision, not a
--    client entity id). Removing a column is destructive and would violate the
--    additive rollback policy, so the column is intentionally retained in the
--    database and dropped from the Prisma schema only (the column simply has no
--    Prisma field, so it defaults to NULL for new rows).
--
-- 3. `gen_random_uuid()` in 20261001000100_pwa_book_versions is a built-in
--    function from PostgreSQL 13 onward. The supported and tested deployment
--    (Testcontainers `postgres:15-alpine`, local/app PostgreSQL 15) satisfies
--    this. On PostgreSQL 12 the pgcrypto extension provides it, but creating
--    extensions requires elevated privileges and is not attempted here; the
--    supported floor is PG13+.

-- Backfill any historical null with the row's own immutable id before tightening.
UPDATE "conflict_copies"
SET "sourceEntityId" = "id"
WHERE "sourceEntityId" IS NULL;

-- Enforce the GraphQL non-null contract at the database boundary.
ALTER TABLE "conflict_copies"
  ALTER COLUMN "sourceEntityId" SET NOT NULL;
