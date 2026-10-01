-- Additive offline reader synchronization schema (Task 8).
-- Receipts, tombstones, conflict copies and revision/provenance columns.
-- No destructive rollback: all changes are additive ALTER/CREATE only.

-- CreateEnum
CREATE TYPE "ReaderEntityKind" AS ENUM ('PROGRESS', 'BOOKMARK', 'ANNOTATION');

-- CreateEnum
CREATE TYPE "ConflictReason" AS ENUM ('STALE_REVISION', 'DELETE_VS_EDIT');

-- AlterTable
ALTER TABLE "book_progress" ADD COLUMN     "clientEntityId" TEXT,
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "bookmarks" ADD COLUMN     "clientEntityId" TEXT,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "highlights" ADD COLUMN     "clientEntityId" TEXT,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "reader_operation_receipts" (
    "id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reader_operation_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reader_tombstones" (
    "id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "kind" "ReaderEntityKind" NOT NULL,
    "revision" INTEGER NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reader_tombstones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conflict_copies" (
    "id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "sourceEntityId" TEXT,
    "bookId" TEXT NOT NULL,
    "contentVersion" INTEGER NOT NULL,
    "page" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "note" TEXT,
    "color" TEXT,
    "anchor" JSONB,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "reason" "ConflictReason" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conflict_copies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reader_operation_receipts_subject_createdAt_idx" ON "reader_operation_receipts"("subject", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "reader_operation_receipts_subject_operationId_key" ON "reader_operation_receipts"("subject", "operationId");

-- CreateIndex
CREATE INDEX "reader_tombstones_subject_kind_idx" ON "reader_tombstones"("subject", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "reader_tombstones_subject_entityId_key" ON "reader_tombstones"("subject", "entityId");

-- CreateIndex
CREATE INDEX "conflict_copies_subject_bookId_idx" ON "conflict_copies"("subject", "bookId");

-- CreateIndex
CREATE INDEX "conflict_copies_sourceEntityId_idx" ON "conflict_copies"("sourceEntityId");

-- CreateIndex
CREATE UNIQUE INDEX "bookmarks_userId_clientEntityId_key" ON "bookmarks"("userId", "clientEntityId");

-- CreateIndex
CREATE UNIQUE INDEX "highlights_userId_clientEntityId_key" ON "highlights"("userId", "clientEntityId");

-- AddForeignKey
ALTER TABLE "reader_operation_receipts" ADD CONSTRAINT "reader_operation_receipts_subject_fkey" FOREIGN KEY ("subject") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reader_tombstones" ADD CONSTRAINT "reader_tombstones_subject_fkey" FOREIGN KEY ("subject") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conflict_copies" ADD CONSTRAINT "conflict_copies_subject_fkey" FOREIGN KEY ("subject") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conflict_copies" ADD CONSTRAINT "conflict_copies_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "books"("id") ON DELETE CASCADE ON UPDATE CASCADE;

