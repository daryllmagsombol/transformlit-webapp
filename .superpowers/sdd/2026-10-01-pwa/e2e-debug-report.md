# Production-PWA E2E follow-up — CI run 37037490814

## Evidence and scope

Read Oracle-confirmed traces for CI run **37037490814**: nine setup timeouts
originated from a recovery barrier left by a prior scenario sharing the same
persistent browser profile. Also reviewed CI run **37032368483** error contexts
for reading, storage READY marker, and sync receipt. This round changes only
E2E fixtures/specs, Sonar configuration and documentation. No production code,
account specs, dependencies, Docker harness or remote/GitHub commands were
changed/run. The local harness launch previously hung over 15 minutes; another
launch is expressly prohibited.

## Cause → fix ledger

| Test/finding | Cause and classification | Fix | Product change |
| --- | --- | --- | --- |
| `pwa-reading`: cold offline restart | Raw REST login plus a second `/login` bootstrap raced refresh-cookie rotation. The CI setup timeout was also caused by cross-scenario profile leakage. | Use the real login UI pattern from `auth.spec.ts`, capture `/api/auth/login` response and return its token. Give each test a unique profile child under the harness-owned root, and use that same child for cold restart. | No |
| Reading and `pwa-storage`: READY publication | Substring `Saved offline` also matched `Not saved offline`, allowing inspection before the durable publish. Test-locator false positive. | Exact READY text matching; keep READY marker and positive active-version assertions unchanged. | No |
| `pwa-sync`: acknowledgement | Focus dispatch starts an asynchronous foreground drain; the immediate receipt read returned null. Test synchronization race. | Bounded 15-second `expect.poll` on the durable receipt with the original `operationId` and `APPLIED` assertions; then require an empty outbox. Remove the unnecessary swallowed save-offline click: UI login already initializes the schema. | No |
| Sync second device (later section, not reached in the supplied failing trace) | Fresh context had no credentials, and `/books` neither renders annotations nor represents authoritative second-device visibility. Test setup/assertion-target mismatch. | Independently authenticate the fresh context with the form helper and query the authoritative generated snapshot for receipt entity ID/text. Do not copy first-device storage. | No |
| Cross-test recovery barrier | All scenarios reused the same `PWA_BROWSER_PROFILE`; the account test intentionally left a deferred logout barrier, so later fixture logins were correctly blocked. Fixture was masking the barrier by deleting cookies/display auth. | Allocate one random child profile per Playwright test under the harness-owned cleanup root. Preserve the child for that scenario's tabs/restarts. Do not clear auth state, dismiss recovery UI, or reset IndexedDB barriers inside login helper; fail with bounded barrier diagnostics. | No |
| Synthetic sync ownership | Injected outbox writes hard-coded epoch/sequence and could mismatch persisted owner/queue state. | Read ACTIVE lifecycle record, assert fixture subject, derive next sequence from subject queue, and use the persisted epoch. | No |
| Sonar gate | E2E fixture files were analyzed as uncovered production sources because spec-only exclusions do not cover helper files. Quality-gate scope configuration. | Exclude `/apps/web/e2e/**` from sources and `apps/web/e2e/**` from coverage, as test infrastructure. Record the finding in `docs/SONAR-GUIDELINES.md`. | No |

## Locally verified

- `pnpm --filter @transformlit/web typecheck`: **passed**.
- `pnpm --filter @transformlit/api test:harness`: **20/21 passed** after final
  edits. The sole failure is the out-of-scope source-text assertion in
  `apps/api/test/scripts/pwa-harness.spec.ts:264`, which requires the literal
  `/api/auth/refresh` in the E2E fixture. The real login UI returns the access
  token and installs session state without an extra refresh call; do not add a
  misleading comment/string or change that test outside the authorized scope.
- `pnpm --dir apps/web exec playwright test -c playwright.pwa.config.ts --list`:
  **passed**, 37 tests discovered in 9 files. Discovery is not an E2E pass.
- Diff inspection and `git diff --check`: **passed**.

## CI-only verification and concerns

- **Production HTTPS PWA harness: skipped by explicit instruction.** UI login,
  download completion, foreground replay, conflict behavior, cold restart and
  independent-device snapshot assertions still require a fresh CI harness run.
- **Sonar scan/gate: not run.** Only configuration changes were locally inspected.
- No production bug is proven by the supplied traces; the CI-confirmed cause was
  test-profile isolation leakage through an intentional account-exit barrier.
- The second-device assertion now checks server visibility through an
  authenticated generated snapshot rather than claiming annotation rendering on
  `/books`. Annotation UI hydration on a fresh reader remains separate runtime
  coverage, not a product behavior silently implemented here.
- Browser auth, barrier diagnostics, profile reuse/cold restart, epoch alignment,
  receipt polling and second-device snapshot remain CI-only until the parent
  verifies this commit.
- E2E source-string contract update should be handled in a separate authorized
  change if the owner confirms it is stale; it is not made green by a textual
  workaround in this fixture.
- Audited every `PWA_BROWSER_PROFILE` occurrence under `apps/web/e2e`: account,
  install, deployment, upgrade, worker and sync/reading guards only check harness
  configuration; the reading cold restart now uses the actual per-test
  `profilePath`. No other scenario directly launches a persistent context from
  the shared root within the allowed file scope. Account-test strengthening
  remains a separate lane.
