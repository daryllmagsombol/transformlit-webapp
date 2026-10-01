# Task 5 implementation report — immutable, complete, version-pinned book downloads

Lane A (API/contracts). Worktree: `.worktrees/pwa-lane-a`, branch `feature/pwa-lane-a`.

## Status

DONE_WITH_CONCERNS. All DB-free work implemented and verified. DB-backed integration and
migration application are **BLOCKED** because Docker/Testcontainers is not installed on this
machine, and were never claimed to pass.

## What was implemented

- **Immutable `BookContentVersion` persistence** (`apps/api/prisma/schema.prisma`):
  `BookContentVersion`, `BookContentVersionPage`, `BookContentVersionTocEntry`. Append-only
  snapshots; the existing `book_pages`/`book_toc_entries` remain the current-version projection.
  Page descriptors carry server-private `assetKey`/`textKey`, dimensions/MIME, `hasTextLayer`,
  and frame/text byte lengths + SHA-256 checksums. `eligible` gates download serving.
- **Migration** `apps/api/prisma/migrations/20261001000100_pwa_book_versions/migration.sql`.
  Verified the name was unused (only `20260624181242_init`, `20260625150829_...`,
  `20260625164437_...`, `20260901162434_...`, `20260910144453_...` existed). Creates the tables,
  indexes and FK cascades, then backfills READY/PDF books with pages from their **actual**
  current projection. Backfilled rows have `eligible = false` and NULL checksums because asset
  bytes live in object storage and SQL cannot hash them — no checksum or text is fabricated.
  Eligibility is only granted later by `backfillVersion` after verifying real bytes.
- **Publication is atomic** (`conversion.runner.ts`): the immutable version row (with pages/TOC)
  and the current-version pointer update commit in the **same** `prisma.$transaction`.
- **No eager deletion**: removed `storage.deletePrefix(books/<id>/v<prev>)`; retained versions
  stay downloadable.
- **Checksums during conversion** (`pdf.converter.ts`, `reader.types.ts`): `sha256Hex` via
  `node:crypto`; frame and text bytes are hashed and persisted. Empty text layers are persisted
  as the real `{"items":[]}` bytes and explicitly flagged `hasTextLayer: true`.
- **`BookDownloadService`** (`apps/api/src/books/book-download.service.ts`):
  - `getManifest(bookId, userId, contentVersion?)` — resolves the requested version or the
    latest eligible retained version; enforces current book access; fails 404 for unknown,
    ineligible, incomplete (page count mismatch / missing frame / missing text) versions.
  - `getAssetById(...)` — the contracts' opaque asset-id route; never trusts a storage key.
  - `getAsset(...)` — version-pinned page frame/text convenience route.
  - `backfillVersion(...)` — verifies real bytes, writes checksums, flips `eligible`; returns
    false and writes nothing if any asset is missing or the version is structurally incomplete.
  - `DownloadConcurrencyLimiter` — bounded in-flight download work independent of the
    reading-session/analytics budget.
  - Manifest output: `contractVersion`, `bookId`, `contentVersion`, title/author/description,
    `coverAssetId`, `totalPages`, complete `toc`, complete `pages`, complete `assets` with
    mediaType/byteLength/lowercase-hex sha256 and application-relative version-pinned `url`.
    Storage keys never appear in output.
- **Controller** (`books.controller.ts`): bearer-auth (`AuthGuard('jwt')`) + current
  `books.assertCanRead` — **never** the reading-session cookie. `no-store, private`,
  `Vary: Authorization`, `nosniff`, `Content-Length`, `ETag: "sha256-<hex>"`. Routes:
  - `GET /books/:id/offline-manifest?contentVersion=`
  - `GET /books/:id/content/:version/assets/:assetId` (contract route)
  - `GET /books/:id/offline/:version/pages/:n/frame`
  - `GET /books/:id/offline/:version/pages/:n/text`
  Download handlers do not touch `ReaderSessionService` or `PageViewService`; a spec asserts no
  session/page-view calls.
- **Bounded download throttling** (`app.module.ts`): named `download` bucket. Download handlers
  apply a per-route `limit: 30, ttl: 60000` override (`THROTTLER:LIMITdownload`) independent of
  the page-route `default` bucket. The named bucket's global registration stays at 120/60s so it
  cannot collaterally throttle unrelated routes; the strict cap is per-route.
