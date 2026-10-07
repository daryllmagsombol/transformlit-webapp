# Admin & Moderation Console — Design Spec

**Date:** 2026-10-07
**Status:** Approved (design) — pending written-spec review
**Branch:** `feature/admin-console`
**Scope:** A staff-only `/admin` console plus the backend authorization, audit write-path, and analytics read-path it needs. Building blocks already exist: `Group`, `GroupMember` (with `BANNED`), `Book`/conversion tables, `Announcement` (with `publishAt`/`expiresAt`), `AuditLog`, `PageView`, and `BookProgress`.

---

## Overview

The platform has admin-capable operations scattered across domain modules with **no UI**, **inconsistent authorization**, and two tables that are **written but never read** (`PageView`) or **never written at all** (`AuditLog`).

Recon findings that define this work:

1. **No admin surface.** There is no `/admin` route in `apps/web/src/app` and no admin API module in `apps/api/src`. Staff actions can only be performed through the GraphQL playground.
2. **`RolesGuard`/`@Roles` is wired only in `feed.resolver.ts`** (`createAnnouncement` L31-32, `updateAnnouncement` L41-42, `publishAnnouncement` L52-53, `unpublishAnnouncement` L62-63, `deleteAnnouncement` L72-73). Everywhere else, authorization is inline service logic or absent.
3. **`uploadBook` is unguarded** beyond `JwtAuthGuard` (`books.resolver.ts:70-77`). Any authenticated user can create a DRAFT book. This is a live security gap this spec closes.
4. **`AuditLog` is write-only by schema and has no code at all** — no service, no writer, no reader. Grep for `auditLog|AuditLog` across `apps/api/src` returns nothing. The audit viewer is meaningless until the write path is built.
5. **`PageView` is written but never read.** Written only in `PageViewService.record` (`page-view.service.ts:9-13`) from `books.controller.ts:94-98`; no `findMany`/`count`/`aggregate` exists.
6. **`UsersService` has no administration methods.** Complete method list: `findById`, `findByEmail`, `searchUsers`, `updateProfile`, `listUsers`, `getProfile`. There is no role change, suspend, or delete. `User.status` exists (`schema.prisma:25`) but has **no writer**.
7. **Group moderation backend already exists** (`groups.service.ts`): `approveMember` L272-283, `removeMember` L285-300, `banMember` L302-313, `unbanMember` L315-326, `updateMemberRole` L328-350, with `assertCanModerate` L240-249 and `assertCanManageGroup` L252-270. The console is mostly a UI + guard job here.
8. **Seed already makes the admin OWNER of every group** (`seed.ts:154-162`) and the seeded admin account is `admin@transformlit.com` (role `ADMIN`, `seed.ts:19-30`).

### Non-goals (v1)

- Global search (separate sub-project).
- The stubbed CTAs (feed Share, friends Manage, "All groups").
- Paid-book checkout / purchase flow; the `Buy` button stays a stub.
- Email notifications; all admin notifications stay in-app.
- A per-action permission matrix; v1 uses role tiers.
- Cross-group analytics beyond book stats.
- Hard-deleting users (suspend only).
- Migrating the existing seed admin's memberships (the grant for the requesting user is handled as a separate operational task, not by this feature).

## Design Decisions

