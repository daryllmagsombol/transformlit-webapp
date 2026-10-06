# Reading Streaks & Yearly Goal Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded "Your Progress" sidebar widget with a real server-backed engagement streak and yearly goal, plus a `/progress` page with a heatmap calendar and goal editor.

**Architecture:** A new backend domain module `progress` (NestJS + Prisma) records activity events, rolls them up per UTC+8 day, and computes streaks. The client fires a fire-and-forget `recordActivity` mutation on qualifying actions (ebook page advance, Bible chapter open, feed load, group post). Reads go through `myProgress` / `myActivityCalendar`; the sidebar widget and a new `/progress` page consume them.

**Tech Stack:** NestJS 11 + Apollo GraphQL, Prisma 7 + PostgreSQL, Zod 4 (shared), Next.js 16 + React 19 + Apollo Client, Jest (API + web), Playwright (E2E).

**Spec:** `docs/superpowers/specs/2026-10-06-reading-streaks-goal-tracking-design.md`

## Global Constraints

- **Domain modules never import each other.** `ProgressModule` imports `AuthModule` only; `PrismaModule` is `@Global()` and is never imported (see `apps/api/src/feed/feed.module.ts`).
- **All activity call sites are client-fired.** No server-side `GroupsService` → `ProgressService` call.
- **UTC+8 fixed day boundary.** `dayKey` is server-computed only; client clocks are never trusted. Mirror `feed.service.ts:117-127` (`new Date(now.getTime() + 8 * 60 * 60 * 1000)`).
- **`dayKey` format is `YYYY-MM-DD`** (zero-padded, lexicographically sortable). Year scope is a string range, never Date math.
- **`pagesDelta` is clamped server-side to `[0, 1]`.** One normalized page per advance.
- **`currentStreak` is always recomputed** from `DailyActivity`; `longestStreak` is cache-guarded.
- **`activityCount` dedup is race-free** via the `DailyActivityType` unique constraint (P2002 = already counted).
- **`pagesRead` replay-safety** uses `ActivityEventReceipt` on `(userId, operationId)`.
- **Zod must not use deprecated APIs** (S6665–S6690): use `z.number().gte(1).lte(366)`, not `.min()` / `.max()`.
- **SonarQube:** no nested ternaries (S6644); heatmap React keys are `dayKey` (never array index); props `readonly`; cognitive complexity ≤ 15. Any review finding is appended to `docs/SONAR-GUIDELINES.md` in the same change.
- **Input types live in `models/*.model.ts`**, not a `dto/` directory (repo convention — there are no `dto/` dirs).
- **Package manager is pnpm.** API test: `pnpm --filter @transformlit/api test`. Web test: `pnpm --filter @transformlit/web test`.
- **Web jest enforces `coverageThreshold` (70% lines).** New client files (Task 8's recorder, Task 10's client component) must include tests that cover their branches, including the fire-and-forget rejection path, or the suite fails on coverage.
- **`apps/api/src/schema.gql` is a checked-in snapshot.** After adding GraphQL types, run `pnpm --filter @transformlit/api graphql:schema:export` before codegen (Task 7). Never hand-edit it.

## Review Focus

Inputs/conditions the spec implies but no single task naturally tests — each has a test pinned in the owning task:

1. **UTC+8 midnight/year boundary** — 2026-12-31 23:30 UTC is 2027-01-01 07:30 UTC+8 and must count toward **2027** (Task 1, Task 4).
2. **Stale streak after inactivity** — a user whose last activity was 5 days ago must read `currentStreak: 0`, not a stale cached value (Task 4, Task 6).
3. **Replay / duplicate** — the same `operationId` replayed, or the same `(day, type)` fired twice, must not double-count `pagesRead` or `activityCount` (Task 5, Task 6).
4. **`pagesDelta` inflation** — a client sending `pagesDelta: 999999` is clamped to 1 (Task 5).
5. **Brand-new user empty state** — no activity, no goal: `myProgress` returns zeros and `goal: null` without error (Task 5, Task 7).

---

### Task 1: UTC+8 day-key utility

