# Admin & Moderation Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a staff-only `/admin` console with correct backend authorization, an audit write/read path, real analytics, and suspension that actually locks a user out.

**Architecture:** A new `admin` NestJS domain module owns user administration and analytics; a new `@Global()` `audit` infrastructure module provides a post-commit `AuditService`. Existing books endpoints gain explicit `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles(...)`. Group moderation threads the actor's global role through the existing service gates. Web adds `useRequireRole` and an `/admin` route group; visual work is delegated to the `@designer` lane.

**Tech Stack:** NestJS 11 + Apollo (code-first), Prisma 7 / PostgreSQL, Next.js 16 App Router, Jest, testcontainers, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-07-admin-console-design.md` (rev. 2). Review IDs `ADM-1`…`ADM-18` live in `docs/SONAR-GUIDELINES.md`.

## Global Constraints

- `@Roles(...)` alone is inert; every guarded operation needs `@UseGuards(JwtAuthGuard, RolesGuard)` (ADM-1).
- No `window` in client code — use `globalThis` (S6653).
- No array index in React keys — key by `id` (S6479).
- Cognitive complexity ≤ 15 per function; no nested ternaries (S6644); props `readonly`; native `<progress>`/`<output>`; Zod uses `.gte()`/`.lte()`, never `.min()`/`.max()` (S6665–S6690).
- Audit writes happen **post-commit**, via the root `PrismaService`, never inside a business transaction (ADM-8).
- Every AI-review finding must be appended to `docs/SONAR-GUIDELINES.md` in the same change (repo rule).
- New integration spec files must be added to the hardcoded list in `.github/workflows/opencode-review.yml` or CI will not run them (ADM-17).
- Existing conventions: `@@map` snake_case; `@InputType()` classes (no class-validator on GraphQL inputs); tags/aliases via `@transformlit/shared`; the shared barrel in `packages/shared/src/index.ts` re-exports enums explicitly.

## Review Focus

The spec implies these inputs/failure modes but no single task's happy-path test covers them; each is pinned in the task noted.

1. **Concurrent last-admin removal** (two ADMINs demoting/suspending each other simultaneously) must never reach zero active admins — Tasks 5, 13.
2. **A suspended user with an already-open reader cookie** must stop receiving pages — Task 6.
3. **A plain MEMBER calling `uploadBook`/`uploadPdf`/`admin*`** must be denied at the GraphQL layer, not just hidden in UI — Tasks 1, 5, 9.
4. **Migration of non-uniform `status` values** (`"active"` and `"ACTIVE"`) must not mis-map or lose rows — Task 2.
5. **A suspended user logging in via OAuth** must not receive a new token pair — Task 7.

---

### Task 1: Guard the books admin mutations

**Files:**
- Modify: `apps/api/src/books/books.resolver.ts:59-124`
- Test: `apps/api/src/books/books.resolver.guard.spec.ts` (create)

**Interfaces:**
- Consumes: `JwtAuthGuard` (`../auth/guards/jwt-auth.guard.js`), `RolesGuard` (`../auth/guards/roles.guard.js`), `Roles` decorator (`../common/decorators/roles.decorator.js`), `UserRole`.
- Produces: guarded `retryBookConversion`, `uploadBook`, `updateBook`, `uploadPdf`, `deleteBook`.

- [ ] **Step 1: Write the failing test**

Assert each method carries the decorator metadata (guards are not executed by direct calls — this pins the wiring; the GraphQL-layer test is Task 12).

```ts
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '../common/decorators/roles.decorator.js';
import { BooksResolver } from './books.resolver.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { UserRole } from '@transformlit/shared';

const guardsOf = (m: string) =>
  Reflect.getMetadata(GUARDS_METADATA, BooksResolver.prototype[m]) ?? [];
const rolesOf = (m: string) =>
  Reflect.getMetadata(ROLES_KEY, BooksResolver.prototype[m]);