- **Integration suite authored** (`apps/api/test/offline-download.integration.spec.ts`): uses
  Task 1A's `startOwnedDisposableDatabase` + `assertOwnedDisposableDatabaseUrl` only (no default
  DB); asserts migration created the new tables, atomic publication, complete/checksummed
  manifest with no storage keys, exact pinned bytes + sha256 ETag, no reading session/page view,
  401/403 authorization, and prior-version retention/read after a new publication.

## TDD evidence

RED (before implementation):

- `book-download.service.spec.ts` failed to compile: `Cannot find module './book-download.service'`.
- `books.controller.spec.ts` failed: `Expected 4 arguments, but got 5` and
  `Property 'getOfflineManifest'/'getOfflineFrame'/'getOfflineText'/'getOfflineAsset' does not exist`.
- `conversion.runner.spec.ts` was updated to require the immutable-version create + no
  `deletePrefix`; the pre-change runner had neither.

GREEN (after implementation), focused suite per the brief:

```
pnpm --filter @transformlit/api test --runInBand --runTestsByPath \
  src/books/book-download.service.spec.ts \
  src/books/books.controller.spec.ts \
  src/books/conversion/conversion.runner.spec.ts
Test Suites: 3 passed, 3 total
Tests:       35 passed, 35 total
```

Full DB-free API unit suite (regression):

```
pnpm --filter @transformlit/api test
Test Suites: 39 passed, 39 total
Tests:       629 passed, 629 total
```

Type/build:

```
pnpm --filter @transformlit/api run typecheck   # exit 0
pnpm --filter @transformlit/api run build       # Successfully compiled: 117 files
pnpm --filter @transformlit/api exec prisma validate --schema prisma/schema.prisma  # valid
git diff --check                                 # clean
```

Migration shape validated DB-free against the schema:

```
pnpm --filter @transformlit/api exec prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script
# emits the exact book_content_versions / book_content_version_pages /
# book_content_version_toc_entries DDL, indexes and FKs matching the migration.
```

`prisma migrate diff --from-migrations ...` (which would prove the migration applies and
matches the schema) requires a shadow database and therefore Docker — not run.

## BLOCKED (not executed, not claimed as passing)

- Docker/Testcontainers is absent (`command -v docker` → absent).
- `pnpm --filter @transformlit/api test:integration --runInBand --runTestsByPath
  test/offline-download.integration.spec.ts test/reader-security.integration.spec.ts` →
  all suites fail closed at `startOwnedDisposableDatabase` / `assertOwnedDisposableDatabaseUrl`
  (`Could not start owned disposable database...`; `Refusing database reset: URL is not owned by
  a live disposable Testcontainers instance`). No default/shared database was used.
- Migration application, backfill of live data, publication-during-download concurrency, and
  HTTP-level ETag/byte equality remain unverified until a Docker-capable environment runs the
  integration suite.

## Concerns / follow-ups

- The migration's legacy backfill leaves existing READY versions `eligible = false` because the
  asset bytes cannot be hashed in SQL. A Docker-backed operator run must call
  `BookDownloadService.backfillVersion(bookId, contentVersion)` per retained version (or an
  equivalent job) to verify and promote them. Until then those versions are correctly refused
  rather than served with fabricated metadata.
- `pnpm --filter @transformlit/api run lint` cannot run: the API workspace has no
  `eslint.config.js` (ESLint 10). Pre-existing; not introduced here.
- Immutable version rows capture title/author/description at publish time; a later metadata-only
  `updateBook` does not retroactively change an existing version (intended by immutability).
- `schema.gql`/`packages/graphql/operations/**` are untouched: Task 5's contract is REST, not
  GraphQL, and the brief scoped those to Task 8/9.

## Files

- Modified: `apps/api/prisma/schema.prisma`, `apps/api/src/app.module.ts`,
  `apps/api/src/books/books.controller.ts`, `apps/api/src/books/books.controller.spec.ts`,
  `apps/api/src/books/books.module.ts`, `apps/api/src/books/books.service.ts`,
  `apps/api/src/books/conversion/conversion.runner.ts`,
  `apps/api/src/books/conversion/conversion.runner.spec.ts`,
  `apps/api/src/books/conversion/pdf.converter.ts`,
  `apps/api/src/books/conversion/reader.types.ts`
- Created: `apps/api/prisma/migrations/20261001000100_pwa_book_versions/migration.sql`,
  `apps/api/src/books/book-download.service.ts`,
  `apps/api/src/books/book-download.service.spec.ts`,
  `apps/api/test/offline-download.integration.spec.ts`

## Commit

`86b3dd4c9d9207173190f4850891cc3b4408b752` — `feat(api): add version-pinned book download contract`
