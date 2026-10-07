# Group Reading Plans & Shared Highlights — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add group reading plans and a group shared-highlights feed to the existing groups domain.

**Architecture:** A new backend module `group-features` (NestJS + Prisma) reuses `GroupsService` for membership/auth, adds two models (`GroupReadingPlan`, `GroupHighlight`), derived plan-progress helpers, and a GraphQL surface. Web adds two tabs to the group detail page plus a reader "share to group" action.

**Tech Stack:** NestJS 11 + Apollo GraphQL, Prisma 7 + PostgreSQL, Zod 4 (shared), Next.js 16 + React 19 + Apollo Client, Jest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-07-groups-plans-highlights-design.md`

## Global Constraints

- **Domain modules:** `GroupFeaturesModule` imports `AuthModule` + `GroupsModule` (which exports `GroupsService`). `PrismaModule` is `@Global` — never import it. No other cross-domain imports.
- **Auth is reused, never reimplemented:** membership via `GroupsService.getMembershipFor(groupId, userId)`; owner/mod via `GroupsService.assertCanModerate(groupId, actorId)`.
- **Dates** for plan windows are `@db.Date`; compare in UTC.
- **One ACTIVE plan per group**, enforced in a transaction (archive prior on create).
- **Shares reference `Highlight`**, never copy it; `@@unique([groupId, highlightId])`; soft-delete via `deletedAt`; revive on re-share.
- **No notifications in v1.**
- **SonarQube:** no `window`; `globalThis`; no array-index keys; no nested ternary; `readonly` props; complexity ≤15; `localeCompare` sort; native `<progress>`/`<output>`; regex literals; no deprecated Zod/`FormEvent`. Any review finding is appended to `docs/SONAR-GUIDELINES.md` in the same change.
- **Tests:** API `pnpm --filter @transformlit/api test`; web `pnpm --filter @transformlit/web test`; API integration `DOCKER_HOST="unix:///Users/daryllmagsombol/.colima/default/docker.sock" TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @transformlit/api test:integration`.

## Review Focus

1. **Authorization bypass** — a non-member or non-owner must never read plan content, archive a plan, or share/unshare. Every op checks membership in the service, not the resolver.
2. **Ownership spoofing on share** — sharing someone else's `Highlight.id` must be rejected (`highlight.userId === user.id`).
3. **Pace math at the boundaries** — before start (0%), exactly at target (100%), after target (100%), zero-length window, null `totalPages`.
4. **Concurrent plan creation** — two moderators creating at once must not leave two ACTIVE plans (transaction + archive-then-create).
5. **Duplicate/revive share** — sharing the same highlight twice to a group, or re-sharing after unshare, must not violate the unique constraint.

---

### Task 1: Prisma models + migration

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Test: migration applies + client generates.

**Interfaces:**
- Produces: `ReadingPlanStatus` enum; `GroupReadingPlan`, `GroupHighlight` models; `Group`/`Book`/`Highlight`/`User` back-relations.

- [ ] **Step 1: Add enum + models** exactly as in the spec's "Data Model" section.
- [ ] **Step 2: Add back-relations** on `Group`, `Book`, `Highlight`, `User`.
- [ ] **Step 3: Check status** `pnpm --filter @transformlit/api exec prisma migrate status` — resolve pending before creating.
- [ ] **Step 4: Create + apply** `pnpm --filter @transformlit/api exec prisma migrate dev --name group_plans_highlights`.
- [ ] **Step 5: Generate + typecheck** `prisma generate` then `pnpm --filter @transformlit/api typecheck`.
- [ ] **Step 6: Commit.**

### Task 2: Shared enums + Zod schemas

**Files:** Modify `packages/shared/src/enums.ts`, `schemas/index.ts`.
- Create `ReadingPlanStatus` enum + `createGroupReadingPlanSchema`, `shareHighlightSchema`.
- `createGroupReadingPlanSchema`: `groupId`/`bookId` uuid strings, optional `title` ≤200, `startDate`/`targetDate` ISO date; refine `targetDate > startDate`.
- `shareHighlightSchema`: `groupId`/`highlightId`.
- Barrel-export; use `.gte/.lte`, no deprecated Zod.
- Test + commit.

### Task 3: Pure progress helpers

**Files:** Create `apps/api/src/group-features/progress.ts` + `.spec.ts`.
**Interfaces:**
- `expectedPercent(start: Date, target: Date, today: Date): number` — clamped 0..100; before start 0; after target 100; equal dates → 100.
- `memberPercent(currentPage: number, totalPages: number | null): number` — 0 if totalPages falsy, clamp 0..100 (round).
- `isOnPace(percent: number, expected: number, tolerance = 10): boolean` — `percent + tolerance >= expected`.
- 8+ unit tests incl. all Review Focus boundary cases.
- Commit.

### Task 4: ReadingPlansService

**Files:** Create `apps/api/src/group-features/reading-plans.service.ts` + `.spec.ts`.
**Interfaces:**
- `create(userId, { groupId, bookId, title?, startDate, targetDate })` → plan. Requires `assertCanModerate`. Transaction: `updateMany` ACTIVE→ARCHIVED for the group, then create.
- `archive(userId, planId)` → boolean. Resolve plan → group → `assertCanModerate`; set ARCHIVED.
- `getActive(userId, groupId)` → plan with derived `expectedPercent` + `members[{user, currentPage, totalPages, percent, onPace}]` for every ACTIVE member (0 progress if none).
- Mock `PrismaService` + `GroupsService`; mirror `apps/api/src/groups/group-posts.service.spec.ts`.
- Commit.

### Task 5: SharedHighlightsService

**Files:** Create `apps/api/src/group-features/shared-highlights.service.ts` + `.spec.ts`.
**Interfaces:**
- `share(userId, { groupId, highlightId })` → share. Assert membership; load highlight; reject if not owned or soft-deleted; find existing `(groupId, highlightId)` → revive (`deletedAt: null`) else create.
- `unshare(userId, shareId)` → boolean. Sharer OR `assertCanModerate`; soft-delete.
- `list(userId, groupId, offset, limit)` → rows (`deletedAt: null`, `createdAt DESC`) with highlight + book + sharer.
- Commit.

### Task 6: GraphQL models, inputs, resolver, module

**Files:** Create `models/group-feature.model.ts`, `group-features.resolver.ts`, `group-features.module.ts`; modify `app.module.ts`.
- Register `ReadingPlanStatus`; object types + input types exactly per spec; field resolvers `expectedPercent`/`members` delegate to the service result.
- Resolver: JWT-guarded; `groupReadingPlan`, `groupHighlights` queries; `createGroupReadingPlan`, `archiveGroupReadingPlan`, `shareHighlightToGroup`, `unshareHighlight` mutations.
- Module: `imports: [AuthModule, GroupsModule]`; providers both services + resolver.
- Resolver spec: each op delegates with `user.id`.
- Commit.

### Task 7: GraphQL operations + shared types

**Files:** Create `packages/graphql/operations/groups.graphql` (or extend the web `lib/groups.ts` convention) + `packages/shared/src/types/graphql.ts` additions.
- Add the 2 queries + 3 mutations; add `GraphQLGroupReadingPlan`, `GraphQLPlanMemberProgress`, `GraphQLGroupHighlight` shared types.
- Regenerate schema snapshot + codegen: `pnpm --filter @transformlit/api graphql:schema:export && pnpm graphql:codegen`.
- Commit.

### Task 8: Web reading-plan tab (UI — owner: @designer)

**Files:** Create `apps/web/src/components/groups/group-reading-plan.tsx` + spec; modify `group-detail-client.tsx`, `group-header.tsx`.
- Add `'plan' | 'highlights'` to the tab union + header TABS.
- States: no plan (moderator form / member empty state), active plan (window, expected bar, member list with per-member % + on-pace), archive button.
- Native `<progress>` for bars; no array-index keys; `readonly` props.
- Engineer writes failing tests first; `@designer` implements; engineer runs.
- Commit.

### Task 9: Web shared-highlights tab + share action (UI — owner: @designer)

**Files:** Create `apps/web/src/components/groups/group-highlights.tsx` + spec; modify the reader highlight/annotation panel for "Share to group".
- Feed: book title, page, quote, note, sharer; newest first; load more; empty state; unshare on own shares.
- Share action: list `myGroups`, call `shareHighlightToGroup`, success/error.
- Commit.

### Task 10: Integration + E2E verification
- API integration spec: create plan → `groupReadingPlan` returns it with member progress; share → `groupHighlights`; unshare removes; non-member rejected.
- Playwright: plan tab + highlights tab render; share flow.
- Full typecheck + suites.
- Commit.

## Self-Review Notes
- Spec coverage: models (T1), schemas (T2), pace math (T3), plan service (T4), share service (T5), GraphQL (T6), operations (T7), plan UI (T8), highlights UI + share (T9), verification (T10).
- Complexities: `getActive` builds member rows from `GroupMember` + `BookProgress` — a single query per table then a map, not N+1.
