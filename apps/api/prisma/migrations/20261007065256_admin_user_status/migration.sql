-- Preflight (run before this migration, e.g. on the target database):
--   SELECT lower(status), count(*) FROM users GROUP BY 1;
-- On the disposable authoring database (freshly migrated from the full
-- migration history, no seeded users) this returned no rows:
--   lower | count
--   ------+-------
--   (0 rows)
-- Both 'active' and 'ACTIVE' are observed in repo fixtures/tests, so the
-- cast below is case-tolerant: any casing of 'active' maps to ACTIVE and
-- every other/unknown value maps to SUSPENDED.
-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "users" ALTER COLUMN "status" TYPE "UserStatus"
  USING (CASE WHEN lower("status") = 'active' THEN 'ACTIVE'::"UserStatus"
              ELSE 'SUSPENDED'::"UserStatus" END);
ALTER TABLE "users" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

-- CreateIndex
CREATE INDEX "audit_logs_targetType_targetId_idx" ON "audit_logs"("targetType", "targetId");
