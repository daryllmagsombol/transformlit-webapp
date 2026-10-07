-- Enforce at most one ACTIVE reading plan per group at the database boundary.
-- The service's archive-then-create transaction runs at READ COMMITTED, so two
-- concurrent creates for a group with no active plan could both succeed; this
-- partial unique index makes the loser fail with P2002, which `create()` maps to
-- a ConflictException.
CREATE UNIQUE INDEX "group_reading_plans_one_active_per_group"
  ON "group_reading_plans" ("groupId")
  WHERE "status" = 'ACTIVE';
