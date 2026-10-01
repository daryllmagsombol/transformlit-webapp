# Task 8 implementation report — replay-safe reader mutation contracts

Lane A (API/contracts). Worktree: `.worktrees/pwa-lane-a`, branch `feature/pwa-lane-a`.

## Status

DONE_WITH_CONCERNS. DB-free work implemented and verified. DB-backed integration tests, migration
application, and **canonical SDL regeneration** are BLOCKED because Docker/Testcontainers is not
installed; none are claimed as passing.

## What was implemented

- **Schema** (`apps/api/prisma/schema.prisma`):
  - `ReaderOperationReceipt` unique by `(subject, operationId)` with `payloadHash` + stored JSON
    `result`; no TTL.
  - `ReaderTombstone` unique by `(subject, entityId)` retaining deletion revision.
  - `ConflictCopy` (immutable id, `operationId`, `sourceEntityId`, `reason`, revisioned).
  - `ReaderEntityKind` / `ConflictReason` enums.
  - `BookProgress.revision` (default 0) + `clientEntityId`; `Bookmark`/`Highlight` gained
    `clientEntityId` (unique per user), `revision` (default 1), and `deletedAt` soft-delete.
- **Migration** `apps/api/prisma/migrations/20261001000200_pwa_reader_sync/migration.sql`
  (name unused; generated DB-free with `prisma migrate diff`). Additive only: `CREATE TABLE`/
  `CREATE TYPE`/`ADD COLUMN` with NOT NULL defaults — no destructive changes.
- **Typed GraphQL envelope** (`apps/api/src/books/models/book.model.ts`): `ReaderOperationInput`
  (flattened, per the contracts file), `OperationKind`, `OperationTargetKind`,
  `OperationResultKind`, `PageTextAnchorV1(Input)`, records (`BookmarkRecord`,
  `HighlightRecord`, `ConflictCopy`, `ProgressRecord`, `ReaderTombstone`), the
  `ReaderServerValue` and `ReaderOperationResultVariant` unions, and
  `ReaderOperationResult`.
- **`ReaderMutationsService`** (`apps/api/src/books/reader-mutations.service.ts`):
  - `applyOperation(subject, input)`: validates the envelope and exact per-kind field presence,
    hashes a canonical payload, checks the receipt, current book access, and supported content
    versions, then applies in ONE transaction and records the receipt.
  - Replay of `(subject, operationId)` with the same hash returns the stored result; a different
    hash is rejected.
  - Conditional revision writes: progress starts at revision 0, stale base yields `CONFLICT`
    (never highest/last-write-wins).
  - Soft-delete bookmarks/highlights with tombstones; a delayed add against a tombstoned identity
    conflicts rather than resurrecting.
  - Stale annotation edit / edit-after-delete / delete-after-edit preserve both sides and create a
    durable linked `ConflictCopy`. `ANNOTATION_UPDATE` with `targetKind=CONFLICT_COPY`
    conditionally retargets and increments the copy revision.
  - Terminal `ACCESS_DENIED` / `INCOMPATIBLE_VERSION` outcomes are re-evaluated on replay (not
    receipted), matching "terminal until state changes".
- **Resolver** (`books.resolver.ts`): new `applyBookReaderOperation(input)` mutation, JWT-guarded,
  ownership from `CurrentUser` only. Registers `ReaderMutationsService` in `BooksModule`.
- **Legacy policy**: `BooksService.saveProgress`, `addBookmark`, `removeBookmark`, `addHighlight`,
  `removeHighlight` now throw `UpgradeRequiredError` with stable `extensions.code=UPGRADE_REQUIRED`
  — no mutation, no receipt. Reads (`listBookmarks`/`listHighlights`) remain and now exclude
  soft-deleted rows.
- **Integration tests authored** (`test/reader-sync.integration.spec.ts`,
  `test/pwa-migration.integration.spec.ts`, fixture
  `test/fixtures/pwa-migration/legacy-reader-rows.json`), and
  `test/reader-schema.integration.spec.ts` extended. All use Task 1A's disposable-DB guard and the
  real `db:migrate:deploy` path; none target an arbitrary `DATABASE_URL`.

## TDD / verification evidence

RED: the new `reader-mutations.service.spec.ts` failed to compile/run before
`ReaderMutationsService` existed; `books.service.spec.ts` / `books.resolver.spec.ts` failed on the
new legacy-rejection and resolver-constructor expectations before the implementation.

A DB-free schema probe (compiled `AppModule`) caught a real GraphQL metadata defect: union-typed
`string | null` fields (`clientEntityId`, `label`, `color`, `note`, `text`, `reason`, dates) needed
explicit `() => String`/`() => Date` field types under SWC, otherwise schema construction threw
"Undefined type". Fixed; the runtime schema now exposes every Task 8 type.

