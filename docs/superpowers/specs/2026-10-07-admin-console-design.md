# Admin & Moderation Console — Design Spec (rev. 2)

**Date:** 2026-10-07
**Status:** Approved (design) — revised after independent @oracle review; pending user re-review
**Branch:** `feature/admin-console`
**Scope:** A staff-only `/admin` console plus the backend authorization, audit write-path, analytics read-path, and store-moderation changes it needs.

> **Rev. 2 note.** Rev. 1 was reviewed line-by-line against the code by @oracle. It had three blockers (group moderation was unimplementable for global staff; the book-upload gap was only half-closed and its UI had no plumbing; suspension left the reader cookie alive) and one dead metric (`completedAt` has no writer). Every finding is resolved below and the resolution is marked **[ADM-n]**; the recurring lessons are recorded in `docs/SONAR-GUIDELINES.md` under the Admin Console review IDs.

---

## Overview

Admin-capable operations exist across domain modules with **no UI**, **inconsistent authorization**, and two tables **written but never read** (`PageView`) or **never written at all** (`AuditLog`).

Verified findings that define this work:

1. **No admin surface.** No `/admin` route in `apps/web/src/app`; no admin API module in `apps/api/src`.
2. **`RolesGuard`/`@Roles` is wired only in `feed.resolver.ts`** (L31-73). `RolesGuard` is *not* a global guard — only `ContextThrottlerGuard` is (`app.module.ts:153`). `@Roles` alone is inert metadata; every use needs `@UseGuards(JwtAuthGuard, RolesGuard)`.
3. **Book mutations are effectively unguarded.** `uploadBook` (`books.resolver.ts:70-77`) has only `JwtAuthGuard`; `uploadPdf` (L89-114) has only `JwtAuthGuard`; `uploadPdf` → `uploadBookFile` (`books.service.ts:120-164`) flips `status: 'PUBLISHED'` (L157). Any member can create a book and publish it. **[ADM-1]**
4. **`AuditLog` has no code at all** — no service, writer, or reader. `AuditLog.user` is `onDelete: Cascade` (`schema.prisma:818`). **[ADM-2]**
5. **`PageView` is written but never read.** Written only in `PageViewService.record` (`page-view.service.ts:9-13`) from `books.controller.ts:94-98`.
6. **`BookProgress.completedAt` has no writer** — only the model field (`book.model.ts:105`) and schema. Completion stats would be permanently 0. **[ADM-3]**
7. **Group moderation is membership-based only.** `assertCanModerate` (`groups.service.ts:240-249`) requires an ACTIVE `GroupMember`; `updateMemberRole` (L328-350) additionally requires group-level `OWNER`; `canView`/`listMembers` (L111-190) hide private groups from non-members; `listGroups` (L38-51) excludes private non-member groups. A global ADMIN who is not a member cannot moderate an arbitrary group. **[ADM-4]**
8. **Suspension has a content-access hole.** Reader pages are authenticated by the `transformlit_reader` cookie via `ReaderSessionService.resolve` (`reader-session.service.ts:37-47`), which slides expiry and never checks user status. `revokeAll(userId, bookId)` requires a `bookId`. A suspended user keeps reading indefinitely. **[ADM-5]**
9. **No user-administration methods exist.** `UsersService` has only `findById`, `findByEmail`, `searchUsers`, `updateProfile`, `listUsers`, `getProfile`. `User.status` exists (`schema.prisma:26`) but has no writer.
10. **Seed** makes `admin@transformlit.com` (`role: 'ADMIN'`) OWNER of the *seeded* groups (`seed.ts:154-162`) — not of user-created groups.

### Non-goals (v1)

- Global search (separate sub-project); the stubbed CTAs; paid-book checkout; email notifications; a per-action permission matrix; hard-deleting users; EPUB upload (rejected by `uploadBooksFile` today — **[ADM-6]**); two-page reader spread.
- **Group deletion is not in the console** (the taxonomy drops `GROUP_DELETED` until a call site exists — **[ADM-13]**).

## Design Decisions

