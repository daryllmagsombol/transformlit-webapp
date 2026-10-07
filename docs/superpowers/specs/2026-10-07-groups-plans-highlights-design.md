# Group Reading Plans & Shared Highlights — Design Spec

**Date:** 2026-10-07
**Status:** Approved (autonomous — user delegated all decisions)
**Branch:** `feature/groups-reading-plans-highlights`
**Scope:** Two group-domain features that build on the existing `groups`, `books`/`BookProgress`, and `Highlight` foundations:

1. **Group Reading Plans** — a group picks a book and a start/target date; members see the plan and who is on pace.
2. **Shared Highlights** — a reader shares one of their own highlights to a group; the group page shows a highlights feed.

---

## Overview

The app already has `Group`, `GroupMember`, `GroupPost`, a group detail page with tabs, `Book`, `BookProgress` (per user+book), and `Highlight` rows (written through `applyBookReaderOperation`). This spec adds:

- **Plans**: one active plan per group at a time is *not* required, but v1 keeps it simple — a group may have at most one ACTIVE plan; creating a new one archives the previous.
- **Highlights**: a share is a join row (`GroupHighlight`) pointing at an owned `Highlight`; the feed renders highlight text/note/page + the book title + sharer.

### Non-goals (v1)

- Notifications for new plans/highlights (the notifications infra exists, but wiring is a separate slice — YAGNI for v1).
- Per-member reading assignments, chapter-level pacing, or plan templates.
- Reactions/comments on a shared highlight beyond the existing group-post surface.
- Editing/annotating another member's shared highlight.
- Email digests.

## Design Decisions