**Files:**
- Create: `apps/api/src/progress/day-key.util.ts`
- Test: `apps/api/src/progress/day-key.util.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `toDayKey(date: Date): string` — `YYYY-MM-DD` in UTC+8.
  - `yearBounds(year: number): { startDayKey: string; endDayKey: string }` — `startDayKey = "${year}-01-01"`, `endDayKey = "${year + 1}-01-01"` (exclusive upper bound).

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/progress/day-key.util.spec.ts
import { toDayKey, yearBounds } from './day-key.util.js';

describe('toDayKey', () => {
  it('formats a UTC instant as its UTC+8 calendar day', () => {
    expect(toDayKey(new Date('2026-10-06T00:00:00Z'))).toBe('2026-10-06');
  });

  it('rolls to the next day after 16:00 UTC (UTC+8 midnight)', () => {
    expect(toDayKey(new Date('2026-10-06T16:00:00Z'))).toBe('2026-10-07');
  });

  it('maps Dec 31 23:30 UTC to Jan 1 of the next year', () => {
    expect(toDayKey(new Date('2026-12-31T23:30:00Z'))).toBe('2027-01-01');
  });
});

describe('yearBounds', () => {
  it('returns lexicographic dayKey bounds for the year', () => {
    expect(yearBounds(2026)).toEqual({ startDayKey: '2026-01-01', endDayKey: '2027-01-01' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @transformlit/api test -- day-key.util.spec.ts`
Expected: FAIL — cannot find module `./day-key.util.js`.

- [ ] **Step 3: Implement `day-key.util.ts`**

Mirror `feed.service.ts:117-127`: shift by `+8h`, read the UTC calendar fields, zero-pad to `YYYY-MM-DD`.

```ts
export function toDayKey(date: Date): string {
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function yearBounds(year: number): { startDayKey: string; endDayKey: string } {
  return { startDayKey: `${year}-01-01`, endDayKey: `${year + 1}-01-01` };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @transformlit/api test -- day-key.util.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/progress/day-key.util.ts apps/api/src/progress/day-key.util.spec.ts
git commit -m "feat(progress): add UTC+8 day-key utility"
```

---

### Task 2: Shared enums and Zod schemas

**Files:**
- Modify: `packages/shared/src/enums.ts`
- Modify: `packages/shared/src/schemas/index.ts`
- Test: `packages/shared/src/__tests__/schemas.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - Enums `ActivityType` (`BOOK_READ | BIBLE_READ | FEED_READ | GROUP_POST`) and `GoalKind` (`DAYS | PAGES`).
  - `recordActivitySchema` → `{ type: ActivityType; pagesDelta?: number; operationId?: string }`.
  - `setReadingGoalSchema` → `{ year: number; targetKind: GoalKind; targetValue: number }`.
  - Types `RecordActivityInput`, `SetReadingGoalInput`.

- [ ] **Step 1: Write the failing test**

Append to `packages/shared/src/__tests__/schemas.spec.ts`:

```ts
import { recordActivitySchema, setReadingGoalSchema } from '../schemas/index';

describe('recordActivitySchema', () => {
  it('accepts a minimal valid payload', () => {
    expect(recordActivitySchema.parse({ type: 'BOOK_READ' })).toEqual({
      type: 'BOOK_READ',
      pagesDelta: 0,
    });
  });

  it('rejects an unknown activity type', () => {
    expect(() => recordActivitySchema.parse({ type: 'NOPE' })).toThrow();
  });
});

