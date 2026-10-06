# Reading Streaks & Yearly Goal Tracking — Design Spec

**Date:** 2026-10-06
**Status:** Approved (design) — pending written-spec review
**Branch:** `feature/reading-streaks-goal-tracking`
**Scope:** Turn the hardcoded "Your Progress" sidebar widget into a real, server-backed engagement streak and yearly goal, and add a dedicated `/progress` page with a heatmap calendar and goal editor.

---

## Overview

The authenticated shell currently renders a static "Your Progress" card in the sidebar (`apps/web/src/components/layout/sidebar.tsx:63-87`) showing a hardcoded `12/24`, a 50% bar, and a dead **Track Progress** button. Nothing behind it is real.

This feature makes it real:

1. Record user activity server-side as **activity events**.
2. Roll those events up per day into a **daily activity** ledger.
3. Compute a **current / longest streak** from that ledger.
4. Let users set a **yearly goal** (days read or pages read).
5. Wire the existing sidebar widget to real data.
6. Add a `/progress` page with a year heatmap, streak header, and goal editor.

### Non-goals (explicitly deferred)

- Streak freeze / streak repair.
- Reminder notifications or email digests.
- Social/leaderboard comparison of streaks.
- Pruning old `ActivityEvent` rows (noted as a follow-up; the rollup makes it safe later).
- Server-side Bible telemetry beyond a client-fired activity ping. The Bible reader stays offline-first and local.

## Key Terminology