- **Plans derive progress; they do not store it.** A plan stores `bookId`, `startDate`, `targetDate`. A member's progress is their existing `BookProgress` row for that book. "On pace" is computed at read time, so there is no denormalized state to keep in sync.
- **One ACTIVE plan per group.** Enforced in the service (transaction): creating a plan sets `status = ARCHIVED` on any prior ACTIVE plan in the same group. Keeps the UI unambiguous and the schema simple.
- **Highlights are referenced, never copied.** `GroupHighlight` holds `groupId`, `highlightId`, `sharedById`. The highlight's own text/note/page/book come from its `Highlight` row, so edits to the source highlight are reflected and no duplicate content exists.
- **Share requires ownership.** A member may only share a `Highlight` whose `userId` is their own, and only to a group they are an ACTIVE member of. Unshare is sharer-only (or group OWNER/MODERATOR).
- **Visibility = ACTIVE membership.** Both features reuse `GroupsService.getMembershipFor` + `canView`. A PUBLIC group still requires ACTIVE membership for plan/highlight *content* (matching `GroupPostsService`).
- **Module boundary respected.** New backend domain module `group-features` (or extend `groups`?) — see Components. It imports `AuthModule` only; `PrismaModule` is `@Global`. No cross-domain imports; it reads `BookProgress`/`Highlight`/`Book` via Prisma directly (they are not group-owned, and the monolith rule forbids importing another domain's module — reading shared tables through `PrismaService` is the established pattern, e.g. `GroupPostsService` reads posts it owns; here the tables are shared model data).
- **Timestamps/ids** follow conventions: uuid `@id`, `createdAt`/`updatedAt`, `@@map` snake_case, `onDelete: Cascade` for group-owned rows.
- **Dates are calendar dates** (`@db.Date`) for `startDate`/`targetDate` — no time component, avoiding timezone drift; the server compares in UTC.

## Data Model (Prisma additions)

```prisma
enum ReadingPlanStatus {
  ACTIVE
  ARCHIVED
}

/// A group's reading plan: a book plus a start/target window.
model GroupReadingPlan {
  id           String            @id @default(uuid())
  groupId      String
  group        Group             @relation(fields: [groupId], references: [id], onDelete: Cascade)
  bookId       String
  book         Book              @relation(fields: [bookId], references: [id], onDelete: Cascade)
  title        String?
  startDate    DateTime          @db.Date
  targetDate   DateTime          @db.Date
  status       ReadingPlanStatus @default(ACTIVE)
  createdById  String?
  createdBy    User?             @relation("PlanCreatedBy", fields: [createdById], references: [id], onDelete: SetNull)
  createdAt    DateTime          @default(now())
  updatedAt    DateTime          @updatedAt

  @@index([groupId, status])
  @@index([bookId])
  @@map("group_reading_plans")
}

/// A share of one owned Highlight into one group.
model GroupHighlight {
  id          String    @id @default(uuid())
  groupId     String
  group       Group     @relation(fields: [groupId], references: [id], onDelete: Cascade)
  highlightId String
  highlight   Highlight @relation(fields: [highlightId], references: [id], onDelete: Cascade)
  sharedById  String
  sharedBy    User      @relation("HighlightSharedBy", fields: [sharedById], references: [id], onDelete: Cascade)
  createdAt   DateTime  @default(now())
  deletedAt   DateTime?

  @@unique([groupId, highlightId])
  @@index([groupId, createdAt])
  @@index([sharedById])
  @@map("group_highlights")
}
```

`Group` gains `readingPlans GroupReadingPlan[]` and `sharedHighlights GroupHighlight[]`. `Book` gains `readingPlans GroupReadingPlan[]`. `Highlight` gains `groupShares GroupHighlight[]`. `User` gains `createdPlans GroupReadingPlan[] @relation("PlanCreatedBy")` and `sharedHighlights GroupHighlight[] @relation("HighlightSharedBy")`.

`@@unique([groupId, highlightId])` means a highlight can be shared to a group once. A soft-deleted share blocks re-sharing unless we treat `deletedAt IS NULL` as the uniqueness key — v1: on re-share of a soft-deleted row, clear `deletedAt` (upsert-style revive) rather than insert.

## GraphQL API

All operations are JWT-guarded and operate on `@CurrentUser()`. Group auth is checked in the service via `GroupsService`.

### Types

```graphql
enum ReadingPlanStatus { ACTIVE ARCHIVED }

type GroupReadingPlan {
  id: ID!
  groupId: ID!
  book: Book!
  title: String
  startDate: DateTime!
  targetDate: DateTime!
  status: ReadingPlanStatus!
  createdById: ID
  createdAt: DateTime!
  # Derived (field resolver):
  expectedPercent: Int!        # elapsed / total, clamped 0..100
  members: [PlanMemberProgress!]!
}

type PlanMemberProgress {
  user: User!
  currentPage: Int!
  totalPages: Int
  percent: Int!                # currentPage / totalPages, clamped 0..100
  onPace: Boolean!             # percent + TOLERANCE >= expectedPercent
}

type GroupHighlight {
  id: ID!
  groupId: ID!
  highlight: SharedHighlight!
  sharedBy: User!
  createdAt: DateTime!
}

type SharedHighlight {
  id: ID!
  bookId: ID!
  bookTitle: String!
  page: Int!
  text: String!
  note: String
  color: String
}
```

### Operations

```graphql
type Query {
  groupReadingPlan(groupId: ID!): GroupReadingPlan
  groupHighlights(groupId: ID!, offset: Int = 0, limit: Int = 25): [GroupHighlight!]!
}

type Mutation {
  createGroupReadingPlan(input: CreateGroupReadingPlanInput!): GroupReadingPlan!
  archiveGroupReadingPlan(planId: ID!): Boolean!
  shareHighlightToGroup(input: ShareHighlightInput!): GroupHighlight!
  unshareHighlight(shareId: ID!): Boolean!
}

input CreateGroupReadingPlanInput {
  groupId: ID!
  bookId: ID!
  title: String
  startDate: DateTime!
  targetDate: DateTime!
}

input ShareHighlightInput {
  groupId: ID!
  highlightId: ID!
}
```

### Behavior

- **`createGroupReadingPlan`** — requires ACTIVE membership + OWNER/MODERATOR (reuse `assertCanModerate`). Validates `targetDate > startDate`. In a transaction: archive the group's existing ACTIVE plan(s), then create the new ACTIVE plan. Returns the plan.
- **`archiveGroupReadingPlan`** — OWNER/MODERATOR only; sets `status = ARCHIVED`. Returns `true` if the plan existed and belonged to the group.
- **`groupReadingPlan(groupId)`** — ACTIVE members only. Returns the ACTIVE plan (or `null`). `members` = every ACTIVE group member's `BookProgress` for the plan's book (0 when absent). `expectedPercent` from `(today - startDate) / (targetDate - startDate)` clamped 0..100; before start, 0; after target, 100.
- **`groupHighlights(groupId, offset, limit)`** — ACTIVE members only. Non-deleted shares, `createdAt DESC`, paginated. Each item resolves the source `Highlight` + `Book.title` + `sharedBy`.
- **`shareHighlightToGroup`** — the `Highlight` must be owned by the caller (`highlight.userId === user.id`) and not soft-deleted; the caller must be an ACTIVE member. If a soft-deleted `GroupHighlight` exists for `(groupId, highlightId)`, revive it (`deletedAt = null`). Else insert.
- **`unshareHighlight`** — sharer, or group OWNER/MODERATOR; soft-delete (`deletedAt = now`).

## Backend Components

New module `apps/api/src/group-features/` (a sibling domain so `groups.service.ts` stays focused; it imports `AuthModule` + `GroupsModule` to reuse auth helpers — `GroupsModule` already exports `GroupsService`):

| File | Responsibility |
|---|---|
| `group-features.module.ts` | `imports: [AuthModule, GroupsModule]`; providers resolver + two services; no exports needed. |
| `reading-plans.service.ts` | `create`, `archive`, `getActive(groupId, userId)` with derived member progress. |
| `shared-highlights.service.ts` | `share`, `unshare`, `list(groupId, userId, offset, limit)`. |
| `progress.ts` | Pure helpers: `expectedPercent(start, target, today)`, `memberPercent(progress, totalPages)`, `isOnPace(percent, expected, tolerance)`. |
| `group-features.resolver.ts` | GraphQL surface, JWT-guarded. |
| `models/group-feature.model.ts` | `GroupReadingPlan`, `PlanMemberProgress`, `GroupHighlight`, `SharedHighlight` + input types; enum registration. |

Register `GroupFeaturesModule` in `app.module.ts`.

**Auth reuse:** `GroupsService.getMembershipFor(groupId, userId)` → throws/returns null unless ACTIVE; `assertCanModerate(groupId, actorId)` for owner/mod. These are the ONLY authorization paths — do not duplicate membership logic.

## Frontend Surface

UI routes to `@designer`. Two new tabs on the group detail page:

### A. Group detail tabs
- Add `'plan' | 'highlights'` to the `tab` union in `apps/web/src/components/groups/group-detail-client.tsx` (currently `'posts' | 'members' | 'settings'`) and render the two new sections.
- Add the two `TABS` entries in `apps/web/src/components/groups/group-header.tsx`.
- Reuse `AuthenticatedLayout`/MD3 tokens.

### B. Reading plan tab
- No active plan → "Start a reading plan" form (book picker, start/target date) shown only to OWNER/MODERATOR; members see an empty state.
- Active plan → book cover/title, date window, a progress bar (`expectedPercent`), and a member list with per-member percent + on-pace indicator.
- OWNER/MODERATOR: "Archive plan".

### C. Highlights tab
- Feed of shared highlights (book title, page, quote, note, sharer avatar/name), newest first, "Load more".
- Empty state: "No shared highlights yet."
- Unshare control on the caller's own shares (and for moderators).

### D. Share entry point
- In the reader's annotation/highlight panel, a "Share to group" action that lists the caller's ACTIVE groups (`myGroups`) and calls `shareHighlightToGroup`.

## Offline & Error Handling

- Both features are **online read paths**; offline they degrade to an error/empty state, consistent with the groups pages (which are not offline-first).
- All mutations validate membership server-side; a non-member gets a typed GraphQL error.
- Date validation: `targetDate` must be strictly after `startDate`; both required; reject with a typed error.

## Testing Plan

1. **Unit (API)** — `progress.ts`: expected percent before/at/after window; clamp; zero-length window; member percent with/without `totalPages`; on-pace tolerance boundary.
2. **Unit (API)** — `reading-plans.service.spec.ts`: create archives prior ACTIVE; archive auth; `getActive` builds member rows for every ACTIVE member (including 0-progress); non-member rejected.
3. **Unit (API)** — `shared-highlights.service.spec.ts`: share requires ownership + membership; duplicate share inserts once; soft-deleted share revives; unshare auth (sharer or moderator); list excludes soft-deleted and paginates.
4. **Resolver specs** — each operation delegates with `user.id`; guards applied.
5. **Web unit** — plan tab states (no plan/form/active/member rows), highlights feed (empty/list/pagination), share action.
6. **Integration** — create plan → `groupReadingPlan` returns it with member progress; share highlight → `groupHighlights` returns it; unshare removes it.

## SonarQube Compliance

- No `window`; `globalThis`; no array-index keys; no nested ternary; props `readonly`; complexity ≤15; sort with `localeCompare`; native `<progress>`/`<output>`; regex literals; no deprecated Zod/`FormEvent` APIs. Any finding from review is appended to `docs/SONAR-GUIDELINES.md` in the same change.

---

## Approval Gate

Autonomous run: the user delegated all decisions and pre-approved. This spec is the design of record; the implementation plan follows.