- **Role tiers, not a permission table.** Global `ADMIN` and `MODERATOR` are staff; the capability matrix is fixed in v1. Group OWNER/MODERATOR remain group-scoped and are **not** granted console access.
- **Guards on global-staff endpoints only.** `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles(...)` is applied where the action is a platform-staff action. Group-scoped moderation keeps its existing service checks (`assertCanModerate`) — adding global `@Roles` there would wrongly require a global role for group owners.
- **New `admin` module for admin-only operations.** User administration, audit, and analytics live in `apps/api/src/admin/`. This keeps `users.service.ts` focused and respects the module-boundary rule. It imports `AuthModule` only (`PrismaModule` is `@Global()`), matching `feed.module.ts`/`group-features`.
- **`AuditModule` is `@Global()`.** Any domain must be able to `record(...)` without importing another domain module. This is infrastructure, like `PrismaModule`, not a domain (mirrors the `azure` module pattern).
- **Audit is best-effort but loud.** A failed audit write must never fail the business action, but must log at error level. Audit rows are append-only and never updated or deleted by the app.
- **Suspension is enforced server-side.** `jwt.strategy.ts:20-26` currently loads `where { id, deletedAt: null }`; it must also reject `status != ACTIVE`, otherwise a suspended user keeps working until the access token expires.
- **Suspension revokes sessions.** Setting `SUSPENDED` revokes the user's refresh-token family so the suspension cannot be extended by refresh.
- **Role is read from the DB, not the JWT.** `jwt.strategy.validate` already re-loads the user and returns `{ id, role }`; the guard consumes `user.role`. No JWT claim change is needed, and a role change takes effect on the next request.
- **`status` becomes an enum.** `User.status String @default("active")` becomes `UserStatus @default(ACTIVE)`. Existing rows hold `"active"` (and tests also use `"ACTIVE"`); the migration cast tolerates both (see Migration notes).
- **Analytics are computed on read, not denormalized.** Book/overview stats aggregate `PageView` + `BookProgress` at query time. No new rollup tables; `PageView` row growth is already a known follow-up.
- **Console access is UX-gated, server-enforced.** Web hides the nav entry and routes for non-staff, but every operation is independently authorized server-side.
- **Last-admin protection.** The system must never be left with zero `ADMIN` users: role demotion/suspension of the final active admin is rejected.

## Authorization Matrix

| Capability | ADMIN | MODERATOR | Group OWNER/MOD | Member |
|---|---|---|---|---|
| Console access | ✅ full | ✅ limited | ✅ their groups only (via existing group UI) | ❌ |
| `uploadBook` | ✅ | ❌ | ❌ | ❌ |
| `updateBook` / `deleteBook` / `retryBookConversion` | ✅ | ✅ | ❌ | ❌ |
| Announcements (compose/schedule/publish/unpublish/delete) | ✅ | ✅ | ❌ | ❌ |
| User role change, suspend/reactivate | ✅ | ❌ | ❌ | ❌ |
| Group approvals / kick / ban / unban / member-role | ✅ any group | ✅ any group | ✅ own groups (existing) | ❌ |
| Audit log read | ✅ | ✅ | ❌ | ❌ |
| Analytics read | ✅ | ✅ | ❌ | ❌ |

Enforcement points:

- **Global-staff actions** → `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles(...)`.
- **Group-scoped actions** → unchanged `assertCanModerate`/`assertCanManageGroup` service checks.
- **RolesGuard** (`roles.guard.ts:8-21`) reads `ROLES_KEY` metadata and checks `requiredRoles.includes(user.role)`.

## Data Model (Prisma changes)

```prisma
enum UserStatus {
  ACTIVE
  SUSPENDED
}

model User {
  // was: status String @default("active")
  status UserStatus @default(ACTIVE)
  // existing: @@index([role, status])
}

model AuditLog {                        // additions only
  // existing fields unchanged:
  // id, userId, action, targetType, targetId, payload, ipAddress, userAgent, createdAt
  @@index([targetType, targetId])       // NEW — viewer filters by target
}
```

Migration notes:

- **The existing `status` values are not uniform.** The Prisma default is the lowercase string `"active"` (`schema.prisma:25`), which is what seeded/unset rows hold, but tests elsewhere use `"ACTIVE"` (`users.service.spec.ts:217` vs `auth.service.spec.ts:40`). The `USING` cast must therefore tolerate **both** casings: `CASE WHEN lower(status) = 'active' THEN 'ACTIVE'::"UserStatus" ELSE 'SUSPENDED'::"UserStatus" END`. There are no other expected values, so no data loss.
- The migration must be written so the repository's destructive-SQL guard recognizes it as a safe enum conversion (explicit `USING` cast), and the existing `@@index([role, status])` is recreated against the enum.
- `AuditLog` gains one index only. No structural change; the table already exists with all needed columns.