- **Role tiers, fixed in v1.** Global `ADMIN`/`MODERATOR` are staff. Group OWNER/MODERATOR stay group-scoped.
- **Guards, not metadata.** Every guarded operation carries `@UseGuards(JwtAuthGuard, RolesGuard)` explicitly; the admin resolver applies it at class level with per-method `@Roles`. **[ADM-1]**
- **Global staff moderate any group** (approved). The group service threads the actor's global role so staff bypass membership; a new staff-only `adminGroups` query lists all groups including private. See "Store moderation". **[ADM-4]**
- **All book admin mutations are staff-only** (approved). The owner-based path in `assertCanManageBookPublic` is removed for these endpoints: `uploadBook` = ADMIN; `updateBook`/`deleteBook`/`retryBookConversion`/`uploadPdf` = ADMIN or MODERATOR. This closes the live gap rather than half-closing it. **[ADM-1]**
- **Suspension ends *all* access.** Reject non-`ACTIVE` in `jwt.strategy`, reject `SUSPENDED` in local login, block OAuth token minting for `SUSPENDED` users, revoke all refresh families for the user, and revoke all reading sessions for the user; reader session resolution also re-checks status. **[ADM-5]**
- **`AuditModule` is `@Global()`**, matching the real precedents `PrismaModule` and `StorageModule` (not Azure, which is explicitly imported — **[ADM-7]**). Audit is infrastructure; `@Global()` avoids per-domain imports. `AuditService` always uses the root `PrismaService`, never a transaction handle.
- **Audit is post-commit and best-effort.** `record()` is called *after* the business mutation resolves — never inside its transaction. A failed audit insert is caught and logged at error level; it never fails the business action, and a business rollback never silently discards an audit row. **[ADM-8]**
- **Analytics computed on read** from `PageView` + `BookProgress`; no rollup tables. **[ADM-3]**
- **`status` becomes an enum**, `UserStatus { ACTIVE SUSPENDED }`. Existing values are non-uniform (`"active"` default vs `"ACTIVE"` in tests) → case-tolerant `USING` cast. **[ADM-9]**
- **Console is UX-gated, server-enforced.** Role is read per request from the DB; no caching, so role changes take effect immediately.
- **Last-admin protection** with an exact predicate in a serializable transaction with `P2034` retry. **[ADM-10]**

## Authorization Matrix

| Capability | ADMIN | MODERATOR | Group OWNER/MOD | Member |
|---|---|---|---|---|
| Console access | ✅ full | ✅ limited | ❌ (uses group UI) | ❌ |
| `uploadBook` | ✅ | ❌ | ❌ | ❌ |
| `updateBook` / `deleteBook` / `retryBookConversion` / `uploadPdf` | ✅ | ✅ | ❌ | ❌ |
| Announcements (all) | ✅ | ✅ | ❌ | ❌ |
| User role change | ✅ | ❌ | ❌ | ❌ |
| User suspend / reactivate | ✅ | ❌ | ❌ | ❌ |
| View any group (incl. private) | ✅ | ✅ | own groups | ❌ |
| Approve / kick / ban / unban member | ✅ | ✅ | ✅ own groups | ❌ |
| Change member role | ✅ | ❌ | ✅ own groups (owner only) | ❌ |
| Delete group | ✅ | ❌ | ✅ own groups (owner only) | ❌ |
| Audit log read | ✅ | ✅ | ❌ | ❌ |
| Analytics read | ✅ | ✅ | ❌ | ❌ |

## Store moderation (resolves [ADM-4])

`GroupsService` changes (existing files):

- `assertCanModerate(groupId, actorId, actorRole?)` — if `actorRole === ADMIN` return a synthetic actor (bypass); if `actorRole === MODERATOR` bypass too, but **do not** allow actions against an `OWNER` target or role changes (enforced by the calling method). Existing member-based path unchanged.
- `listMembers(groupId, requesterId, requesterRole?)` — global staff bypass `canView` and see all statuses.
- New `adminGroups(filter?, page, pageSize)` — staff-only; all non-deleted groups (private included) with active member counts and pending counts; paginated.
- `updateMemberRole` — unchanged owner-only check for group actors; global ADMIN may change roles in any group; global MODERATOR may not.
- `deleteGroup` — unchanged; global ADMIN allowed via `assertCanManageGroup`'s existing ADMIN branch; global MODERATOR not.

