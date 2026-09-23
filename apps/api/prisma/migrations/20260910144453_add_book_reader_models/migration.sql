-- CreateEnum
CREATE TYPE "BookFormat" AS ENUM ('PDF', 'EPUB');

-- CreateEnum
CREATE TYPE "ConversionStatus" AS ENUM ('NOT_APPLICABLE', 'PENDING', 'PROCESSING', 'READY', 'FAILED');

-- AlterTable
ALTER TABLE "bookmarks" ADD COLUMN     "anchor" JSONB,
ADD COLUMN     "contentVersion" INTEGER;

-- AlterTable
ALTER TABLE "books" ADD COLUMN     "contentVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "conversionError" TEXT,
ADD COLUMN     "conversionStatus" "ConversionStatus" NOT NULL DEFAULT 'NOT_APPLICABLE',
ADD COLUMN     "format" "BookFormat",
ADD COLUMN     "pageCount" INTEGER;

-- AlterTable
ALTER TABLE "highlights" ADD COLUMN     "anchor" JSONB,
ADD COLUMN     "contentVersion" INTEGER;

-- CreateTable
CREATE TABLE "book_pages" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "assetKey" TEXT NOT NULL,
    "textKey" TEXT,
    "mimeType" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "charCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "book_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "book_toc_entries" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "page" INTEGER NOT NULL,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "order" INTEGER NOT NULL,

    CONSTRAINT "book_toc_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "book_conversion_jobs" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lockedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "book_conversion_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reading_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reading_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "page_views" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "page" INTEGER NOT NULL,
    "contentVersion" INTEGER NOT NULL,
    "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "page_views_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "book_pages_bookId_index_key" ON "book_pages"("bookId", "index");

-- CreateIndex
CREATE INDEX "book_toc_entries_bookId_order_idx" ON "book_toc_entries"("bookId", "order");

-- CreateIndex
CREATE INDEX "book_conversion_jobs_status_createdAt_idx" ON "book_conversion_jobs"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "reading_sessions_tokenHash_key" ON "reading_sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "reading_sessions_userId_bookId_idx" ON "reading_sessions"("userId", "bookId");

-- CreateIndex
CREATE INDEX "reading_sessions_expiresAt_idx" ON "reading_sessions"("expiresAt");

-- CreateIndex
CREATE INDEX "page_views_bookId_viewedAt_idx" ON "page_views"("bookId", "viewedAt");

-- CreateIndex
CREATE INDEX "page_views_userId_viewedAt_idx" ON "page_views"("userId", "viewedAt");

-- AddForeignKey
ALTER TABLE "book_pages" ADD CONSTRAINT "book_pages_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "books"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_toc_entries" ADD CONSTRAINT "book_toc_entries_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "books"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_conversion_jobs" ADD CONSTRAINT "book_conversion_jobs_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "books"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reading_sessions" ADD CONSTRAINT "reading_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reading_sessions" ADD CONSTRAINT "reading_sessions_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "books"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_views" ADD CONSTRAINT "page_views_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "reading_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_views" ADD CONSTRAINT "page_views_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "books"("id") ON DELETE CASCADE ON UPDATE CASCADE;