`User` already has the `auditLogs AuditLog[]` back-relation (`DB_DESIGN.md`), and the existing model relationships are unchanged.

### GraphQL contract change (breaking)

`User.status` is currently exposed as `status: String!` (`schema.gql:758`, declared in `auth/models/auth.model.ts:27`). Converting the column to `UserStatus` changes the GraphQL type to `UserStatus!`, so the spec must include:

- `registerEnumType(UserStatus, { name: 'UserStatus' })` alongside the existing `UserRole` registration (`auth.models/auth.model.ts:4`).
- Add `UserStatus` to `packages/shared/src/enums.ts` (mirroring `UserRole`) and to the shared GraphQL types (`packages/shared/src/types/graphql.ts`).
- Update any web-side consumer of `GraphQLUser.status` and regenerate `packages/graphql` codegen + `apps/api/src/schema.gql`.

This is a schema-contract change but not a data-contract regression: the only current reader of `User.status` outside the DB is the `me`/auth payload, and the values remain `ACTIVE`/`SUSPENDED`. Treat `User.status` (global account) and `GroupMember.status` (membership) as distinct — only the former changes.

## Backend Components

### New: `apps/api/src/audit/` (`@Global()`)

| File | Responsibility |
|---|---|
| `audit.module.ts` | Declares `AuditService`; exported globally. Follows the `azure` module shape. |
| `audit.service.ts` | `record(...)` best-effort append; `list(filters, pagination)`. |
| `audit-actions.ts` | Frozen action-name constants (single source of truth). |
| `audit.service.spec.ts` | Unit tests. |

`record` input: `{ actorId, action, targetType?, targetId?, payload?, ip?, userAgent? }`. `list` filters: `{ action?, actorId?, targetType?, targetId?, from?, to? }` with `page`/`pageSize`, ordered `createdAt DESC`, hard-capped `pageSize`.

Action taxonomy (v1): `LOGIN`, `LOGOUT`, `REFRESH_REUSE_DETECTED`, `USER_ROLE_CHANGED`, `USER_STATUS_CHANGED`, `BOOK_UPLOADED`, `BOOK_UPDATED`, `BOOK_DELETED`, `ANNOUNCEMENT_PUBLISHED`, `ANNOUNCEMENT_UNPUBLISHED`, `ANNOUNCEMENT_DELETED`, `GROUP_DELETED`, `GROUP_MEMBER_APPROVED`, `GROUP_MEMBER_KICKED`, `GROUP_MEMBER_BANNED`, `GROUP_MEMBER_UNBANNED`, `GROUP_MEMBER_ROLE_CHANGED`. Chat messages and page views are explicitly **not** audited (per `DB_DESIGN.md`, audit is for sensitive actions only).

### New: `apps/api/src/admin/`

| File | Responsibility |
|---|---|
| `admin.module.ts` | Imports `AuthModule`; providers: `AdminUsersService`, `AdminAnalyticsService`, resolver. |
| `admin-users.service.ts` | `list`, `findOne`, `setRole`, `setStatus` with last-admin guard and refresh-family revocation. |
| `admin-analytics.service.ts` | `platformOverview`, `bookStats` aggregates. |
| `admin.resolver.ts` | GraphQL surface, fully role-guarded. |
| `models/admin.model.ts` | `AdminUser`, `AuditLogEntry`, `AdminPlatformOverview`, `AdminBookStats`, filter inputs. |
| `dto/*.input.ts` | `AdminUsersFilter`, `AuditLogFilter`, `SetUserRoleInput`, `SetUserStatusInput` with class-validator + shared Zod parity. |
| `*.spec.ts` | Service + resolver unit tests. |

Register `AdminModule` in `app.module.ts` next to the other domain modules; register `AuditModule` alongside `PrismaModule`.

