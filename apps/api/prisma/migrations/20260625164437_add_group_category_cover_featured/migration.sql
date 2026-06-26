-- CreateEnum
CREATE TYPE "GroupCategory" AS ENUM ('BIBLICAL_STUDIES', 'MODERN_FICTION', 'HISTORICAL', 'PHILOSOPHY', 'YOUNG_ADULT');

-- AlterTable
ALTER TABLE "groups" ADD COLUMN     "category" "GroupCategory",
ADD COLUMN     "coverImageUrl" TEXT,
ADD COLUMN     "featured" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "groups_category_idx" ON "groups"("category");

-- CreateIndex
CREATE INDEX "groups_featured_idx" ON "groups"("featured");
