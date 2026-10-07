-- CreateEnum
CREATE TYPE "ReadingPlanStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- NOTE: `book_progress.clientEntityId` drift is intentionally NOT resolved here.
-- The generated migration bundled an unrelated column-removal statement against
-- `book_progress` — pre-existing schema drift unrelated to group plans /
-- highlights. Per 20261001000300_pwa_contract_cleanup and
-- 20261006041252_progress_activity, the column is deliberately retained in the
-- database (additive rollback policy); removing it is destructive and out of
-- scope. The unrelated statement was removed from this migration.

-- CreateTable
CREATE TABLE "group_reading_plans" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "title" TEXT,
    "startDate" DATE NOT NULL,
    "targetDate" DATE NOT NULL,
    "status" "ReadingPlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "group_reading_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_highlights" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "highlightId" TEXT NOT NULL,
    "sharedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "group_highlights_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "group_reading_plans_groupId_status_idx" ON "group_reading_plans"("groupId", "status");

-- CreateIndex
CREATE INDEX "group_reading_plans_bookId_idx" ON "group_reading_plans"("bookId");

-- CreateIndex
CREATE INDEX "group_highlights_groupId_createdAt_idx" ON "group_highlights"("groupId", "createdAt");

-- CreateIndex
CREATE INDEX "group_highlights_sharedById_idx" ON "group_highlights"("sharedById");

-- CreateIndex
CREATE UNIQUE INDEX "group_highlights_groupId_highlightId_key" ON "group_highlights"("groupId", "highlightId");

-- AddForeignKey
ALTER TABLE "group_reading_plans" ADD CONSTRAINT "group_reading_plans_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_reading_plans" ADD CONSTRAINT "group_reading_plans_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "books"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_reading_plans" ADD CONSTRAINT "group_reading_plans_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_highlights" ADD CONSTRAINT "group_highlights_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_highlights" ADD CONSTRAINT "group_highlights_highlightId_fkey" FOREIGN KEY ("highlightId") REFERENCES "highlights"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_highlights" ADD CONSTRAINT "group_highlights_sharedById_fkey" FOREIGN KEY ("sharedById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