describe('BooksResolver admin guards', () => {
  it('guards uploadBook with JwtAuthGuard + RolesGuard(ADMIN)', () => {
    expect(guardsOf('uploadBook')).toEqual(expect.arrayContaining([JwtAuthGuard, RolesGuard]));
    expect(rolesOf('uploadBook')).toEqual([UserRole.ADMIN]);
  });

  it.each(['updateBook', 'deleteBook', 'retryBookConversion', 'uploadPdf'])(
    'guards %s with staff roles',
    (m) => {
      expect(guardsOf(m)).toEqual(expect.arrayContaining([JwtAuthGuard, RolesGuard]));
      expect(rolesOf(m)).toEqual([UserRole.ADMIN, UserRole.MODERATOR]);
    },
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @transformlit/api test -- books.resolver.guard.spec.ts`
Expected: FAIL — guards/roles metadata undefined for `uploadBook`.

- [ ] **Step 3: Add guards to the resolver**

In `books.resolver.ts`, add imports for `RolesGuard` and `Roles`, then decorate:

```ts
// uploadBook  → @UseGuards(JwtAuthGuard, RolesGuard) @Roles(UserRole.ADMIN)
// updateBook, deleteBook, retryBookConversion, uploadPdf
//             → @UseGuards(JwtAuthGuard, RolesGuard) @Roles(UserRole.ADMIN, UserRole.MODERATOR)
```

Keep the existing `@UseGuards(JwtAuthGuard)` off these methods (replace, do not stack duplicates). Leave read queries untouched.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @transformlit/api test -- books.resolver.guard.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/books/books.resolver.ts apps/api/src/books/books.resolver.guard.spec.ts
git commit -m "fix(books): require staff role for book admin mutations (ADM-1)"
```

---

### Task 2: Add the `UserStatus` enum and `AuditLog` index

**Files:**
- Modify: `apps/api/prisma/schema.prisma:26` (User.status), `:815-830` (AuditLog)
- Modify: `packages/shared/src/enums.ts`, `packages/shared/src/index.ts:7-23`
- Modify: `apps/api/src/auth/models/auth.model.ts:4,26-27`
- Create: `apps/api/prisma/migrations/<timestamp>_admin_user_status/migration.sql`
- Test: `apps/api/test/admin-user-status.integration.spec.ts` (create)

**Interfaces:**
- Produces: `UserStatus` enum (`ACTIVE | SUSPENDED`) exported from `@transformlit/shared`; `User.status: UserStatus`.
- Consumes: nothing.

- [ ] **Step 1: Update the Prisma schema**

```prisma
enum UserStatus {
  ACTIVE
  SUSPENDED
}

model User {
  // ...
  status UserStatus @default(ACTIVE)   // was: status String @default("active")
}

model AuditLog {
  // ...existing fields unchanged...
  @@index([targetType, targetId])
}
```

- [ ] **Step 2: Generate the migration, then replace its SQL**

Run: `pnpm exec prisma migrate dev --schema=apps/api/prisma/schema.prisma --name admin_user_status --create-only`

Take the preflight and confirm the observed values first:

Run: `psql "$DATABASE_URL" -c "SELECT lower(status), count(*) FROM users GROUP BY 1;"`
Record the distinct values in the migration file as a comment. Then ensure the generated `ALTER COLUMN` uses the case-tolerant cast:

```sql
ALTER TABLE "users" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "users" ALTER COLUMN "status" TYPE "UserStatus"
  USING (CASE WHEN lower("status") = 'active' THEN 'ACTIVE'::"UserStatus"
              ELSE 'SUSPENDED'::"UserStatus" END);
ALTER TABLE "users" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';
```

Do **not** hand-write index recreation (Postgres rebuilds it). Remove any unrelated drift DDL the generator added (per `DEPLOY-MIGRATION-ADDITIVE-SCOPE`).

- [ ] **Step 3: Apply and export the schema**

Run: `pnpm exec prisma migrate dev --schema=apps/api/prisma/schema.prisma`
Run: `pnpm --filter @transformlit/api graphql:schema:export`

- [ ] **Step 4: Add the enum to shared + the API model**

In `packages/shared/src/enums.ts` add `UserStatus` (mirroring `UserRole`); add it to the explicit re-export list in `packages/shared/src/index.ts:7-23`. In `auth/models/auth.model.ts`:

```ts
registerEnumType(UserStatus, { name: 'UserStatus' });

@Field(() => UserStatus)
status: UserStatus;
```

- [ ] **Step 5: Write the failing integration test**

`apps/api/test/admin-user-status.integration.spec.ts` — using the existing testcontainers harness, seed a user with legacy `'active'`, apply migrations, assert `status = 'ACTIVE'` and the column type is `UserStatus`. Also assert the SDL in `apps/api/src/schema.gql` contains `status: UserStatus!`.

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @transformlit/api test:integration -- --runInBand admin-user-status.integration.spec.ts`
Expected: PASS. Run `pnpm --filter @transformlit/api graphql:schema:check` — Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/prisma packages/shared/src apps/api/src/auth/models/auth.model.ts apps/api/src/schema.gql apps/api/test/admin-user-status.integration.spec.ts
git commit -m "feat(schema): UserStatus enum, AuditLog target index, shared enum + SDL (ADM-9, ADM-11, ADM-12)"
```

---

### Task 3: Audit module — write and read path

**Files:**
- Create: `apps/api/src/audit/audit.module.ts`, `audit.service.ts`, `audit-actions.ts`, `audit.service.spec.ts`
- Modify: `apps/api/src/app.module.ts:94-152`

**Interfaces:**
- Consumes: `PrismaService` (global).
- Produces:
  - `AuditAction` — frozen object of action-name string constants (Task 5, 6, 9, 10, 11 use these).
  - `AuditService.record(input: RecordAuditInput): Promise<void>` where `RecordAuditInput = { actorId: string; action: string; targetType?: string; targetId?: string; payload?: Prisma.InputJsonValue; ip?: string; userAgent?: string }`.
  - `AuditService.list(filters: AuditFilters, page: number, pageSize: number): Promise<{ items: AuditLogEntryRow[]; total: number }>` where `AuditFilters = { action?: string; actorId?: string; targetType?: string; targetId?: string; from?: Date; to?: Date }`.

- [ ] **Step 1: Write the failing test**

```ts
describe('AuditService', () => {
  it('record never throws when the DB write fails', async () => {
    const prisma = { auditLog: { create: jest.fn().mockRejectedValue(new Error('down')) } } as any;
    const service = new AuditService(prisma);
    await expect(service.record({ actorId: 'u1', action: 'LOGIN' })).resolves.toBeUndefined();
  });

  it('list applies every filter and caps pageSize', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const prisma = { auditLog: { findMany, count } } as any;
    const service = new AuditService(prisma);
    await service.list({ action: 'LOGIN', actorId: 'u1', from: new Date('2026-01-01') }, 1, 500);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ action: 'LOGIN', userId: 'u1' }),
      take: 100,
      orderBy: { createdAt: 'desc' },
    }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @transformlit/api test -- audit.service.spec.ts`
Expected: FAIL — cannot find module `./audit.service.js`.

- [ ] **Step 3: Implement**

`audit-actions.ts` — frozen constants. `audit.service.ts`:

```ts
const MAX_PAGE_SIZE = 100;

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);
  constructor(private readonly prisma: PrismaService) {}

  async record(input: RecordAuditInput): Promise<void> {
    try {
      await this.prisma.auditLog.create({ data: { ...input } });
    } catch (error) {
      this.logger.error(`Audit write failed for ${input.action}: ${(error as Error).message}`);
    }
  }

  async list(filters: AuditFilters, page: number, pageSize: number) { /* where + skip/take + count */ }
}
```

`audit.module.ts` is `@Global()` providing/exporting `AuditService` (precedent: `StorageModule`). Register `AuditModule` in `app.module.ts` imports next to `PrismaModule`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @transformlit/api test -- audit.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/audit apps/api/src/app.module.ts
git commit -m "feat(audit): global AuditService with post-commit write and filtered list (ADM-2, ADM-8)"
```

---

### Task 4: Wire audit call sites

**Files:**
- Modify: `apps/api/src/auth/auth.service.ts` (local login, `refreshTokens`, `findOrCreateOAuthUser`), `apps/api/src/auth/auth.controller.ts` (logout)
- Modify: `apps/api/src/books/books.service.ts` (`uploadBookFile`, `updateBook`, `deleteBook`), `apps/api/src/feed/feed.service.ts` (publish/unpublish/delete)
- Test: extend existing `*.spec.ts` for each

**Interfaces:**
- Consumes: `AuditService` (Task 3), `AuditAction` constants.
- Produces: audit rows for the enumerated actions.

- [ ] **Step 1: Write failing tests** pinning: a successful `updateBook` records `BOOK_UPDATED`; a reuse (`stored.revokedAt` set) records `REFRESH_REUSE_DETECTED` but a plain expiry does **not**; logout records `LOGOUT` with the actor derived from the refresh-token row; audit is not called when the mutation throws.

- [ ] **Step 2: Run tests to verify they fail.**

Run: `pnpm --filter @transformlit/api test -- auth.service.spec.ts books.service.spec.ts feed.service.spec.ts`

- [ ] **Step 3: Implement post-commit `audit.record(...)` calls**

Inject `AuditService` into each service. Call it **after** the business operation resolves — never inside `this.prisma.$transaction`. Reuse guard: only emit when `stored.revokedAt` is set. Logout actor comes from the stored token's `userId`; `ip`/`userAgent` are passed from the controller or omitted.

- [ ] **Step 4: Run tests to verify they pass**, then `pnpm --filter @transformlit/api test` for the full unit suite.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/auth apps/api/src/books/books.service.ts apps/api/src/feed/feed.service.ts
git commit -m "feat(audit): record auth/book/announcement actions post-commit (ADM-8)"
```

---

### Task 5: Admin users service

**Files:**
- Create: `apps/api/src/admin/admin.module.ts`, `admin-users.service.ts`, `admin-users.service.spec.ts`
- Modify: `apps/api/src/auth/auth.service.ts` (add `revokeAllSessionsForUser`), `apps/api/src/books/reader-session.service.ts` (add `revokeAllForUser`)

**Interfaces:**
- Consumes: `PrismaService`, `AuditService`, `AuthService.revokeAllSessionsForUser`, `ReaderSessionService.revokeAllForUser`.
- Produces:
  - `AdminUsersService.list(filter: AdminUsersFilter, page: number, pageSize: number)`
  - `AdminUsersService.setRole(userId: string, role: UserRole, actorId: string)`
  - `AdminUsersService.setStatus(userId: string, status: UserStatus, actorId: string)`

- [ ] **Step 1: Write the failing test**

```ts
it('refuses to demote the last active admin', async () => {
  // count of (role=ADMIN, status=ACTIVE, deletedAt=null) === 1 and target is that admin
  await expect(service.setRole(lastAdminId, UserRole.MEMBER, actorId))
    .rejects.toThrow(/last active admin/i);
});

it('retries once on a serialization abort (P2034)', async () => {
  const tx = jest.fn()
    .mockRejectedValueOnce(Object.assign(new Error('serialization'), { code: 'P2034' }))
    .mockResolvedValueOnce(undefined);
  // ...assert $transaction was attempted twice
});
```

Also test `setStatus(SUSPENDED)` calls both `revokeAllSessionsForUser` and `readerSession.revokeAllForUser`, and refuses to suspend the last active admin.

- [ ] **Step 2: Run test to verify it fails.**

- [ ] **Step 3: Implement**

`setRole`/`setStatus` run check-and-write in one `this.prisma.$transaction(fn, { isolationLevel: 'Serializable' })`, counting `role: ADMIN, status: ACTIVE, deletedAt: null`, with a bounded retry helper for `P2034`/`code === 'P2034'`. Add `AuthService.revokeAllSessionsForUser(userId)` (revoke **all** refresh families: `updateMany({ where: { userId, revokedAt: null } })`) and `ReaderSessionService.revokeAllForUser(userId)` (same shape on `readingSession`). Record audit after success.

- [ ] **Step 4: Run test to verify it passes.**

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/admin apps/api/src/auth/auth.service.ts apps/api/src/books/reader-session.service.ts
git commit -m "feat(admin): user role/status service with last-admin guard and session revocation (ADM-10)"
```

---

### Task 6: Suspension enforcement across auth paths

**Files:**
- Modify: `apps/api/src/auth/strategies/jwt.strategy.ts:20-26`, `apps/api/src/auth/auth.service.ts:102-123,183-206`, `apps/api/src/books/reader-session.service.ts` (`resolve`)
- Test: extend `auth.service.spec.ts`, `jwt.strategy.spec.ts`, `reader-session.service.spec.ts`

**Interfaces:**
- Consumes: `UserStatus`.
- Produces: non-`ACTIVE` rejection at JWT validation, local login, OAuth minting, and reader-session resolution.

- [ ] **Step 1: Write failing tests** for: `JwtStrategy.validate` rejects a `SUSPENDED` user; `loginLocal` rejects `SUSPENDED`; `findOrCreateOAuthUser` throws for a `SUSPENDED` existing/identity user; `ReaderSessionService.resolve` returns `null` for a suspended user.

- [ ] **Step 2: Run tests to verify they fail.**

- [ ] **Step 3: Implement**

```ts
// jwt.strategy.js: where { id: payload.sub, deletedAt: null }, then
if (user.status !== UserStatus.ACTIVE) throw new UnauthorizedException();
```

Add the same gate in `loginLocal` before `generateTokens`, in both `findOrCreateOAuthUser` branches before `generateTokens`, and in `ReaderSessionService.resolve` (load the user's status after resolving the session; return `null` when not ACTIVE).

- [ ] **Step 4: Run tests to verify they pass.**

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/auth apps/api/src/books/reader-session.service.ts
git commit -m "fix(auth): enforce SUSPENDED across JWT, login, OAuth, and reader sessions (ADM-5)"
```

---

### Task 7: Global-staff group moderation

**Files:**
- Modify: `apps/api/src/groups/groups.service.ts:240-350`, `apps/api/src/groups/groups.resolver.ts`
- Test: `apps/api/src/groups/groups.service.spec.ts` (extend)

**Interfaces:**
- Consumes: `UserRole`.
- Produces:
  - `assertCanModerate(groupId: string, actorId: string, actorRole?: UserRole)`
  - `listMembers(groupId: string, requesterId: string, requesterRole?: UserRole)`
  - `adminGroups(filter: { query?: string; visibility?: GroupVisibility }, page: number, pageSize: number)`

- [ ] **Step 1: Write failing tests**: global ADMIN moderates a group they are not a member of; global MODERATOR too, but cannot change roles; OWNER targets remain protected; `listMembers` with staff role returns all statuses; `adminGroups` includes PRIVATE groups.

- [ ] **Step 2: Run tests to verify they fail.**

- [ ] **Step 3: Implement**

`assertCanModerate` returns a synthetic actor `{ role: 'MODERATOR' }`-equivalent for global staff (bypass membership) while keeping the existing member path. `updateMemberRole` still rejects a global MODERATOR (pass the actor role through). `listMembers` bypasses `canView` for staff. Add `adminGroups` querying all non-deleted groups with active/pending member counts. Resolver passes `user.role`; `adminGroups` gets `@UseGuards(JwtAuthGuard, RolesGuard) @Roles(ADMIN, MODERATOR)`.

- [ ] **Step 4: Run tests to verify they pass.**

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/groups
git commit -m "feat(groups): global staff moderation + adminGroups query (ADM-4)"
```

---

### Task 8: Admin analytics service

**Files:**
- Create: `apps/api/src/admin/admin-analytics.service.ts`, `admin-analytics.service.spec.ts`

**Interfaces:**
- Consumes: `PrismaService`.
- Produces: `AdminAnalyticsService.platformOverview()` and `AdminAnalyticsService.bookStats(bookId: string)`.

- [ ] **Step 1: Write failing tests**: counts; `readers` = distinct `PageView.userId`; `completionRate` and `avgPagesPerReader` are `0` when `readers = 0` (no divide-by-zero); integer rounding.

- [ ] **Step 2: Run tests to verify they fail.**

- [ ] **Step 3: Implement** using `count`, `groupBy`, and `findMany` with `distinct`; guard every division; round with the spec's definitions.

- [ ] **Step 4: Run tests to verify they pass.**

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/admin/admin-analytics.service.ts apps/api/src/admin/admin-analytics.service.spec.ts
git commit -m "feat(admin): platform + per-book analytics aggregates (ADM-3)"
```

---

### Task 9: Admin resolver, models, and module registration

**Files:**
- Create: `apps/api/src/admin/admin.resolver.ts`, `models/admin.model.ts`
- Modify: `apps/api/src/admin/admin.module.ts`, `apps/api/src/app.module.ts`
- Test: `apps/api/src/admin/admin.resolver.spec.ts`

**Interfaces:**
- Consumes: `AdminUsersService`, `AdminAnalyticsService`.
- Produces: GraphQL `adminUsers`, `auditLogs`, `adminPlatformOverview`, `adminBookStats`, `adminGroups`, `adminSetUserRole`, `adminSetUserStatus`.

- [ ] **Step 1: Write the failing test** pinning class-level `@UseGuards(JwtAuthGuard, RolesGuard)` and per-method `@Roles` (ADMIN for the two mutations, ADMIN+MODERATOR for queries), plus delegation with `user.id`.

- [ ] **Step 2: Run test to verify it fails.**

- [ ] **Step 3: Implement** the `@InputType()` filters/types exactly as in the spec's GraphQL section, the class-level guard, and per-method `@Roles`. Register `AdminModule` in `app.module.ts`. Export SDL: `pnpm --filter @transformlit/api graphql:schema:export`.

- [ ] **Step 4: Run test to verify it passes**, plus `graphql:schema:check`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/admin apps/api/src/app.module.ts apps/api/src/schema.gql
git commit -m "feat(admin): GraphQL surface for users, audit, analytics, groups (ADM-1)"
```

---

### Task 10: Book completion writer

**Files:**
- Modify: `apps/api/src/books/reader-mutations.service.ts:353-397` (`applyProgress`)
- Test: `apps/api/src/books/reader-mutations.service.spec.ts` (extend)

**Interfaces:**
- Consumes: `Book.pageCount`/`Book.totalPages`.
- Produces: `BookProgress.completedAt` set when `currentPage` reaches the effective page count; cleared on regression.

- [ ] **Step 1: Write failing tests**: applying progress at the final page sets `completedAt`; a later lower page clears it; mid-book does neither; missing page count leaves it null.

- [ ] **Step 2: Run tests to verify they fail.**

- [ ] **Step 3: Implement** by computing the effective page count (`conversionStatus === 'READY' ? pageCount : totalPages`) and including `completedAt` in the existing conditional `updateMany`/`create` data.

- [ ] **Step 4: Run tests to verify they pass.**

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/books/reader-mutations.service.ts apps/api/src/books/reader-mutations.service.spec.ts
git commit -m "feat(books): write BookProgress.completedAt so completion stats are real (ADM-3)"
```

---

### Task 11: Upload plumbing (API + web transport)

**Files:**
- Modify: `apps/api/src/main.ts` (add `graphqlUploadExpress`), `apps/web/src/lib/apollo-client.ts` (multipart link for the upload operation only)
- Test: `apps/api/test/books-upload.integration.spec.ts` (create)

**Interfaces:**
- Consumes: existing `uploadPdf` mutation (Task 1 guard).
- Produces: a working multipart upload from the web app; PDF-only in v1.

- [ ] **Step 1: Write the failing integration test**: an ADMIN multipart `uploadPdf` succeeds; a MEMBER gets a denied error; EPUB is rejected with the existing typed message.

- [ ] **Step 2: Run test to verify it fails.**

- [ ] **Step 3: Implement**: `app.use(graphqlUploadExpress({ maxFileSize: MAX_FILE_SIZE_BYTES }))` in `main.ts` before listen; add `apollo-upload-client`'s `createUploadLink` and route only the upload operation through it via `split`. Keep the existing HTTP link for everything else.

- [ ] **Step 4: Run test to verify it passes.**

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/main.ts apps/api/src/package.json apps/web/src/lib/apollo-client.ts apps/api/test/books-upload.integration.spec.ts
git commit -m "feat(upload): wire graphqlUploadExpress + web multipart upload link (ADM-6)"
```

---

### Task 12: Register integration tests in CI

**Files:**
- Modify: `.github/workflows/opencode-review.yml:162-171`
- Test: n/a (config)

- [ ] **Step 1: Add every new integration spec to the hardcoded list**: `admin-user-status.integration.spec.ts`, `books-upload.integration.spec.ts`, and the admin authz matrix spec from Task 13.

- [ ] **Step 2: Verify** the workflow file lists them under `test:integration --runInBand`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/opencode-review.yml
git commit -m "ci: run new admin/audit/upload integration suites (ADM-17)"
```

---

### Task 13: Authorization matrix integration tests

**Files:**
- Create: `apps/api/test/admin-authz.integration.spec.ts`

**Interfaces:**
- Consumes: all guarded operations.

- [ ] **Step 1: Write the test** exercising the GraphQL layer (testcontainers + supertest) for the role matrix: `uploadBook` (ADMIN only), `uploadPdf`/`updateBook`/`deleteBook`/`retryBookConversion`/`admin*` queries (staff), `adminSetUserRole`/`adminSetUserStatus` (ADMIN only), `adminGroups` (staff). Include the suspended-user-mid-read case and the concurrent last-admin race.

- [ ] **Step 2: Run it.** `pnpm --filter @transformlit/api test:integration -- --runInBand admin-authz.integration.spec.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/admin-authz.integration.spec.ts
git commit -m "test(admin): GraphQL-layer authorization matrix and suspension lockout (ADM-15, ADM-17)"
```

---

### Task 14: Web role guard, admin route shell, and nav

**Files:**
- Create: `apps/web/src/lib/hooks/use-require-role.ts`, `apps/web/src/app/(app)/admin/layout.tsx`, `apps/web/src/app/(app)/admin/page.tsx`
- Modify: `apps/web/src/lib/constants.ts:79-89`
- Test: `apps/web/src/lib/hooks/use-require-role.spec.tsx`, `apps/web/src/lib/constants.spec.ts`

**Interfaces:**
- Consumes: `useRequireAuth`, `store/auth.ts` (`user.role`).
- Produces: `useRequireRole(...roles: UserRole[]): { isReady: boolean }`.

- [ ] **Step 1: Write failing tests**: non-staff is redirected to `/feed`; unauthenticated to `/login`; ADMIN/`MODERATOR` renders. Update `constants.spec.ts` to assert the Admin entry is sidebar-only and not in the mobile bottom nav.

- [ ] **Step 2: Run tests to verify they fail.**

- [ ] **Step 3: Implement** `useRequireRole` on the same hydration logic as `useRequireAuth`, the `/admin` layout + dashboard shell reusing `AuthenticatedLayout`/`AppShell`, and a role-filtered Admin nav entry that does not inherit into `BOTTOM_NAV_ITEMS`. Full tab UI (books/announcements/users/groups/audit) is implemented by the `@designer` lane against the spec's Frontend Surface section; the orchestrator reviews copy after, without changing visual/interaction intent.

- [ ] **Step 4: Run tests to verify they pass.**

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/hooks/use-require-role.ts apps/web/src/lib/hooks/use-require-role.spec.tsx apps/web/src/app/'(app)'/admin apps/web/src/lib/constants.ts apps/web/src/lib/constants.spec.ts
git commit -m "feat(web): role guard + /admin shell + sidebar-only nav (ADM-15, ADM-16)"
```

---

### Task 15: E2E and quality gate

**Files:**
- Create: `apps/web/e2e/admin.spec.ts` (Playwright, existing harness)
- Modify: `docs/SONAR-GUIDELINES.md`

- [ ] **Step 1: Write the E2E test**: a MEMBER cannot reach `/admin` (redirect); an ADMIN can, and a role change made in the UI appears after reload.

- [ ] **Step 2: Run the focused suites**: `pnpm --filter @transformlit/api test`, `pnpm --filter @transformlit/api test:integration -- --runInBand` (the listed files), `pnpm --filter @transformlit/web test`, `pnpm --filter @transformlit/web test:e2e -- admin.spec.ts`.

- [ ] **Step 3: Run typecheck/build** for both apps; fix any type regressions from the `UserStatus` change.

- [ ] **Step 4: Append any new finding to `docs/SONAR-GUIDELINES.md`** in the same change (repo rule), with rule ID / fix / ❌✅ example.

- [ ] **Step 5: Commit**

```bash
git add apps/web/e2e/admin.spec.ts docs/SONAR-GUIDELINES.md
git commit -m "test(admin): E2E role gate + record review findings"
```

---

## Self-Review

**Spec coverage:** Guards (T1), schema/enum/migration/SDL (T2), audit (T3–T4), users service + last-admin (T5), suspension (T6), group moderation (T7), analytics (T8), resolver/models (T9), completion writer (T10), upload plumbing (T11), CI registration (T12), authz matrix (T13), web shell/guard/nav (T14), E2E + gate (T15). Non-goals (search, stub CTAs, checkout, EPUB) are correctly excluded.

**Type consistency:** `AuditService.list` returns `{ items, total }`; `AdminUsersService` method names match the resolver task; `UserStatus` is the single enum name everywhere; `assertCanModerate` keeps its third optional `actorRole` parameter across tasks.

**Review Focus:** covered — concurrency (T5/T13), suspended reader cookie (T6/T13), MEMBER denied at GraphQL (T1/T13), migration mapping (T2), OAuth suspension (T6).

**Open item the implementer must not guess:** whether `AdminUser.groupCount` batching uses `groupBy` on `GroupMember` filtered to `status: ACTIVE` — the spec's Users tab defines "groups" as active memberships; use that.