GREEN (DB-free):
```
pnpm --filter @transformlit/api test --runInBand
Test Suites: 40 passed, 40 total   Tests: 649 passed, 649 total

pnpm --filter @transformlit/api exec jest --config jest.contract.config.ts \
  --runInBand --runTestsByPath test/helpers/schema-runtime.spec.ts test/helpers/schema-drift.spec.ts
Test Suites: 2 passed, 2 total   Tests: 5 passed

pnpm --filter @transformlit/api run typecheck   # exit 0
pnpm --filter @transformlit/api run build       # 122 files compiled
pnpm prisma validate                            # valid
git diff --check                                # clean
```

Runtime schema built via the compiled `AppModule` confirms `applyBookReaderOperation`,
`ReaderOperationInput`, `ReaderOperationResult`, `ReaderOperationResultVariant`, `ReaderServerValue`,
`BookmarkRecord`, `HighlightRecord`, `ConflictCopy`, `ProgressRecord`, `OperationKind`,
`OperationTargetKind` are all present.

## BLOCKED (not executed, not claimed as passing)

- **Canonical SDL regeneration** (`apps/api/src/schema.gql`): Task 8 changes the GraphQL schema, but
  the only sanctioned path (`pnpm --filter @transformlit/api run graphql:schema:export` /
  `graphql:schema:check`) starts a Testcontainers Postgres and fails closed with
  "Could not find a working container runtime strategy". Per instructions I did NOT hand-edit SDL.
  `schema.gql` is therefore **stale** and must be regenerated via the guarded export during
  convergence / Task 14A. The non-mutating `test:command-runner` probe currently reports the
  expected "Canonical GraphQL SDL is stale" once it reaches the schema-matcher (AppModule bootstrap
  itself succeeds).