- **Activity** — a qualifying engagement event (one of `BOOK_READ`, `BIBLE_READ`, `FEED_READ`, `GROUP_POST`). This feature measures *engagement*, not strictly *reading*.
- **Qualifying day** — any `dayKey` on which at least one activity was recorded.
- **`dayKey`** — a calendar day string (`YYYY-MM-DD`) computed **server-side** in **UTC+8** (the app already uses UTC+8 for the feed's verse-of-the-day cache; see `README.md` and `docs/MEMORY.md`).
- **Streak** — number of consecutive qualifying days ending today or yesterday.

## Design Decisions

- **"Activity", not "reading."** The streak measures engagement across books, Bible, feed, and groups. This keeps the promise honest; see Non-goals for the reversal cost.
- **Local-first, server-synced writes.** The client fires a `recordActivity` mutation on qualifying actions; the server owns `dayKey` computation and dedup. Client clocks are never trusted.
- **UTC+8 fixed day boundary.** Deterministic and matches the existing feed cache timezone. Per-user timezones are deferred (they require storing a user timezone and complicate the boundary).
- **Any activity qualifies a day.** One page, one chapter, one feed visit, or one group post marks the day. No minimum threshold.
- **Event + rollup.** `ActivityEvent` is the append-only truth; `DailyActivity` is a per-day rollup so reads are O(days), not O(events). Reads (`myProgress`, `myActivityCalendar`) never scan raw events.
- **`UserStreak` is a cache, not a source of truth.** It is fully rebuildable from `DailyActivity` and safe to drop.
- **Idempotent recording.** `recordActivity` dedups per `(userId, dayKey, type)` for `activityCount` (streak qualification) via a unique-constraint insert. `pagesRead` accumulation is **not** idempotent by type alone: a retried/offline-flushed `BOOK_READ` with `pagesDelta: 1` would inflate `pagesRead`. To make it replay-safe, `RecordActivityInput` carries an optional client-generated `operationId` (UUID); a repeated `(userId, operationId)` is stored as a replay receipt and its `pagesDelta` is **not** added again (mirroring `ReaderOperationReceipt`, `schema.prisma:538`). Without `operationId`, `pagesRead` is best-effort and may over-count under replay.
- **Normalized page unit.** Ebook page advance = 1 page; Bible chapter = 1 page; feed and group post = 0 pages (streak only). This keeps a single comparable `pagesRead` number across activity types.
- **Feed auto-fires on load.** Visiting the feed marks the day. The server dedups, so over-firing is harmless. Accepted trade-off: streaks are easy to keep alive; revisit if streaks should require deliberate reading.
- **Fire-and-forget, fail-open.** A failed or offline `recordActivity` never blocks reading UI.
- **Module boundary respected.** New backend domain module `progress`, importing only `AuthModule` (`PrismaModule` is `@Global()`, so it is available without import — this matches `feed.module.ts`; the `ARCHITECTURE.md:67` note about importing Prisma is stale). No cross-domain imports; all four activity call sites are **client-fired** mutations (the client fires `recordActivity` after the owning mutation succeeds). The server-side `GroupsService` does not call `ProgressService`.

## Data Model (Prisma additions)

Follows existing conventions: `@@map` snake_case table names, uuid ids, `onDelete: Cascade` for user-owned rows.

```prisma
enum ActivityType {
  BOOK_READ
  BIBLE_READ
  FEED_READ
  GROUP_POST
}

enum GoalKind {
  DAYS
  PAGES
}

/// Append-only activity log. Source of truth.
model ActivityEvent {
  id         String       @id @default(uuid())
  userId     String
  user       User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  type       ActivityType
  /// Calendar day in UTC+8, server-computed. Never client-supplied.
  dayKey     String
  /// Normalized pages contributed (0 for feed/group). Clamped server-side to [0, 1].
  pagesDelta Int          @default(0)
  createdAt  DateTime     @default(now())

  @@index([userId, dayKey, type])
  @@map("activity_events")
}

/// Replay-dedup receipt for operationId-carrying events. Insert failure (P2002)
/// means this operation was already applied; its pagesDelta is not added again.
model ActivityEventReceipt {
  id          String   @id @default(uuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  operationId String
  createdAt   DateTime @default(now())

  @@unique([userId, operationId])
  @@map("activity_event_receipts")
}

/// Dedup gate: one row per (user, day, type). Insert failure (P2002) = type already counted.
model DailyActivityType {
  id        String       @id @default(uuid())
  userId    String
  user      User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  dayKey    String
  type      ActivityType
  createdAt DateTime     @default(now())

  @@unique([userId, dayKey, type])
  @@map("daily_activity_types")
}

/// Per-day rollup. Read path for streak + heatmap; rebuildable from ActivityEvent.
model DailyActivity {
  id            String   @id @default(uuid())
  userId        String
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  dayKey        String
  /// Distinct activity types touched that day (0..4). Heatmap intensity metric.
  activityCount Int      @default(0)
  /// Sum of pagesDelta for the day.
  pagesRead     Int      @default(0)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@unique([userId, dayKey])
  @@map("daily_activity")
}

model ReadingGoal {
  id          String   @id @default(uuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  year        Int
  targetKind  GoalKind @default(DAYS)
  targetValue Int
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@unique([userId, year])
  @@map("reading_goals")
}

/// Streak cache. Rebuildable from DailyActivity; safe to drop.
model UserStreak {
  userId          String   @id
  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  currentStreak   Int      @default(0)
  longestStreak   Int      @default(0)
  lastActiveDayKey String?
  updatedAt       DateTime @updatedAt

  @@map("user_streaks")
}
```

`User` gains back-relations for `activityEvents`, `activityEventReceipts`, `dailyActivityTypes`, `dailyActivity`, `readingGoals`, and `streak`.

## GraphQL API

All operations are JWT-guarded and operate on `@CurrentUser()` only. No user id is accepted as input for read operations.

### Types

```graphql
enum ActivityType { BOOK_READ BIBLE_READ FEED_READ GROUP_POST }
enum GoalKind { DAYS PAGES }

type ReadingGoal { year: Int!, targetKind: GoalKind!, targetValue: Int! }

type MyProgress {
  year: Int!
  goal: ReadingGoal
  daysRead: Int!          # qualifying days this year
  pagesRead: Int!         # summed normalized pages this year
  currentStreak: Int!
  longestStreak: Int!
  lastActiveDayKey: String
}

type DailyActivityPoint {
  dayKey: String!
  activityCount: Int!
  pagesRead: Int!
}
```

### Operations

```graphql
type Query {
  myProgress(year: Int!): MyProgress!
  myActivityCalendar(year: Int!): [DailyActivityPoint!]!
}

type Mutation {
  recordActivity(input: RecordActivityInput!): RecordActivityPayload!
  setReadingGoal(input: SetReadingGoalInput!): ReadingGoal!
}

input RecordActivityInput {
  type: ActivityType!
  pagesDelta: Int = 0
  operationId: String   # UUID; makes pagesDelta accumulation replay-safe
}

type RecordActivityPayload {
  dayKey: String!
  counted: Boolean!        # false if this type was already recorded today
}

input SetReadingGoalInput {
  year: Int!
  targetKind: GoalKind!
  targetValue: Int!
}
```

### Behavior

- **`recordActivity`**
  1. Compute `dayKey` server-side in UTC+8.
  2. Clamp `pagesDelta` to `[0, 1]` (the normalized unit is one page per advance) so a malicious client cannot inflate `pagesRead`. Reject unknown/negative values.
  3. Insert an `ActivityEvent` row, using an `ActivityEventReceipt` on `(userId, operationId)` to detect a replay; on replay, skip the `pagesRead` accumulation.
  4. Attempt to insert `DailyActivityType` on `(userId, dayKey, type)`. A P2002 (unique violation) means the type was already counted today → `counted: false`; a successful insert → `counted: true`. This is race-free and replaces any read-then-write check.
  5. Upsert `DailyActivity`: always add the (replay-safe) `pagesDelta` to `pagesRead`; increment `activityCount` only when step 4's insert succeeded.
  6. Refresh `UserStreak` when the day newly qualifies.
  7. Return `{ dayKey, counted }`.

- **`myProgress(year)`**
  - `goal`: the `ReadingGoal` for `(user, year)` or `null`.
  - `daysRead` / `pagesRead`: aggregate over `DailyActivity` rows within `year` (UTC+8 bounds).
  - `currentStreak`: **always** recomputed from `DailyActivity` (O(days) — the same bounded read the spec already relies on). It is never served from the cache, because a cache cannot know "today" without a recompute; this removes the time-passage blind spot where a stale cache would report a broken streak as alive.
  - `longestStreak`: served from `UserStreak`; recomputed only when the cache is absent or when `UserStreak.lastActiveDayKey` does not equal the maximum `DailyActivity.dayKey` for the user (new activity arrived). The recompute scans the user's all-time `DailyActivity` rows (bounded by days-active, not events).
  - `lastActiveDayKey`: most recent `DailyActivity.dayKey` in the year.

- **`myActivityCalendar(year)`** — all `DailyActivity` rows for the year as `DailyActivityPoint`s, ordered by `dayKey`. Missing days are omitted (client renders gaps as empty).

- **`setReadingGoal`** — upsert on `(user, year)`. Validation: `year` within [2000, 2100]; `targetValue` in [1, 366] for `DAYS`, [1, 100000] for `PAGES`. Invalid input returns a typed GraphQL error.

- **Timezone** — server is authoritative for `dayKey`. The client never sends a date.

- **Streak rule** — `currentStreak` is computed by walking back from `today` (UTC+8); if `today` has no qualifying day, walk back from `yesterday`. This makes the "today or yesterday" tolerance an implementation detail of the walk-back, not a separate rule.

## Backend Components

New module `apps/api/src/progress/`:

| File | Responsibility |
|---|---|
| `progress.module.ts` | Registers resolver + services; imports `AuthModule` only (`PrismaModule` is `@Global()`, available without import — matches `feed.module.ts`). Exports `ProgressService`. |
| `progress.service.ts` | `recordActivity`, `getMyProgress`, `getActivityCalendar`, `setReadingGoal`. Owns receipt/dedup + upsert logic in a Prisma transaction. |
| `streak.service.ts` | Streak math from `DailyActivity`: `computeCurrent`, `computeLongest`, `refreshCache`. Pure-ish and unit-testable. |
| `day-key.util.ts` | `toDayKey(date): string` (UTC+8, mirroring `feed.service.ts:118-127`), `yearBounds(year): { startDayKey: string, endDayKey: string }` returning **strings** so year scope is a lexicographic `dayKey` range, not Date math. |
| `progress.resolver.ts` | GraphQL surface, JWT-guarded, `@CurrentUser()`. |
| `models/progress.model.ts` | `MyProgress`, `ReadingGoal`, `DailyActivityPoint` object types. |
| `dto/record-activity.input.ts` | `RecordActivityInput` with class-validator + Zod parity per repo convention. |
| `dto/set-reading-goal.input.ts` | `SetReadingGoalInput`. |

Register `ProgressModule` in `apps/api/src/app.module.ts` next to the other domain modules.

## Frontend Surface

UI implementation is routed to the `@designer` lane; this section defines intent and constraints, not final visual decisions. The orchestrator reviews and fixes user-facing copy after design work without altering visual or interaction intent.

### A. Sidebar widget — wire the existing card

- File: `apps/web/src/components/layout/sidebar.tsx:63-87`.
- Replace the hardcoded `12/24` with `myProgress` data: numerator = `daysRead` or `pagesRead` per `goal.targetKind`; denominator = `goal.targetValue`.
- Bar width computed from numerator / denominator (clamped 0–100%).
- Add a **streak chip** (flame icon + `N day streak`) as a new element.
- **Empty state** (no goal set): show a "Set a yearly goal" CTA instead of `0/0`.
- **Track Progress** button links to `/progress`.
- Query failure → neutral fallback state; never blocks the shell.

### B. New `/progress` page

- Route: `apps/web/src/app/(app)/progress/page.tsx` (+ client component).
- **Streak header**: current streak, longest streak, last active.
- **Heatmap calendar**: year grid, one cell per `dayKey`; shade by `DailyActivityPoint.activityCount` (0–4 scale) using existing `surface-container-*` / `primary` MD3 tokens. Horizontally scrollable on mobile (reuse `.no-scrollbar`).
- **Goal editor**: choose `DAYS` or `PAGES`, set target value, call `setReadingGoal`.
- **Year switcher**: view prior years.
- Reuses `AuthenticatedLayout` / `AppShell`, `NavItem`, existing card patterns, and `material-symbols-outlined` icons.

### C. Activity recording call sites

| Source | Trigger | `type` | `pagesDelta` |
|---|---|---|---|
| Ebook reader | On page advance | `BOOK_READ` | 1 |
| Bible reader (client) | On chapter open | `BIBLE_READ` | 1 |
| Feed page | On load | `FEED_READ` | 0 |
| Group post | On successful post create | `GROUP_POST` | 0 |

- Calls are fire-and-forget; failures are swallowed (fail-open).
- **Offline:** Bible reads performed while offline fire `recordActivity` **on reconnect** (fire-and-forget). The existing reader outbox (`apps/web/src/lib/offline/outbox.ts`) is specialized for reader mutations — `OutboxOperationKind` is `PROGRESS_SET | BOOKMARK_* | ANNOTATION_*`, and records require `bookId`/`contentVersion`/`entityKey`/`baseRevision` with dispatch via `dispatchReaderOperation` (`sync-service.ts:585`). It cannot carry activity pings without a new kind, optional fields, and a dispatch branch; that refactor is **out of scope for v1**. Consequently, per Non-goals, an offline read that never reconnects does not count server-side — accepted and documented.
- The feed page fires on load; server-side dedup (`DailyActivityType`) makes repeated fires harmless, though the client should skip firing if it already fired today to avoid pointless writes.
- **Write-volume note:** `BOOK_READ` fires per page advance. To avoid write amplification on B1ms, debounce client-side (e.g. coalesce to one ping per session or per N page advances); the `activityCount` dedup means extra pings only cost write I/O, not correctness.

## Offline & Error Handling

- `recordActivity` dedups `activityCount` race-free via the `DailyActivityType` unique constraint, and dedups `pagesRead` replay via `ActivityEventReceipt` when `operationId` is supplied. The reader UIs never await it; a failure cannot block reading.
- `myProgress` / `myActivityCalendar` failures degrade the widget and page to neutral/empty states, not errors that break the shell.
- `dayKey` is computed server-side only; client clocks are untrusted.
- `pagesDelta` is clamped server-side to `[0, 1]`; goal input is validated server-side with typed errors.

## Testing Plan

Aligned with `docs/superpowers/specs/2026-06-29-testing-strategy-design.md`.

1. **Unit (API) — `streak.service.spec.ts`**: consecutive-day math; yesterday tolerance; gap breaks the streak; empty ledger; first-ever activity; UTC+8 boundary correctness (a 23:59 UTC read lands on the next UTC+8 day); stale-cache recompute (last activity days ago → `currentStreak` recomputed to 0, not served stale).
2. **Unit (API) — `progress.service.spec.ts`**: goal upsert + year scoping; `DailyActivityType` P2002 → `counted: false` and `activityCount` unchanged (race-free dedup); `pagesRead` accumulates only when the `operationId` receipt is new (replay under offline flush does not double-count); `pagesDelta` clamped to [0, 1]; validation rejection for out-of-range `targetValue`.
3. **Unit (API) — `day-key.util.spec.ts`**: `toDayKey` across the UTC+8 midnight boundary; a read at 23:30 UTC on Dec 31 2026 (07:30 UTC+8 Jan 1 2027) maps to **2027**, verifying `yearBounds` uses `dayKey` strings not `occurredAt`.
4. **Resolver tests — `progress.resolver.spec.ts`**: each operation delegates with `user.id`; guards applied (mirrors existing `*.resolver.spec.ts`).
5. **Web unit**: sidebar widget states (no goal / in progress / complete / query failure); heatmap cell intensity + gap rendering; goal editor validation.
6. **Integration**: record activity → rollup updates → `myProgress` reflects `daysRead`/`pagesRead`/streak; second same-day same-type event returns `counted: false` and does not double-count; duplicated `operationId` does not inflate `pagesRead`.
7. **Manual / E2E (browser)**: `/progress` and widget render real data; set a goal and see the widget update; an offline Bible read that reconnects counts the day, and one that never reconnects does not (documented limitation).

## Risks & Follow-ups

- **Scope creep on "engagement."** Feed auto-fire makes streaks easy. If streaks should later *mean* reading, that is a data-model/behavior change, not a tweak. Ship as specified, then revisit.
- **Write amplification on B1ms.** Every page advance is up to 1 `ActivityEvent` insert + 1 `DailyActivityType` insert + 1 `DailyActivity` upsert. Mitigation in v1: debounce `BOOK_READ` client-side (coalesce to one ping per session or per N advances). The rollup/dedup keep this correct regardless; this is purely about write I/O.
- **Feed auto-fire volume.** A client refreshing the feed repeatedly produces inserts that dedup to zero net signal. Mitigation: client skips `FEED_READ` if already fired today; server early-returns on an existing `DailyActivityType` row.
- **`longestStreak` all-time scan.** Recomputed only when new activity arrives; scans the user's all-time `DailyActivity` rows (bounded by days-active, not events). Acceptable now; grows linearly with engagement. Follow-up: store `longestStreak` as a monotonic max and recompute only when `currentStreak` exceeds it.
- **`ActivityEvent` growth.** The `DailyActivity` rollup makes it safe to prune raw events older than N days without losing history. Deferred for v1 but the plan must set a concrete follow-up (a scheduled prune), not an open-ended "deferred".
- **Book per-page reads.** The normalized unit is 1 page per advance; `pagesDelta` is clamped to [0, 1] server-side, so a malicious client cannot inflate `pagesRead`.
- **Bible is client-only.** A user who never reconnects keeps a local streak the server never sees. Accepted and documented limitation.
- **Streak cache drift.** `currentStreak` is always recomputed; `longestStreak` is cache-guarded by the `lastActiveDayKey == max(dayKey)` check and falls back to a full recompute.

## SonarQube Compliance

Per `docs/SONAR-GUIDELINES.md`, implementation must avoid triggering findings:

- No `window` references in client code (use `globalThis`).
- No array index in React keys — heatmap cells keyed by `dayKey`.
- Cognitive complexity ≤ 15 per function — streak math and rollup logic extracted into helpers.
- No nested ternaries (S6644) — the sidebar numerator selection (`daysRead` vs `pagesRead` per `targetKind`) must be extracted to a helper, never an inline nested ternary.
- Zod validation must not use deprecated APIs (S6665–S6690): use `z.number().gte(1).lte(366)` / `z.number().gte(1).lte(100000)`, **not** `.min()` / `.max()`.
- Use `??` / `?.`; `String#replaceAll` where applicable.
- Component props marked `readonly`.
- Any finding surfaced during review is appended to `docs/SONAR-GUIDELINES.md` in the same change.

---

## Approval Gate

This document is the design of record. No implementation starts until:

1. This written spec is reviewed and approved, then
2. The implementation plan (via the `writing-plans` skill) is reviewed and an execution method is selected.