Resolver changes (`groups.resolver.ts`): pass `user.role` into the above; expose `adminGroups` with `@UseGuards(JwtAuthGuard, RolesGuard) @Roles(ADMIN, MODERATOR)`.

**Global-staff OWNER protection stays:** staff cannot remove/ban/change the role of a group `OWNER` (existing guards), and staff moderation is additive, never destructive to group ownership.

## Data Model (Prisma changes)

```prisma
enum UserStatus {
  ACTIVE
  SUSPENDED
}

model User {
  // was: status String @default("active")   (schema.prisma:26)
  status UserStatus @default(ACTIVE)
  // existing @@index([role, status]) — rebuilt automatically by ALTER COLUMN TYPE
  auditLogs AuditLog[]   // existing back-relation
}

model AuditLog {                       // additions only
  @@index([targetType, targetId])      // NEW
}
```

Migration mechanics (**[ADM-9]**, **[ADM-11]**):

- Postgres enum conversion: `ALTER COLUMN status TYPE "UserStatus" USING (CASE WHEN lower(status) = 'active' THEN 'ACTIVE'::"UserStatus" ELSE 'SUSPENDED'::"UserStatus" END)`. The generated migration must also `DROP DEFAULT` before and `SET DEFAULT 'ACTIVE'` after, and must be written so the repo's destructive-SQL guard passes (that guard matches `DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM`; an `ALTER … TYPE … USING` does not match).
- **Do not hand-write index recreation** — Postgres rebuilds the dependent `@@index([role, status])` on type change.
- **Preflight:** `SELECT DISTINCT lower(status) FROM users;` and map each observed value explicitly. The `ELSE 'SUSPENDED'` branch silently suspends unknown values, so the preflight result must be recorded in the migration note.
- `ALTER COLUMN TYPE` takes an ACCESS EXCLUSIVE lock and rewrites the table; schedule accordingly.

### GraphQL contract change (breaking) — **[ADM-12]**

`User.status` is exposed as `String!` (`schema.gql:758`, `auth/models/auth.model.ts:27`). Converting to `UserStatus` changes it to `UserStatus!`. Blast radius (verified): **no web or `packages/graphql` operation selects `User.status`**, and the shared `GraphQLUser` (`packages/shared/src/types/graphql.ts:2-11`) has no `status` field. Required work:

- `registerEnumType(UserStatus, { name: 'UserStatus' })` in `auth/models/auth.model.ts` (next to `UserRole`, L4).
- Add `UserStatus` to `packages/shared/src/enums.ts` **and** to the explicit re-export list in `packages/shared/src/index.ts` (otherwise it is not exported).
- Regenerate the canonical SDL with `pnpm --filter @transformlit/api run graphql:schema:export`; CI compares SDL bytes and `graphql:schema:check` refuses to mutate.
- Rebuild `packages/graphql` codegen.
- Re-verify (no change expected): REST `AuthResponse.status: string` (`auth.controller.ts:47-58`) and `PUBLIC_USER_SELECT` (`auth.service.ts:28-38`).

`User.status` (account) and `GroupMember.status` (membership) are distinct; only the former changes.

## Backend Components

### New: `apps/api/src/audit/` (`@Global()`, precedent: Prisma/Storage)

| File | Responsibility |
|---|---|
| `audit.module.ts` | `@Global()`; provides + exports `AuditService`. |
| `audit.service.ts` | `record(...)` post-commit append via root `PrismaService`; `list(filters, pagination)`. |
| `audit-actions.ts` | Frozen action constants. |
| `audit.service.spec.ts` | Unit tests. |

`record({ actorId, action, targetType?, targetId?, payload?, ip?, userAgent? })`. `list({ action?, actorId?, targetType?, targetId?, from?, to? }, page, pageSize)` ordered `createdAt DESC`, `pageSize` hard-capped.

