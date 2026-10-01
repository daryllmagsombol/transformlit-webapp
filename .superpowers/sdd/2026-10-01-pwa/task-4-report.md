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
- Storage-unavailable/quota browser paths were originally claimed as
  unit-covered; that was inaccurate for `openOfflineDatabase`. Round 1 adds
  mocked unit coverage of open/unavailable/VersionError/blocked paths (see
  below). Real-browser IDB runtime behavior remains BLOCKED.

## Scope notes

- No `apps/api/**` files touched (Lane A).
- No `apps/web/src/lib/reader/api.ts` or `apps/web/src/components/**` changes.
- Task 3's `PwaProvider.registerUpdateBarrier` seam is not consumed yet; the
  brief does not require registration in Task 4.
- Commits are scoped to Task 4 so Task 13A can build on `account-context.ts`.

## Round 1 fix — review findings (C1–C3, I1–I4)

### Status

All four Critical/Important review items addressed. No new dependencies. Real
browser IndexedDB verification remains **BLOCKED** (Docker unavailable).

### RED / GREEN evidence

RED captured by reverting the fixed `database.ts`/`reader-store.ts` to `HEAD`
and running the new specs: **7 failed / 16 passed**. Failures were exactly the
new behaviors:

- C1: `runTransaction` resolved `undefined` when a handler enqueued a request
  without calling `done()`.
- I1: a blocked upgrade hung instead of rejecting.
- I2: subject-integrity guards absent (3 failures).
- I4: `reader-store` had no `migrate`, so v1 presentation prefs were dropped.

GREEN after restoring the fixes: the same focused specs pass (23/23), then the
full suite passes (105 suites / 794 tests).

### Changes

- **C1 — self-enforcing commit.** `runTransaction` now rejects with
  `OfflineStorageError('Transaction completed without a result')` when
  `oncomplete` fires without `done()` having been called; `done` is idempotent
  and required. A throwing handler still rejects (and aborts) even if a later
  request succeeds. New tests cover never-`done`, value-on-complete, and throw.
- **C2 — invalid E2E rollback test.** Reworked the multi-store rollback test in
  `pwa-storage.spec.ts`: it now creates a unique index and enqueues a
  duplicate-index-key write that genuinely fails at request time (aborting the
  transaction), then asserts `aborted === true` and both stores count `0`.
  Still authored/E2E and still BLOCKED here.
- **C3 — account-subject reset unwired.** `setAccountSubject` carries an
  explicit forward-reference comment stating it is currently UNWIRED and that
  Task 13A MUST invoke it on every activation path. Added a store-level
  integration test exercising the public seam across an A→B switch. The report
  no longer claims the reset is end-to-end complete. No auth components edited.
- **I1 — open cache poisoning.** `openOfflineDatabase` now caches only a
  pending/resolved attempt and clears the cache from the attempt's own
  rejection handler (guarded against races), so post-failure callers retry
  fresh and concurrent callers share one open. Blocked upgrades reject
  immediately and close any late-success database. Mocked unit tests cover
  absent IndexedDB, failure-then-retry, concurrent sharing, `VersionError`, and
  blocked.
- **I2 — subject integrity.** `assertRecordSubject` verifies `record.subject`
  matches the lifecycle subject and that a string `id` is namespaced by
  `keyBelongsToSubject`; `putAccountRecord`, `commitEditWithOutbox`,
  `commitOutbox`, and `acknowledgeOperation` call it before enqueuing. Unit
  tests cover mismatch, unscoped key, outbox mismatch, and the pass-through.
- **I3 — coverage honesty.** Report wording corrected (see above); added the
  feasible mocked `openOfflineDatabase` unit coverage without a new dependency
  via `apps/web/test/helpers/fake-indexeddb.ts` (a tiny, purpose-built fake,
  not a general IDB implementation).
- **I4 — presentation prefs preserved.** `reader-store` gained
  `migratePersistedState` that keeps `{theme,mode,zoom}` and drops `lastPage`,
  with tests for a legacy v1 payload and an empty payload.

### Deferred minors (recorded, not fixed)

- Unused speculative exports in `contracts.ts` (`isStaleEpoch`,
  `classifyHttpFailure`, `assertSubject`).
- Failure-label cosmetics.
- E2E lease test fidelity (single-winner test is a simplified CAS model).
- Resource hygiene and the missing trailing newline in
  `test/helpers/fake-indexeddb.ts`.

### Round 1 verification

- RED: reverted code → 7 failures as above.
- `pnpm --filter @transformlit/web test --runInBand` — **105 suites / 794 tests passed**.
- `pnpm --filter @transformlit/web typecheck` — passed.
- `pnpm --filter @transformlit/web build` — passed (Next.js 16.3.6).
- `git diff --check` — passed.
- Real-browser `pwa-storage.spec.ts` — **BLOCKED** (Docker/harness unavailable);
  no browser result is claimed.