describe('setReadingGoalSchema', () => {
  it('accepts a valid DAYS goal', () => {
    expect(setReadingGoalSchema.parse({ year: 2026, targetKind: 'DAYS', targetValue: 24 })).toEqual({
      year: 2026,
      targetKind: 'DAYS',
      targetValue: 24,
    });
  });

  it('rejects a DAYS goal above 366', () => {
    expect(() =>
      setReadingGoalSchema.parse({ year: 2026, targetKind: 'DAYS', targetValue: 400 }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @transformlit/shared test -- schemas.spec.ts`
Expected: FAIL — `recordActivitySchema` is not exported.

- [ ] **Step 3: Add enums and schemas**

Append to `packages/shared/src/enums.ts`:

```ts
export enum ActivityType {
  BOOK_READ = 'BOOK_READ',
  BIBLE_READ = 'BIBLE_READ',
  FEED_READ = 'FEED_READ',
  GROUP_POST = 'GROUP_POST',
}

export enum GoalKind {
  DAYS = 'DAYS',
  PAGES = 'PAGES',
}
```

Append a `// ── Progress ──` section to `packages/shared/src/schemas/index.ts` (use `.gte`/`.lte`, not `.min`/`.max` — S6665–S6690):

```ts
const UUID_PATTERN = String.raw`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`;

export const recordActivitySchema = z.object({
  type: z.enum(['BOOK_READ', 'BIBLE_READ', 'FEED_READ', 'GROUP_POST']),
  pagesDelta: z.number().int().gte(0).lte(1).default(0),
  operationId: z.string().regex(UUID_PATTERN, 'operationId must be a UUID').optional(),
});

export const setReadingGoalSchema = z
  .object({
    year: z.number().int().gte(2000).lte(2100),
    targetKind: z.enum(['DAYS', 'PAGES']),
    targetValue: z.number().int().gte(1).lte(100000),
  })
  .refine((v) => v.targetKind !== 'DAYS' || v.targetValue <= 366, {
    message: 'A DAYS goal cannot exceed 366',
    path: ['targetValue'],
  });

export type RecordActivityInput = z.infer<typeof recordActivitySchema>;
export type SetReadingGoalInput = z.infer<typeof setReadingGoalSchema>;
```

**Barrel export:** add these two types to `packages/shared/src/index.ts` (it re-exports each symbol from the source modules) so `@transformlit/shared` exposes them. Match the existing `.js`-suffixed import style used by the barrel.

**Do not** copy the deprecated Zod APIs already present in this file (`z.email()`, `z.url()`, `z.uuid()`, `.min()`/`.max()`) — those are pre-existing S6665–S6690 debt. The new schemas use `.gte()`/`.lte()`/regex.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @transformlit/shared test -- schemas.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/enums.ts packages/shared/src/schemas/index.ts packages/shared/src/__tests__/schemas.spec.ts
git commit -m "feat(shared): add ActivityType/GoalKind enums and progress schemas"
```

---

### Task 3: Prisma schema and migration

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Test: migration applies cleanly (schema-level; behavior tested in Tasks 4–6).

**Interfaces:**
- Consumes: `ActivityType`, `GoalKind` names from Task 2 (Prisma enums are generated independently; keep the names identical).
- Produces: Prisma models `ActivityEvent`, `ActivityEventReceipt`, `DailyActivityType`, `DailyActivity`, `ReadingGoal`, `UserStreak`; `User` back-relations.

- [ ] **Step 1: Add the enums and models**

Append to `apps/api/prisma/schema.prisma` exactly as specified in the spec's "Data Model (Prisma additions)" section — `ActivityType`, `GoalKind`, `ActivityEvent` (`@@index([userId, dayKey, type])`), `ActivityEventReceipt` (`@@unique([userId, operationId])`), `DailyActivityType` (`@@unique([userId, dayKey, type])`), `DailyActivity` (`@@unique([userId, dayKey])`), `ReadingGoal` (`@@unique([userId, year])`), `UserStreak` (`@id userId`).

- [ ] **Step 2: Add `User` back-relations**

In the existing `model User`, add:

```prisma
  activityEvents        ActivityEvent[]
  activityEventReceipts ActivityEventReceipt[]
  dailyActivityTypes    DailyActivityType[]
  dailyActivity         DailyActivity[]
  readingGoals          ReadingGoal[]
  streak                UserStreak?
```

- [ ] **Step 2.5: Check migration status before creating**

Run: `pnpm --filter @transformlit/api exec prisma migrate status`
Expected: no unapplied migrations. If any are pending, resolve them first — `migrate dev` prompts interactively (which fails in non-interactive execution) when drift or pending state exists.

- [ ] **Step 3: Create and apply the migration**

Run: `pnpm --filter @transformlit/api exec prisma migrate dev --name progress_activity`
Expected: migration created and applied; client regenerated with the new models.

- [ ] **Step 4: Verify the client generated**

Run: `pnpm --filter @transformlit/api exec prisma generate`
Expected: "Generated Prisma Client". (`prisma.activityEvent`, `prisma.dailyActivity`, `prisma.userStreak`, etc. now exist.)

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @transformlit/api typecheck`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat(progress): add activity, rollup, goal, and streak models"
```

---

### Task 4: StreakService

**Files:**
- Create: `apps/api/src/progress/streak.service.ts`
- Test: `apps/api/src/progress/streak.service.spec.ts`

**Interfaces:**
- Consumes: `PrismaService` (`../prisma/prisma.service.js`), `toDayKey` (Task 1).
- Produces:
  - `currentStreakFromDays(days: string[], todayDayKey: string): number` — pure.
  - `longestStreakFromDays(days: string[]): number` — pure.
  - `StreakService.computeCurrent(userId: string, todayDayKey: string): Promise<number>`
  - `StreakService.computeLongest(userId: string): Promise<number>`
  - `StreakService.refreshCache(userId: string, todayDayKey: string): Promise<void>`

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/progress/streak.service.spec.ts
import { currentStreakFromDays, longestStreakFromDays } from './streak.service.js';

describe('currentStreakFromDays', () => {
  it('counts consecutive days ending today', () => {
    expect(currentStreakFromDays(['2026-10-04', '2026-10-05', '2026-10-06'], '2026-10-06')).toBe(3);
  });

  it('tolerates a not-yet-read today by walking back from yesterday', () => {
    expect(currentStreakFromDays(['2026-10-04', '2026-10-05'], '2026-10-06')).toBe(2);
  });

  it('returns 0 when the last activity is older than yesterday', () => {
    expect(currentStreakFromDays(['2026-10-01'], '2026-10-06')).toBe(0);
  });

  it('returns 0 for an empty ledger', () => {
    expect(currentStreakFromDays([], '2026-10-06')).toBe(0);
  });

  it('breaks on a gap', () => {
    expect(currentStreakFromDays(['2026-10-01', '2026-10-05', '2026-10-06'], '2026-10-06')).toBe(2);
  });
});

describe('longestStreakFromDays', () => {
  it('finds the longest historical run', () => {
    expect(longestStreakFromDays(['2026-01-01', '2026-01-02', '2026-01-03', '2026-03-01'])).toBe(3);
  });

  it('returns 0 for an empty ledger', () => {
    expect(longestStreakFromDays([])).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @transformlit/api test -- streak.service.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `streak.service.ts`**

`currentStreakFromDays` / `longestStreakFromDays` operate on a **sorted unique** `dayKey` list. Walk back from `todayDayKey`; if absent, start from the day before; count consecutive prior days. `StreakService` methods read `DailyActivity` dayKeys and upsert `UserStreak`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @transformlit/api test -- streak.service.spec.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/progress/streak.service.ts apps/api/src/progress/streak.service.spec.ts
git commit -m "feat(progress): add streak computation service"
```

---

### Task 5: ProgressService

**Files:**
- Create: `apps/api/src/progress/progress.service.ts`
- Test: `apps/api/src/progress/progress.service.spec.ts`

**Interfaces:**
- Consumes: `PrismaService`, `StreakService` (Task 4), `toDayKey`/`yearBounds` (Task 1). The service methods accept a **plain struct** — `{ type: ActivityType; pagesDelta: number; operationId?: string }` and `{ year: number; targetKind: GoalKind; targetValue: number }` — **not** the shared `RecordActivityInput`/`SetReadingGoalInput` Zod-inferred types. This mirrors the repo convention: the API never imports shared `*Input` types; the resolver maps its `@InputType` class fields into the service call (`books.resolver.ts:75` → `books.service.ts`). `ActivityType` and `GoalKind` are imported from `@transformlit/shared` (the established enum-import pattern).
- Produces:
  - `recordActivity(userId: string, input: { type: ActivityType; pagesDelta: number; operationId?: string }): Promise<{ dayKey: string; counted: boolean }>`
  - `getMyProgress(userId: string, year: number): Promise<MyProgressShape>`
  - `getActivityCalendar(userId: string, year: number): Promise<DailyActivityPointShape[]>`
  - `setReadingGoal(userId: string, input: { year: number; targetKind: GoalKind; targetValue: number }): Promise<ReadingGoalShape>`

Where `MyProgressShape = { year: number; goal: { year: number; targetKind: 'DAYS'|'PAGES'; targetValue: number } | null; daysRead: number; pagesRead: number; currentStreak: number; longestStreak: number; lastActiveDayKey: string | null }`.

- [ ] **Step 1: Write the failing test**

Mock `PrismaService` as a jest object (mirror `apps/api/src/notifications/notifications.service.spec.ts`). Cover: clamp of `pagesDelta`; `counted: false` on a `DailyActivityType` P2002; `longestStreak` served from cache; brand-new user returns zeros + `goal: null`.

```ts
// apps/api/src/progress/progress.service.spec.ts  (sketch — expand in-file)
it('clamps pagesDelta to at most 1', async () => {
  await service.recordActivity('u1', { type: 'BOOK_READ', pagesDelta: 999999 });
  const upsert = prisma.dailyActivity.upsert.mock.calls[0][0];
  expect(upsert.update.pagesRead.increment).toBe(1);
});

it('returns counted:false when the type was already counted today', async () => {
  prisma.dailyActivityType.create.mockRejectedValueOnce({ code: 'P2002' });
  await expect(service.recordActivity('u1', { type: 'FEED_READ' })).resolves.toEqual({
    dayKey: expect.any(String),
    counted: false,
  });
});

it('returns zeros and a null goal for a brand-new user', async () => {
  prisma.dailyActivity.findMany.mockResolvedValue([]);
  prisma.userStreak.findUnique.mockResolvedValue(null);
  prisma.readingGoal.findUnique.mockResolvedValue(null);
  await expect(service.getMyProgress('new', 2026)).resolves.toMatchObject({
    daysRead: 0, pagesRead: 0, currentStreak: 0, longestStreak: 0, goal: null,
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @transformlit/api test -- progress.service.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `progress.service.ts`**

`recordActivity` in a `prisma.$transaction`: insert `ActivityEvent`; if `operationId` present, insert `ActivityEventReceipt` and treat P2002 as a replay (skip `pagesRead` increment); attempt `DailyActivityType.create` (P2002 → `counted: false`); upsert `DailyActivity` (`pagesRead.increment` = clamped delta, `activityCount.increment` = 1 only when the type insert succeeded); call `streaks.refreshCache`.
`getMyProgress` uses `yearBounds` string range, always calls `streaks.computeCurrent`, and serves `longestStreak` from `UserStreak` unless stale.
Inject deps: `constructor(private readonly prisma: PrismaService, private readonly streaks: StreakService) {}`.
**Transaction boundary:** `refreshCache` must accept the caller's transaction client (`tx: Prisma.TransactionClient`) and use it for all reads/writes — Prisma does not support nested `$transaction`, so it must NOT open its own (mirror `ReaderMutationsService.execute` passing `tx`, `reader-mutations.service.ts:259`).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @transformlit/api test -- progress.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/progress/progress.service.ts apps/api/src/progress/progress.service.spec.ts
git commit -m "feat(progress): add progress service with race-free rollup"
```

---

### Task 6: GraphQL models, inputs, resolver, module

**Files:**
- Create: `apps/api/src/progress/models/progress.model.ts`
- Create: `apps/api/src/progress/progress.resolver.ts`
- Create: `apps/api/src/progress/progress.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/src/progress/progress.resolver.spec.ts`

**Interfaces:**
- Consumes: `ProgressService` (Task 5), `JwtAuthGuard` (`../auth/guards/jwt-auth.guard.js`), `CurrentUser` (`../common/decorators/current-user.decorator.js`), `ActivityType`/`GoalKind` (Task 2).
- Produces: object types `MyProgress`, `ReadingGoal`, `DailyActivityPoint`; input types `RecordActivityInput`, `SetReadingGoalInput`; payload `RecordActivityPayload`; resolver queries `myProgress`, `myActivityCalendar`; mutations `recordActivity`, `setReadingGoal`.

- [ ] **Step 1: Write the failing test**

Mirror `apps/api/src/notifications/notifications.resolver.spec.ts`: build a testing module with a mocked `ProgressService`, assert each operation delegates with `user.id`.

```ts
it('delegates recordActivity with the current user id', async () => {
  await resolver.recordActivity({ id: 'u1' }, { type: 'BOOK_READ', pagesDelta: 1 });
  expect(progressService.recordActivity).toHaveBeenCalledWith('u1', { type: 'BOOK_READ', pagesDelta: 1 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @transformlit/api test -- progress.resolver.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement models, resolver, module; register in `app.module.ts`**

- `models/progress.model.ts`: `registerEnumType(ActivityType, { name: 'ActivityType' })` and `registerEnumType(GoalKind, { name: 'GoalKind' })`; `@ObjectType()` classes and `@InputType()` classes exactly matching the spec's GraphQL block.
- `progress.resolver.ts`: `@Resolver()` with `@UseGuards(JwtAuthGuard)` on every operation, `@Args` for `year`/`input`, `@CurrentUser() user: { id: string }`.
- `progress.module.ts`: `imports: [AuthModule]`, `providers: [ProgressService, StreakService, ProgressResolver]`, `exports: [ProgressService]`.
- `app.module.ts`: add `ProgressModule` to `imports` alongside the other domain modules.

- [ ] **Step 4: Run test + typecheck**

Run: `pnpm --filter @transformlit/api test -- progress.resolver.spec.ts`
Run: `pnpm --filter @transformlit/api typecheck`
Expected: PASS; 0 type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/progress apps/api/src/app.module.ts
git commit -m "feat(progress): expose progress GraphQL API and module"
```

---

### Task 7: Web GraphQL operations and codegen

**Files:**
- Create: `packages/graphql/operations/progress.graphql`
- Modify: generated types under `packages/graphql` (via codegen)
- Test: `pnpm graphql:codegen` succeeds.

**Interfaces:**
- Consumes: the Task 6 schema.
- Produces: operations `MyProgress`, `MyActivityCalendar`, `RecordActivity`, `SetReadingGoal`.

- [ ] **Step 1: Add operations**

```graphql
query MyProgress($year: Int!) {
  myProgress(year: $year) {
    year
    goal { year targetKind targetValue }
    daysRead
    pagesRead
    currentStreak
    longestStreak
    lastActiveDayKey
  }
}

query MyActivityCalendar($year: Int!) {
  myActivityCalendar(year: $year) { dayKey activityCount pagesRead }
}

mutation RecordActivity($input: RecordActivityInput!) {
  recordActivity(input: $input) { dayKey counted }
}

mutation SetReadingGoal($input: SetReadingGoalInput!) {
  setReadingGoal(input: $input) { year targetKind targetValue }
}
```

- [ ] **Step 2: Regenerate the canonical schema snapshot, then run codegen**

Task 6 added new resolver/object types to the NestJS app. Codegen does **not** read the live app — it reads the checked-in snapshot `apps/api/src/schema.gql` (`codegen.ts`), which `nest build` does not update. Regenerate it first or codegen silently produces no progress hooks.

Run: `pnpm --filter @transformlit/api graphql:schema:export`
Expected: "Exported canonical GraphQL SDL to .../src/schema.gql".

Then:

Run: `pnpm graphql:codegen`
Expected: success; generated hooks/types include the four operations.

- [ ] **Step 3: Commit**

```bash
git add packages/graphql
git commit -m "feat(graphql): add progress operations"
```

---

### Task 8: Web activity-recording helper

**Files:**
- Create: `apps/web/src/lib/progress/record-activity.ts`
- Test: `apps/web/src/lib/progress/record-activity.spec.ts`

**Interfaces:**
- Consumes: the `RecordActivity` operation (Task 7).
- Produces: `recordActivity(input: { type: ActivityType; pagesDelta?: number; operationId?: string }): void` — fire-and-forget; never throws; generates an `operationId` per call.

- [ ] **Step 1: Write the failing test**

```ts
it('never throws when the mutation rejects', async () => {
  const client = { mutate: jest.fn().mockRejectedValue(new Error('offline')) };
  expect(() => recordActivityWith(client, { type: 'FEED_READ' })).not.toThrow();
});

it('swallows the rejection (no unhandled promise)', async () => {
  const client = { mutate: jest.fn().mockRejectedValue(new Error('offline')) };
  recordActivityWith(client, { type: 'FEED_READ' });
  await Promise.resolve();
  // no assertion needed — the test fails if the rejection escapes
});
```

(Export a testable `recordActivityWith(client, input)` and a thin `recordActivity(input)` that uses the app's Apollo client.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @transformlit/web test -- record-activity.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `record-activity.ts`**

Use `crypto.randomUUID()` for `operationId`; call `client.mutate` and `.catch(() => {})`. No `window` reference (S6653).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @transformlit/web test -- record-activity.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/progress
git commit -m "feat(web): add fire-and-forget activity recorder"
```

---

### Task 9: Wire the sidebar widget (UI — owner: @designer)

**Files:**
- Modify: `apps/web/src/components/layout/sidebar.tsx:63-87`
- Test: `apps/web/src/components/layout/sidebar.spec.tsx`

**Interfaces:**
- Consumes: `MyProgress` query (Task 7), `recordActivity` (Task 8).
- Produces: real `{value}/{target}` numerator/denominator, computed bar width, streak chip, empty state, and a "Track Progress" link to `/progress`.

> UI work routes to `@designer`. Preserve the existing card structure, MD3 tokens, and mobile behavior; do not restructure the shell.
>
> **Ownership split:** the engineer writes and runs the failing tests (Steps 1–2 and 4); `@designer` implements Step 3 only.

- [ ] **Step 1: Write failing tests**

Extend `sidebar.spec.tsx`: renders `N/24` from mocked `MyProgress`; renders a "Set a yearly goal" CTA when `goal` is null; renders the streak chip; bar width matches the ratio.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @transformlit/web test -- sidebar.spec.tsx`
Expected: FAIL — widget still shows the hardcoded `12/24`.

- [ ] **Step 3: Implement the wiring**

Replace the literals at `sidebar.tsx:71-77` with `MyProgress` data via the generated query hook. Extract the numerator selection (`daysRead` vs `pagesRead` by `goal.targetKind`) into a helper — **no nested ternary** (S6644). Compute width as `Math.min(100, Math.round((value / target) * 100))`. Add the streak chip and empty state.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @transformlit/web test -- sidebar.spec.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/layout/sidebar.tsx apps/web/src/components/layout/sidebar.spec.tsx
git commit -m "feat(web): wire sidebar progress widget to real data"
```

---

### Task 10: Build the `/progress` page (UI — owner: @designer)

**Files:**
- Create: `apps/web/src/app/(app)/progress/page.tsx`
- Create: `apps/web/src/app/(app)/progress/progress-client.tsx`
- Test: `apps/web/src/app/(app)/progress/progress-client.spec.tsx`

**Interfaces:**
- Consumes: `MyProgress`, `MyActivityCalendar`, `SetReadingGoal` (Task 7); `recordActivity` (Task 8).
- Produces: streak header, heatmap calendar (cells keyed by `dayKey`), goal editor, year switcher.

> UI work routes to `@designer`. Reuse `AuthenticatedLayout`/`AppShell`, `NavItem`, MD3 tokens, and `material-symbols-outlined`.
>
> **Ownership split:** the engineer writes and runs the failing tests (Steps 1–2 and 4); `@designer` implements Step 3 only.

- [ ] **Step 1: Write failing tests**

`progress-client.spec.tsx`: renders streak header from mocked data; renders one cell per calendar point with `activityCount` intensity; goal editor rejects an out-of-range DAYS value; year switcher re-queries.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @transformlit/web test -- progress-client.spec.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the page and client**

Heatmap cells keyed by `dayKey` (S6479 — never array index); horizontally scrollable via existing `.no-scrollbar`; empty/error state degrades gracefully. Goal editor calls `setReadingGoal`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @transformlit/web test -- progress-client.spec.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/\(app\)/progress
git commit -m "feat(web): add progress page with heatmap and goal editor"
```

---

### Task 11: Wire activity call sites

**Files:**
- Modify: ebook reader page advance (the `reader-mutations` call site in `apps/web`)
- Modify: `apps/web/src/app/(app)/bible/[translation]/[book]/[chapter]/bible-reader-client.tsx`
- Modify: `apps/web/src/app/(app)/feed/feed-client.tsx`
- Modify: the group-post submit path in `apps/web/src/app/(app)/groups/[slug]/**`
- Test: extend the owning component tests

**Interfaces:**
- Consumes: `recordActivity` (Task 8).
- Produces: `BOOK_READ` (page advance, `pagesDelta: 1`), `BIBLE_READ` (chapter open, `pagesDelta: 1`), `FEED_READ` (feed load, `pagesDelta: 0`, skipped if already fired today), `GROUP_POST` (after successful post create, `pagesDelta: 0`).

- [ ] **Step 1: Write failing tests**

In each owning component spec, assert `recordActivity` is called with the expected `type` on the trigger, and that a rejected call does not surface an error.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @transformlit/web test -- bible-reader-client.spec.tsx`
Expected: FAIL — `recordActivity` not called.

- [ ] **Step 3: Add the calls**

Fire-and-forget at each trigger. Debounce `BOOK_READ` client-side (coalesce to one ping per session or per N page advances) to bound write volume — store the counter in a module-level `let` (resets on reload, acceptable for v1) unless persistence across navigation is required, in which case use Zustand. Skip `FEED_READ` if it already fired today (client-side guard).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @transformlit/web test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): record activity from reader, bible, feed, and group post"
```

---

### Task 12: End-to-end and integration verification

**Files:**
- Test: `apps/api/test/` integration spec for the progress loop
- Test: Playwright E2E for `/progress` + widget

**Interfaces:**
- Consumes: all prior tasks.
- Produces: verified end-to-end behavior.

- [ ] **Step 1: API integration test**

Add a `*.integration.spec.ts` under `apps/api/test/` (that config has `rootDir: 'test'`). Integration tests require a **live Postgres via testcontainers** — mirror the existing `apps/api/test/graphql-schema.ts` pattern: `startOwnedDisposableDatabase()`, set `process.env.DATABASE_URL` to the container URI, `applyMigrations()`, then build the testing module with `AppModule`. A 60s `testTimeout` is already configured. Cover: record activity → `DailyActivity` reflects it → `myProgress` returns the day/pages/streak; a duplicated `operationId` does not inflate `pagesRead`; a second same-day same-type event returns `counted: false`.

- [ ] **Step 1.5: Ensure Docker is running**

Run: `docker info >/dev/null 2>&1 && echo "docker ok"`
Expected: `docker ok`. testcontainers cannot start Postgres otherwise.

- [ ] **Step 2: Run integration test**

Run: `pnpm --filter @transformlit/api test:integration`
Expected: PASS.

- [ ] **Step 3: Playwright E2E**

Add an E2E spec: open `/progress`, set a goal, confirm the widget updates; verify the heatmap renders today.

- [ ] **Step 4: Run E2E**

Run: `pnpm --filter @transformlit/web test:e2e`
Expected: PASS (document any pre-existing unrelated failures separately).

- [ ] **Step 5: Full typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/test apps/web/e2e
git commit -m "test: verify progress streak and goal end-to-end"
```

---

## Self-Review Notes

- **Spec coverage:** Data model (Task 3), GraphQL API (Task 6), streak math (Task 4), rollup + replay safety (Task 5), day-key/year bounds (Task 1), schemas (Task 2), widget (Task 9), `/progress` page (Task 10), call sites (Task 11), testing plan (Tasks 1–12).
- **Deliberate deviation:** the spec proposed `dto/record-activity.input.ts` etc.; the repo has **no `dto/` directories** — inputs live in `models/*.model.ts`. Task 6 follows the actual convention.
- **Deferred item made concrete:** `ActivityEvent` pruning is noted in the spec as a follow-up; the plan does not implement it in v1 but Task 3's schema makes it feasible.