Action taxonomy v1 (only actions with a real call site): `LOGIN`, `LOGOUT`, `REFRESH_REUSE_DETECTED`, `USER_ROLE_CHANGED`, `USER_STATUS_CHANGED`, `BOOK_UPLOADED`, `BOOK_UPDATED`, `BOOK_DELETED`, `ANNOUNCEMENT_PUBLISHED`, `ANNOUNCEMENT_UNPUBLISHED`, `ANNOUNCEMENT_DELETED`, `GROUP_MEMBER_APPROVED`, `GROUP_MEMBER_KICKED`, `GROUP_MEMBER_BANNED`, `GROUP_MEMBER_UNBANNED`, `GROUP_MEMBER_ROLE_CHANGED`.

Call-site rules (**[ADM-8]**): post-commit only; `REFRESH_REUSE_DETECTED` emitted only when the stored token actually has `revokedAt` set (not on plain expiry); `LOGOUT` actor is derived from the stored refresh-token row's `userId` (the controller is `@Public`); `ip`/`userAgent` are threaded from the controller request or left null.

### New: `apps/api/src/admin/`

| File | Responsibility |
|---|---|
| `admin.module.ts` | Imports `AuthModule`; providers `AdminUsersService`, `AdminAnalyticsService`, resolver. |
| `admin-users.service.ts` | `list`, `setRole`, `setStatus` with last-admin guard + revoke-all. |
| `admin-analytics.service.ts` | `platformOverview`, `bookStats`. |
| `admin.resolver.ts` | Class-level `@UseGuards(JwtAuthGuard, RolesGuard)`; per-method `@Roles`. |
| `models/admin.model.ts` | Object types + `@InputType` filters (plain `@InputType`, matching existing convention — no class-validator/Zod ceremony, **[ADM-14]**). |
| `*.spec.ts` | Service + resolver tests. |

Register `AdminModule` and `AuditModule` in `app.module.ts`.

### Auth changes (resolves [ADM-5], [ADM-8])