**No group-moderation service changes** — `GroupsService` already exposes approve/kick/ban/unban/role with correct checks. The web console calls the existing `approveGroupMember`, `removeGroupMember`, `banGroupMember`, `unbanGroupMember`, `updateGroupMemberRole` operations.

### Guard changes (existing files)

- `books.resolver.ts` — `uploadBook` (L70): add `@Roles(UserRole.ADMIN)`. `updateBook` (L79), `deleteBook` (L116), `retryBookConversion` (L59): add `@Roles(UserRole.ADMIN, UserRole.MODERATOR)`.
- `feed.resolver.ts` — no change; announcements are already `@Roles(ADMIN, MODERATOR)`.
- `groups.resolver.ts` — no change; keep group-scoped service checks.

### Auth changes

- `jwt.strategy.ts` — reject `status !== ACTIVE` in `validate`.
- `auth.service.ts` — no change to login flow required, but login should also reject `SUSPENDED` users with a typed error (defense in depth so a suspended user cannot obtain a fresh token pair).
- Audit `LOGIN`/`LOGOUT` are recorded from `auth.service`/`auth.controller`; `REFRESH_REUSE_DETECTED` where reuse is already detected.
- `admin-users.service.setStatus(SUSPENDED)` revokes the user's refresh-token family (reuse the existing family-revocation logic).

## GraphQL API

All operations are JWT-guarded and role-guarded on the resolver.

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
  activeUsers: Int!          # ACTIVE status
  suspendedUsers: Int!
  totalBooks: Int!
  publishedBooks: Int!
  publishedAnnouncements: Int!
  totalGroups: Int!
}

type AdminBookStats {
  bookId: ID!
  title: String!
  readers: Int!              # distinct users with a BookProgress row
  completed: Int!            # BookProgress.completedAt NOT NULL
  completionRate: Int!       # completed / readers, clamped 0..100 (0 when readers = 0)
  totalPageViews: Int!
  avgPagesPerReader: Int!
}

type AdminUserPage { items: [AdminUser!]!, total: Int!, page: Int!, pageSize: Int! }
type AuditLogPage { items: [AuditLogEntry!]!, total: Int!, page: Int!, pageSize: Int! }
```

### Operations

```graphql
type Query {
  adminUsers(filter: AdminUsersFilter, page: Int = 1, pageSize: Int = 25): AdminUserPage!
  adminUser(id: ID!): AdminUser
  auditLogs(filter: AuditLogFilter, page: Int = 1, pageSize: Int = 25): AuditLogPage!
  adminPlatformOverview: AdminPlatformOverview!
  adminBookStats(bookId: ID!): AdminBookStats!
}

type Mutation {
  adminSetUserRole(input: AdminSetUserRoleInput!): AdminUser!
  adminSetUserStatus(input: AdminSetUserStatusInput!): AdminUser!
}

