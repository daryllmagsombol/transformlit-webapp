-- Immutable, version-pinned book download metadata.
--
-- The existing `book_pages`/`book_toc_entries` tables remain the current-version
-- projection. These tables are append-only snapshots so a whole-book download
-- can stay pinned to a specific `contentVersion` across later publications.

-- CreateTable
CREATE TABLE "book_content_versions" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "contentVersion" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "author" TEXT,
    "description" TEXT,
    "format" "BookFormat",
    "pageCount" INTEGER NOT NULL,
    "eligible" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "book_content_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "book_content_version_pages" (
    "id" TEXT NOT NULL,
    "contentVersionId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "assetKey" TEXT NOT NULL,
    "textKey" TEXT,
    "hasTextLayer" BOOLEAN NOT NULL DEFAULT false,
    "mimeType" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "charCount" INTEGER,
    "frameByteLength" INTEGER,
    "frameSha256" TEXT,
    "textByteLength" INTEGER,
    "textSha256" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "book_content_version_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "book_content_version_toc_entries" (
    "id" TEXT NOT NULL,
    "contentVersionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "page" INTEGER NOT NULL,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "order" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "book_content_version_toc_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "book_content_versions_bookId_contentVersion_key" ON "book_content_versions"("bookId", "contentVersion");

-- CreateIndex
CREATE INDEX "book_content_versions_bookId_eligible_contentVersion_idx" ON "book_content_versions"("bookId", "eligible", "contentVersion" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "book_content_version_pages_contentVersionId_index_key" ON "book_content_version_pages"("contentVersionId", "index");

-- CreateIndex
CREATE INDEX "book_content_version_toc_entries_contentVersionId_order_idx" ON "book_content_version_toc_entries"("contentVersionId", "order");

-- AddForeignKey
ALTER TABLE "book_content_versions" ADD CONSTRAINT "book_content_versions_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "books"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_content_version_pages" ADD CONSTRAINT "book_content_version_pages_contentVersionId_fkey" FOREIGN KEY ("contentVersionId") REFERENCES "book_content_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_content_version_toc_entries" ADD CONSTRAINT "book_content_version_toc_entries_contentVersionId_fkey" FOREIGN KEY ("contentVersionId") REFERENCES "book_content_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: snapshot each existing READY book's current-version projection.
-- Legacy rows carry NULL checksums and `eligible = false`: the actual asset
-- bytes live in object storage, which SQL cannot hash. A version becomes
-- eligible only after BookDownloadService.backfillVersion verifies every
-- frame/text asset against these descriptors. We never fabricate a checksum or
-- an empty text layer here.
INSERT INTO "book_content_versions" (
    "id", "bookId", "contentVersion", "title", "author", "description",
    "format", "pageCount", "eligible", "verifiedAt", "publishedAt", "createdAt"
)
SELECT
    gen_random_uuid()::text,
    b."id",
    b."contentVersion",
    b."title",
    b."author",
    b."description",
    b."format",
    b."pageCount",
    false,
    NULL,
    COALESCE(b."publishedAt", b."createdAt", CURRENT_TIMESTAMP),
    CURRENT_TIMESTAMP
FROM "books" b
WHERE b."deletedAt" IS NULL
  AND b."conversionStatus" = 'READY'
  AND b."format" = 'PDF'
  AND b."pageCount" IS NOT NULL
  AND b."pageCount" > 0
  AND EXISTS (SELECT 1 FROM "book_pages" p WHERE p."bookId" = b."id");

-- Backfill page descriptors (checksums intentionally left NULL until verified).
INSERT INTO "book_content_version_pages" (
    "id", "contentVersionId", "index", "assetKey", "textKey", "hasTextLayer",
    "mimeType", "width", "height", "charCount", "createdAt"
)
SELECT
    gen_random_uuid()::text,
    cv."id",
    p."index",
    p."assetKey",
    p."textKey",
    (p."textKey" IS NOT NULL),
    p."mimeType",
    p."width",
    p."height",
    p."charCount",
    CURRENT_TIMESTAMP
FROM "book_pages" p
JOIN "book_content_versions" cv
  ON cv."bookId" = p."bookId"
 AND cv."contentVersion" = (SELECT "contentVersion" FROM "books" WHERE "id" = p."bookId");

-- Backfill TOC entries.
INSERT INTO "book_content_version_toc_entries" (
    "id", "contentVersionId", "title", "page", "depth", "order", "createdAt"
)
SELECT
    gen_random_uuid()::text,
    cv."id",
    t."title",
    t."page",
    t."depth",
    t."order",
    CURRENT_TIMESTAMP
FROM "book_toc_entries" t
JOIN "book_content_versions" cv
  ON cv."bookId" = t."bookId"
 AND cv."contentVersion" = (SELECT "contentVersion" FROM "books" WHERE "id" = t."bookId");
