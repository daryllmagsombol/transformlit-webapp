-- CreateEnum
CREATE TYPE "AnnouncementCategory" AS ENUM ('EVENT', 'UPDATE', 'GENERAL');

-- AlterTable
ALTER TABLE "announcements" ADD COLUMN     "category" "AnnouncementCategory" NOT NULL DEFAULT 'GENERAL';