- DB-backed `test/reader-sync.integration.spec.ts`, `test/pwa-migration.integration.spec.ts`, and
  the migration apply all fail closed at the disposable-DB guard ("Could not start owned disposable
  database"). Docker is unavailable; no default/shared database was used.

## Concerns / follow-ups

- `schema.gql` regeneration is the main convergence dependency; until then `graphql:schema:check`
  in CI (Docker-capable) will fail on the expected drift.
- `ReaderMutationsService` routes through Prisma; advanced DB races (concurrent receipt insertion,
  conditional writes under contention) are exercised only by the authored-but-blocked integration
  suite; the unit suite uses a stateful in-memory fake.
- Legacy reads still return the legacy shapes; Task 9 owns the authoritative snapshot query and
  generated client operations.
- Sonar: no `window`, no unused imports, `node:crypto` used, readonly ctor params not applicable
  (Prisma/Books are immutable-style reads).

## Files

- Modified: `apps/api/prisma/schema.prisma`, `apps/api/src/books/models/book.model.ts`,
  `apps/api/src/books/books.resolver.ts`, `apps/api/src/books/books.resolver.spec.ts`,
  `apps/api/src/books/books.service.ts`, `apps/api/src/books/books.service.spec.ts`,
  `apps/api/src/books/books.module.ts`, `apps/api/test/books.integration.spec.ts`,
  `apps/api/test/reader-schema.integration.spec.ts`
- Created: `apps/api/prisma/migrations/20261001000200_pwa_reader_sync/migration.sql`,
  `apps/api/src/books/reader-mutation.errors.ts`,
  `apps/api/src/books/reader-mutations.service.ts`,
  `apps/api/src/books/reader-mutations.service.spec.ts`,
  `apps/api/test/reader-sync.integration.spec.ts`,
  `apps/api/test/pwa-migration.integration.spec.ts`,
  `apps/api/test/fixtures/pwa-migration/legacy-reader-rows.json`

## Commit

`feat(api): add replay-safe reader mutation contracts` (see git log for SHA).

---

## Round 1 fix — race-safe, conflict-serializable reader mutations

Fixed a Critical TOCTOU race, receipt-race divergence, conflict-serialization/scoping issues on
branch `feature/pwa-lane-a` (HEAD before fix: `3847529`).

### C1 — conditional (non-TOCTOU) revision writes

`ReaderMutationsService` no longer reads a revision then issues an unconditional `update` by id.
Every write is now a DB-conditional `updateMany({ where: { id, userId, bookId, revision: baseRevision },
data: { ..., revision: { increment: 1 } } })`:

- progress and highlight/bookmark updates branch to `CONFLICT` when `count === 0`, re-reading the
  current server row for the conflict value (never a lost update, never highest/last-wins).
- progress creation is conditional on the `(userId, bookId)` unique constraint; bookmarks/highlights
  on `(userId, clientEntityId)`.
- conflict-copy retargets are likewise conditional.

### C1b — concurrent receipt/create race

`applyOperation` wraps the transaction in a try/catch: on a unique violation the transaction is
already rolled back, so the loser re-reads the winner's durable receipt and returns the winner's
**stored** result (mismatched hash → `BadRequestException`). Entity-create `P2002` races that cannot
be mapped to a receipt surface as a retryable `ConflictException`, not a raw 500, and never commit a
second/divergent row.

### C1c — required concurrency coverage

- Unit (stateful fake): two same-base progress writes → one `APPLIED`, one `CONFLICT`, loser's page
  not written; highlight read-then-write race → `CONFLICT`; receipt race → loser adopts winner's
  stored result; duplicate entity-create → `ConflictException` (not 500). Authored in
  `reader-mutations.service.spec.ts`.
- Integration: `test/reader-sync.integration.spec.ts` now has a real simultaneous
  `Promise.all` same-base progress race (one `APPLIED`/one `CONFLICT`, revision 2, winner's page
  retained) and a simultaneous duplicate-operation-ID test (one stored result, one row/receipt).
  Authored; runs only with Docker.

### I1 — delete-after-edit conflict serialization

`ConflictCopy.anchor` is now nullable in the GraphQL model (was non-null), so a typed `CONFLICT`
with a delete-vs-edit copy serializes. `DELETE_VS_EDIT` copies store the **current server
annotation's honest page/text/anchor**, not a blank `text:''`/`page:1` derived from the delete
request. Contracts doc updated.

### I2 — migrated legacy rows

`BookmarkRecord.clientEntityId` and `HighlightRecord.clientEntityId` are now nullable so a conflict
on a migrated row (null provenance) serializes without inventing an ID. Contracts doc updated.

### I3 — entity operations scoped to the declared book

`applyBookmarkRemove`/`applyAnnotationUpdate`/`applyAnnotationDelete`/`updateConflictCopy` now match
`id + userId + bookId` (conflict copies also match `bookId`), and conflict copies are stamped with
the entity's real `bookId`, so a stale/cross-book op cannot mutate another book's entity. New
integration test asserts a cross-book remove returns `ACCESS_DENIED` and leaves the row untouched.

### I4 — terminal-outcome receipts (documented deviation)

`ACCESS_DENIED`/`INCOMPATIBLE_VERSION` remain **unreceipted** because they are terminal only until
access/version state changes and must be re-evaluated on replay. This deliberate deviation is now
explicitly documented in `docs/superpowers/specs/2026-10-01-pwa-contracts.md`.

### Minors fixed

- Removed the dead `rejectLegacyMutation` method (legacy rejection lives in `reader-error` types used
  by `BooksService`; no caller remained).
- Removed the no-op `assertNullableShape` (validation already enforces required-field presence).
- `BOOKMARK_ADD`/`ANNOTATION_CREATE` now compare payload before returning `APPLIED` for an existing
  entity; a differing payload on the same client identity returns `CONFLICT` instead of a silent
  `APPLIED`.
- Retargeted conflict copy now keys `sourceEntityId` off the original annotation, not the prior copy.

### Round 1 verification

RED (new tests vs the pre-fix service, `git show 3847529:...`):
`Test Suites: 1 failed, Tests: 7 failed, 17 passed` — including both lost-update tests, the receipt
race, and the entity-create race.

GREEN:
```
pnpm --filter @transformlit/api test --runInBand
Test Suites: 40 passed, 40 total   Tests: 653 passed, 653 total

pnpm --filter @transformlit/api exec jest --config jest.contract.config.ts \
  --runInBand --runTestsByPath test/helpers/schema-runtime.spec.ts test/helpers/schema-drift.spec.ts
Test Suites: 2 passed, 2 total   Tests: 5 passed

pnpm --filter @transformlit/api run typecheck   # exit 0
pnpm --filter @transformlit/api run build       # 122 files compiled
prisma validate                                 # valid
git diff --check                                # clean
```
The DB-free compiled-AppModule schema probe confirms `BookmarkRecord.clientEntityId: String` and
`ConflictCopy.anchor: PageTextAnchorV1` are now nullable in the runtime SDL.

`test/reader-sync.integration.spec.ts` compiles and fails only at the disposable-DB guard (Docker
unavailable). Canonical `schema.gql` remains BLOCKED (guarded export needs Docker) and was not
hand-edited.

### Round 1 files

- Modified: `apps/api/src/books/reader-mutations.service.ts`,
  `apps/api/src/books/reader-mutations.service.spec.ts`,
  `apps/api/src/books/models/book.model.ts`,
  `apps/api/test/reader-sync.integration.spec.ts`,
  `docs/superpowers/specs/2026-10-01-pwa-contracts.md`

### Round 1 commit

`fix(api): make reader mutations race-safe and conflict-serializable`