- `jwt.strategy.ts:20-26` — reject `deletedAt != null` **or** `status !== ACTIVE`.
- `auth.service.ts` local login — reject `SUSPENDED` with a typed error.
- `auth.service.ts findOrCreateOAuthUser` (L183-206) — check `deletedAt`/`status` before `generateTokens`; a `SUSPENDED` user must not mint a new token pair.
- New `AuthService.revokeAllSessionsForUser(userId)` — revoke **all** refresh-token families for the user (there is no such method today; logout only revokes one presented token's family).
- `ReaderSessionService` — add `revokeAllForUser(userId)`; and `resolve()` (or `books.controller.ts authorizePage`) re-checks the user's `status === ACTIVE` before returning a session.

### Book admin changes (resolves [ADM-1], [ADM-6])

- `books.resolver.ts` — `uploadBook`: `@UseGuards(JwtAuthGuard, RolesGuard) @Roles(ADMIN)`; `updateBook`, `deleteBook`, `retryBookConversion`, `uploadPdf`: `@UseGuards(JwtAuthGuard, RolesGuard) @Roles(ADMIN, MODERATOR)`.
- `books.service.ts` — remove the owner path from `assertCanManageBookPublic` for these endpoints (staff-only).
- **Upload plumbing** (net-new, was assumed to exist): add `graphqlUploadExpress()` to `apps/api/src/main.ts` (dep `graphql-upload-ts` is already installed but not wired); add a multipart upload link to the web Apollo client (none exists). v1 is **PDF-only** — `uploadBookFile` rejects EPUB today.
- **Completion writer** (resolves [ADM-3]): in the reader progress mutation (`reader-mutations.service.ts`), set `BookProgress.completedAt = now()` when progress reaches the book's page count (`pageCount` when READY, else `totalPages`), and clear it if progress regresses below. This makes `completed`/`completionRate` real.

## GraphQL API

### Types

```graphql
enum UserStatus { ACTIVE SUSPENDED }

type AdminUser {
  id: ID!
  email: String!
  displayName: String!
  avatarUrl: String
  role: UserRole!
  status: UserStatus!
  lastLoginAt: DateTime
  createdAt: DateTime!
  groupCount: Int!
}

type AuditLogEntry {
  id: ID!
  actorId: ID
  actor: User
  action: String!
  targetType: String
  targetId: String
  payload: JSON
  ipAddress: String
  userAgent: String
  createdAt: DateTime!
}

type AdminPlatformOverview {
  totalUsers: Int!
  activeUsers: Int!
  suspendedUsers: Int!
  totalBooks: Int!
  publishedBooks: Int!
  publishedAnnouncements: Int!
  totalGroups: Int!
}

type AdminBookStats {
  bookId: ID!
  title: String!
  readers: Int!            # distinct PageView.userId
  completed: Int!          # distinct BookProgress.userId with completedAt != null (subset of readers)
  completionRate: Int!     # round(completed / readers * 100); 0 when readers = 0
  totalPageViews: Int!     # PageView count for the book
  avgPagesPerReader: Int!  # round(totalPageViews / readers); 0 when readers = 0
}

type AdminUserPage { items: [AdminUser!]!, total: Int!, page: Int!, pageSize: Int! }
type AuditLogPage { items: [AuditLogEntry!]!, total: Int!, page: Int!, pageSize: Int! }
```

### Operations

```graphql
type Query {
  adminUsers(filter: AdminUsersFilter, page: Int = 1, pageSize: Int = 25): AdminUserPage!
  auditLogs(filter: AuditLogFilter, page: Int = 1, pageSize: Int = 25): AuditLogPage!
  adminPlatformOverview: AdminPlatformOverview!
  adminBookStats(bookId: ID!): AdminBookStats!
  adminGroups(filter: AdminGroupsFilter, page: Int = 1, pageSize: Int = 25): AdminGroupPage!
}

type Mutation {
  adminSetUserRole(input: AdminSetUserRoleInput!): AdminUser!
  adminSetUserStatus(input: AdminSetUserStatusInput!): AdminUser!
}

input AdminUsersFilter { role: UserRole, status: UserStatus, query: String }
input AuditLogFilter { action: String, actorId: ID, targetType: String, targetId: String, from: DateTime, to: DateTime }
input AdminGroupsFilter { query: String, visibility: GroupVisibility }
input AdminSetUserRoleInput { userId: ID!, role: UserRole! }
input AdminSetUserStatusInput { userId: ID!, status: UserStatus! }
```

`adminUser(id)` is **not** included — the list already returns everything the console needs (**[ADM-14]**).

### Behavior

- **`adminUsers`** — `ADMIN, MODERATOR`. Includes `email` and `status` (the public `listUsers` strips both). `query` matches `displayName`/`emailNormalized` case-insensitively. `groupCount` is batched via a single `groupBy` over `GroupMember` for the page (**[ADM-14]**).
- **`adminSetUserRole`** — `ADMIN`. In a serializable transaction: count `role = ADMIN AND status = ACTIVE AND deletedAt IS NULL`; if the target is the last active admin and the new role ≠ ADMIN, reject. Retry on Prisma `P2034` up to a bounded number of attempts. Record `USER_ROLE_CHANGED`. **[ADM-10]**
- **`adminSetUserStatus`** — `ADMIN`. Same predicate/transaction/retry; reject suspending the last active admin. On `SUSPENDED`: `revokeAllSessionsForUser(userId)` (refresh families) **and** `readerSession.revokeAllForUser(userId)`. Record `USER_STATUS_CHANGED`. **[ADM-5]**, **[ADM-10]**
- **`auditLogs`** — `ADMIN, MODERATOR`. `actor` is batch-resolved (one `findMany` per page), not per row. **[ADM-14]**
- **`adminPlatformOverview`** — `ADMIN, MODERATOR`. `count()` calls; `publishedBooks` = `status = PUBLISHED AND deletedAt IS NULL`.
- **`adminBookStats`** — `ADMIN, MODERATOR`. Definitions as in the type comments; all divisions guarded.
- **`adminGroups`** — `ADMIN, MODERATOR`. All non-deleted groups incl. private, with active + pending member counts.

## Frontend Surface

UI implementation is routed to the `@designer` lane; this section defines intent and constraints, not final visual decisions. The orchestrator reviews and fixes copy after design, preserving visual/interaction intent.

### A. Route + guard

- `apps/web/src/app/(app)/admin/` with `layout.tsx` + `page.tsx` (dashboard) and nested `books`, `announcements`, `users`, `groups`, `audit`.
- New `useRequireRole(...roles)` beside `useRequireAuth` (`lib/hooks/use-require-auth.ts:35-57`). Non-staff → `/feed`; unauthenticated → `/login`. UX-only; tests must assert **server** denial, not just redirect (a stale persisted role can show the shell but every query fails). **[ADM-15]**

### B. Navigation

- Add an Admin entry rendered only for `ADMIN`/`MODERATOR`. **Sidebar-only** — do not inherit into `BOTTOM_NAV_ITEMS` (`lib/constants.ts:89` aliases the sidebar list). `apps/web/src/lib/constants.spec.ts:13-15` asserts exactly 7 nav items, so that spec is updated in the same change. **[ADM-16]**

### C. Tabs

| Tab | Contents | Backing operations |
|---|---|---|
| **Dashboard** | Overview stat cards; recent audit entries | `adminPlatformOverview`, `auditLogs` |
| **Books** | Catalog table (status, access, conversion); PDF upload; edit/retire; retry conversion; stats drawer | `books`/`uploadBook`/`uploadPdf`/`updateBook`/`deleteBook`/`retryBookConversion`, `adminBookStats` |
| **Announcements** | List + composer (title, body, category, `publishAt`, `expiresAt`); publish/unpublish/delete | existing feed operations |
| **Users** | Table (email, name, role, status, groups, last login); role dropdown; suspend/reactivate | `adminUsers`, `adminSetUserRole`, `adminSetUserStatus` |
| **Groups** | All-groups list (incl. private); member table; pending queue; kick/ban/unban; member-role (ADMIN) | `adminGroups` + existing group queries + moderation mutations |
| **Audit Log** | Filterable table (action, actor, target, date range) with pagination | `auditLogs` |

Reuse `AuthenticatedLayout`/`AppShell`, MD3 tokens, existing table/card/`Sheet` patterns, toasts. Loading/empty/error states required per tab. **[ADM-6]** PDF-only upload dialog in v1.

### D. Destructive-action confirmation

Role changes, suspension, ban, delete, unpublish: confirm with the target's identity. Delete is soft-delete; copy must say so.

## Offline & Error Handling

- Online-only surface; offline shows a shell-level error. No offline caching.
- Mutations surface typed GraphQL errors inline (last-admin rejection, invalid date range, EPUB rejection).
- Failed audit `record` never blocks the mutation.
- Optimistic UI only for unambiguous toggles; tables refetch after mutation.

## Testing Plan (resolves [ADM-17])

Aligned with `docs/superpowers/specs/2026-06-29-testing-strategy-design.md`. Resolver unit tests call methods directly and **do not execute guards**, so authorization must be proven at the GraphQL/HTTP layer.

1. **API unit** — `audit.service`: field mapping; never throws on DB failure; `list` filters/order/pagination/cap; reuse audit only when `revokedAt` set.
2. **API unit** — `admin-users.service`: last-admin predicate exact; `P2034` retry; suspend revokes refresh families + reading sessions; audit per action; list filters.
3. **API unit** — `admin-analytics.service`: counts; readers from `PageView`; completion-rate/avg with zero readers (no divide-by-zero); rounding.
4. **API unit** — auth: `jwt.strategy` rejects `SUSPENDED`; local login rejects `SUSPENDED`; `findOrCreateOAuthUser` does not mint tokens for `SUSPENDED`; reader-session `resolve` rejects a suspended user.
5. **API unit** — groups: `assertCanModerate` bypass for global ADMIN/MODERATOR; MODERATOR cannot change roles or delete; OWNER targets still protected.
6. **API **integration** (testcontainers + supertest, GraphQL layer)** — for each guarded operation, a MEMBER/MODERATOR/ADMIN matrix that actually exercises `RolesGuard`: `uploadBook` (ADMIN only), `uploadPdf`/`updateBook`/`deleteBook`/`retryBookConversion` (staff), `admin*` (staff; role/status mutations ADMIN-only), `adminGroups` (staff). These new spec files **must be added to the hardcoded integration list** in `.github/workflows/opencode-review.yml:162-171` or CI will not run them.
7. **API integration** — role change reflected on the target's next `me`; suspend → existing access token rejected, refresh fails, reader cookie rejected mid-read; concurrent last-admin demote+suspend cannot reach zero admins; each audited action writes exactly one row.
8. **Web unit** — `useRequireRole`; tab states; role dropdown/confirmation; `constants.spec.ts` updated.
9. **E2E (Playwright)** — MEMBER cannot reach `/admin`; ADMIN can; a role change made in the UI appears after reload.

## Build Order

1. **`@Roles` + `@UseGuards` on books endpoints** (closes the live security gap; no dependency on schema) — **[ADM-18]**.
2. Schema: `UserStatus` enum + `AuditLog` index; shared enum + `index.ts` barrel; SDL export; codegen.
3. `AuditModule` + post-commit call sites; `REFRESH_REUSE_DETECTED` and `LOGOUT` actor correctness.
4. Auth suspension: `jwt.strategy`, local login, `findOrCreateOAuthUser`, `revokeAllSessionsForUser`, `ReaderSessionService.revokeAllForUser` + status re-check.
5. Group service: threaded global role + `adminGroups`.
6. `admin` module: `AdminUsersService` → `AdminAnalyticsService` → resolver.
7. Completion writer in `reader-mutations.service`.
8. Upload plumbing: `graphqlUploadExpress`, web upload link.
9. Web: `useRequireRole`, `/admin` shell, sidebar-only nav, `constants.spec` update.
10. Designer-built tabs; verification throughout.

## Risks & Follow-ups

- **Enum migration**: case-tolerant `USING` cast, `DROP/SET DEFAULT`, no manual index recreation, preflight recorded; ACCESS EXCLUSIVE lock. Verify on a restored copy.
- **Concurrent last-admin**: serializable + `P2034` retry; integration test the racing pair.
- **Audit growth**: retention/prune is a follow-up. `AuditLog.user` is `onDelete: Cascade`, so if hard-delete ever lands, audit history for that user vanishes — follow-up.
- **`PageView` aggregates on B1ms**: `@@index([bookId, viewedAt])` exists; revisit with a rollup if stats become hot.
- **Suspension of an open WebSocket**: new requests are blocked and tokens revoked; an already-open subscription may persist until the socket drops. Accepted v1.
- **Staff moderation breadth**: global MODERATOR can now see private groups and act on members but not change roles or delete; owner protection is preserved. Revisit if that is too broad.
- **OAuth token churn**: a suspended OAuth user no longer mints tokens, but an existing pre-suspension refresh family is revoked by `revokeAllSessionsForUser`.

## SonarQube Compliance

Per `docs/SONAR-GUIDELINES.md`:

- No `window` (use `globalThis`); no array-index keys (key by `id`).
- Cognitive complexity ≤ 15 — aggregate and filter building extracted to helpers.
- No nested ternaries (S6644) — status/role label selection extracted.
- Props `readonly`; native `<progress>`/`<output>`.
- Zod/validation avoids deprecated APIs (use `.gte()`/`.lte()`).
- Every AI-review finding recorded in `docs/SONAR-GUIDELINES.md` **in the same change** — the design-review findings are recorded now as `ADM-1`…`ADM-18`.

---

## Approval Gate

This document is the design of record. No implementation starts until:

1. This revised spec is reviewed and approved, then
2. The implementation plan (via the `writing-plans` skill) is reviewed and an execution method is selected.