input AdminUsersFilter { role: UserRole, status: UserStatus, query: String }
input AuditLogFilter {
  action: String
  actorId: ID
  targetType: String
  targetId: String
  from: DateTime
  to: DateTime
}
input AdminSetUserRoleInput { userId: ID!, role: UserRole! }
input AdminSetUserStatusInput { userId: ID!, status: UserStatus! }
```

### Behavior

- **`adminUsers`** — `ADMIN, MODERATOR`. Includes `email` and `status` (the public `listUsers` deliberately strips both via `PUBLIC_USER_SELECT`). `query` matches `displayName`/`emailNormalized` case-insensitively.
- **`adminUser(id)`** — `ADMIN, MODERATOR`.
- **`adminSetUserRole`** — `ADMIN` only. Rejects changing the **last ACTIVE ADMIN** away from `ADMIN`. Records `USER_ROLE_CHANGED`.
- **`adminSetUserStatus`** — `ADMIN` only. Rejects suspending the **last ACTIVE ADMIN**. On `SUSPENDED`, revokes the target's refresh-token family. Records `USER_STATUS_CHANGED`. Self-suspension is allowed only if another active admin remains.
- **`auditLogs`** — `ADMIN, MODERATOR`. Ordered `createdAt DESC`; `pageSize` clamped to a server maximum.
- **`adminPlatformOverview`** — `ADMIN, MODERATOR`. Counts via `count()`; `publishedBooks` = `status = PUBLISHED AND deletedAt IS NULL`.
- **`adminBookStats`** — `ADMIN, MODERATOR`. `readers` = distinct `BookProgress.userId` for the book; `completionRate` guarded against divide-by-zero; `avgPagesPerReader` = `PageView` count / readers (0 when readers = 0).

## Frontend Surface

UI implementation is routed to the `@designer` lane; this section defines intent and constraints, not final visual decisions. The orchestrator reviews and fixes user-facing copy after design work without altering visual or interaction intent.

### A. Route + guard

- Route group: `apps/web/src/app/(app)/admin/` with `layout.tsx` + `page.tsx` (dashboard) and nested `books`, `announcements`, `users`, `groups`, `audit` segments.
- New `useRequireRole(...roles)` hook beside `useRequireAuth` (`lib/hooks/use-require-auth.ts:35-57`), built on the same hydration/persist logic. Non-staff users are redirected to `/feed`; unauthenticated users to `/login`.
- The role is available client-side as `GraphQLUser.role` (`packages/shared/src/types/graphql.ts:8`, held in `store/auth.ts:11`). The guard is UX only; the server remains authoritative.

### B. Navigation entry

- Add a role-filtered `Admin` item to `SIDEBAR_NAV_ITEMS` (`lib/constants.ts:79-87`), rendered only when `user.role` is `ADMIN` or `MODERATOR`. Because `BOTTOM_NAV_ITEMS` aliases the same constant (`lib/constants.ts:89`), the mobile bottom nav is filtered by the same rule or the Admin item is desktop-sidebar-only (final call to @designer).

### C. Tabs

| Tab | Contents | Backing operations |
|---|---|---|
| **Dashboard** | Overview stat cards; recent audit entries | `adminPlatformOverview`, `auditLogs` (small page) |
| **Books** | Catalog table (status, access level, conversion status); upload dialog (PDF/EPUB); edit/retire; retry conversion; per-book stats drawer | existing `books`/`uploadBook`/`updateBook`/`deleteBook`/`retryBookConversion`, `adminBookStats` |
| **Announcements** | List with status; composer (title, body, category, `publishAt`, `expiresAt`); publish/unpublish/delete | existing feed operations |
| **Users** | Table (email, display name, role, status, groups, last login); role dropdown; suspend/reactivate | `adminUsers`, `adminUser`, `adminSetUserRole`, `adminSetUserStatus` |
| **Groups** | Group list; member table per group; pending-approval queue; kick/ban/unban; member-role change | existing group queries + moderation mutations |
| **Audit Log** | Filterable table (action, actor, target, date range) with pagination | `auditLogs` |

Reuse `AuthenticatedLayout`/`AppShell`, MD3 tokens, existing table/card/`Sheet` patterns, and the toast system. Loading/empty/error states are required for every tab.

### D. Destructive-action confirmation

Role changes, suspension, ban, delete, and unpublish must present a confirmation with the target's identity. Delete is soft-delete (existing behavior); the copy must say so.

## Offline & Error Handling

- The console is an **online-only** surface; offline it shows a shell-level error, consistent with other authenticated pages. No offline caching.
- Mutations surface typed GraphQL errors inline (e.g. last-admin rejection, invalid date range).
- A failed audit `record` never blocks the business mutation; it is logged at error level and the mutation still succeeds.
- Optimistic UI only for unambiguous toggles (e.g. status pills); tables refetch after mutation.

## Testing Plan

Aligned with `docs/superpowers/specs/2026-06-29-testing-strategy-design.md`.

1. **API unit — `audit.service.spec.ts`**: `record` maps all fields and never throws on DB failure; `list` applies every filter, orders `createdAt DESC`, applies pagination and the `pageSize` cap.
2. **API unit — `admin-users.service.spec.ts`**: `setRole` rejects demoting the last active admin; `setStatus(SUSPENDED)` rejects suspending the last active admin, revokes the refresh family on success, and records audit; list filter by role/status/query.
3. **API unit — `admin-analytics.service.spec.ts`**: `platformOverview` counts; `bookStats` distinct readers, completion rate with zero readers (no divide-by-zero), average with zero readers.
4. **API unit — auth**: `jwt.strategy.validate` rejects a `SUSPENDED` user; login rejects a `SUSPENDED` user; `REFRESH_REUSE_DETECTED` writes an audit row.
5. **Resolver guard tests**: `admin*` operations reject `MEMBER`; `adminSetUserRole`/`adminSetUserStatus` reject `MODERATOR`; `uploadBook` rejects `MEMBER` and `MODERATOR`; `updateBook`/`deleteBook`/`retryBookConversion` reject `MEMBER`.
6. **Integration (testcontainers, existing pattern)**: ADMIN changes a user's role → reflected on that user's next `me`; suspend → their existing access token is rejected and refresh fails; upload as MEMBER → denied; each audited action writes exactly one `AuditLog` row with the right `action`/`target`.
7. **Web unit**: `useRequireRole` redirects non-staff; each tab renders empty/loading/error/data; role dropdown and confirmation flows.
8. **E2E (Playwright, existing harness)**: MEMBER cannot reach `/admin` (redirect); ADMIN can, and a role change made in the UI is visible after reload.

## Build Order

Schema (`UserStatus` + `AuditLog` index) → `AuditModule` + write path wired into existing mutations → `jwt.strategy`/login suspension enforcement → `admin` module (`AdminUsersService` → `AdminAnalyticsService` → resolver + guards) → `@Roles` on books endpoints → web `useRequireRole` + `/admin` shell + nav → designer-built tabs → verification throughout.

## Risks & Follow-ups

- **Enum migration on a populated table.** Rows are `"active"`/`"ACTIVE"` (not uniform), so the migration must carry the case-tolerant explicit `USING` cast so it is recognized as safe and lossless. Verify on a restored copy before deploy.
- **Audit volume.** High-traffic events are deliberately excluded. `AuditLog` still grows; a retention/prune job is a follow-up, not v1.
- **`PageView` aggregates on B1ms.** `adminBookStats` scans `PageView` per book. Acceptable at current volume; add an index on `PageView.bookId` (already present) and revisit with a rollup if stats become a hot path.
- **Role change latency.** `jwt.strategy.validate` re-loads `{ id, role }` from the DB on every request and `RolesGuard` does not cache, so a role change takes effect on the next request with no token revocation required.
- **Last-admin guard is not a distributed lock.** Two concurrent demotions could each pass the check. Mitigation in v1: perform the check-and-write in a single serializable transaction.
- **Suspended users with open WebSockets.** Suspension revokes the refresh family and blocks new requests; an already-open subscription may persist until the connection drops. Accepted for v1; documented.

## SonarQube Compliance

Per `docs/SONAR-GUIDELINES.md`:

- No `window` references in client code (use `globalThis`).
- No array index in React keys — tables key by `id`.
- Cognitive complexity ≤ 15 per function — analytics aggregation and audit filter building extracted into helpers.
- No nested ternaries (S6644) — status/role label selection extracted to helpers.
- Props marked `readonly`.
- Zod validation must avoid deprecated APIs (S6665–S6690): use `.gte()`/`.lte()`, not `.min()`/`.max()`.
- Native `<progress>`/`<output>` where a progress indicator is used.
- Any finding surfaced during review is appended to `docs/SONAR-GUIDELINES.md` **in the same change**.

---

## Approval Gate

This document is the design of record. No implementation starts until:

1. This written spec is reviewed and approved, then
2. The implementation plan (via the `writing-plans` skill) is reviewed and an execution method is selected.
