# Task 4 — Transactional IndexedDB, account ownership, and cross-tab fencing

## Status

Implemented and committed. Portable storage/lease/account logic is covered by
Jest; real-browser IndexedDB E2E is authored but **BLOCKED** (Docker and the
owned HTTPS harness are unavailable in this environment).

- Commit: `ade3c0122d775c2da7b4dacdebebfedcf4ced30c` — `feat(offline): add account-scoped transactional storage`
- Branch: `feature/pwa-lane-b`

## What was implemented

- `apps/web/src/lib/offline/contracts.ts` — one versioned schema contract
  (`OFFLINE_DB_VERSION = 1`), typed records for lifecycle owner/epoch/barriers/
  deferred-logout/leases, download manifests + active/staged book versions,
  Bible chapter datasets, book version metadata + page blobs/text, reader
  records, tombstones, conflict copies, outbox operations, and receipts.
  Account-namespaced key helpers and typed storage/lifecycle errors.
- `apps/web/src/lib/offline/database.ts` — `openOfflineDatabase()` (single
  versioned DB, 11 object stores, subject indexes; `VersionError` →
  `SchemaVersionError` without clearing data; `onblocked` fails closed) plus
  `runTransaction()` which resolves **only on `transaction.oncomplete`** and
  never offers an async escape hatch, so a transaction can't straddle network
  I/O. `OfflineDatabase` exposes subject+epoch-fenced writes
  (`putAccountRecord`, `commitEditWithOutbox`, `commitOutbox`,
  `acknowledgeOperation`), atomic `compareAndSetLease`, and `clearSubject`.
- `apps/web/src/lib/offline/coordination.ts` — portable IndexedDB lease
  coordinator with monotonic fencing tokens, expiry, renewal, release, and
  `assertFencingToken`. Web Locks may enhance this, but the lease is authority.
- `apps/web/src/lib/offline/account-context.ts` — lifecycle ownership
  (`AccountContext`) separated from display-only `AuthDisplayState`;
  `assertWriteEligibility` rejects wrong-subject/stale-epoch writes; epochs
  advance on owner change and clear.
- `apps/web/src/lib/offline/storage-status.ts` — `requestPersistentStorage`,
  `getStorageEstimate`, `getStorageStatus` (reports `supported/persisted/
  usage/quota` without promising eviction immunity), `assertIndexedDbAvailable`.
- `apps/web/src/store/reader-store.ts` — removed authoritative `lastPage`
  state/action/partialize; persisted version bumped to 2 and `merge` rebuilds
  only `{theme,mode,zoom}` so legacy `lastPage` is discarded, not adopted.
- `apps/web/src/store/bible-store.ts` — added account `subject`; switching
  subjects resets `lastPosition`/`indexStatus`; rehydrate drops ambiguous
  legacy unscoped positions. No outbox surface exists here.
- `apps/web/src/lib/bible/storage.ts` — per-subject navigation prefs
  (`loadPrefs`/`savePrefs`/`clearAccountPrefs`) and `searchIndexKey`; search KV
  stays a separate rebuildable cache.
- `apps/web/src/lib/bible/search/client.ts` — routes corpus through
  `searchIndexKey`, keeping search cache distinct from saved-chapter authority.
- `reader-client.tsx` — stopped calling the removed `setLastPage` (strictly
  required to keep the build green); server save remains best-effort.
- `apps/web/e2e/pwa-storage.spec.ts` — real-browser tests for abort-after-
  success, multi-store rollback, blocked upgrade without data loss, single
  lease winner across two tabs, and persistence reporting.

## TDD evidence

- RED first: coordination/account-context specs failed on missing modules, and
  store specs failed on removed `lastPage`/missing `setAccountSubject`. One
  coordination assertion caught a real bug — `release` deleted the lease and
  reset the fencing counter; fixed to persist an expired tombstone so tokens
  stay monotonic.
- `pnpm --filter @transformlit/web test --runInBand` — **105 suites / 779 tests passed**.
- `pnpm --filter @transformlit/web typecheck` — passed.
- `pnpm --filter @transformlit/web build` — passed (Next.js 16.3.6).

## Commands from the brief

```bash
pnpm --filter @transformlit/web test --runInBand --runTestsByPath \
  src/lib/offline/coordination.spec.ts src/store/reader-store.spec.ts \
  src/store/bible-store.spec.ts src/lib/bible/storage.spec.ts
# PASS (42 focused tests, including database/storage-status/account-context)

pnpm --filter @transformlit/web build
# PASS

pnpm --filter @transformlit/web test:e2e --config playwright.pwa.config.ts e2e/pwa-storage.spec.ts
# BLOCKED — see below
```

## Blocked / not run

- **Real-browser IndexedDB E2E is BLOCKED.** Docker is not installed
  (`docker: command not found`), so the owned HTTPS harness
  (`apps/api/test/scripts/pwa-harness.ts`, `https://localhost:3443`) cannot
  start and `playwright.pwa.config.ts` has no `webServer`. Node/jsdom cannot
  exercise real IndexedDB; `fake-indexeddb` is **not** an existing dependency
  and adding it was out of scope. `pwa-storage.spec.ts` is committed and
  discovered will require the harness.
- Secondary discovery gap (owned by Task 1B/14, not changed here):
  `playwright.pwa.config.ts` sets `testMatch: '**/*.pwa.spec.ts'`, so the
  brief-named `e2e/pwa-storage.spec.ts` is not matched even once Docker exists.
  This must be reconciled when the harness runs; flagged, not edited.
- Storage-unavailable/quota browser paths are covered by unit tests
  (`classifyStorageError`, `getStorageStatus`) but not the blocked browser run.

## Scope notes

- No `apps/api/**` files touched (Lane A).
- No `apps/web/src/lib/reader/api.ts` or `apps/web/src/components/**` changes.
- Task 3's `PwaProvider.registerUpdateBarrier` seam is not consumed yet; the
  brief does not require registration in Task 4.
- Commits are scoped to Task 4 so Task 13A can build on `account-context.ts`.
