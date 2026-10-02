# Production-PWA E2E follow-up — e131a5c

## Evidence and scope

Read the three error contexts from CI run **37032368483** under
`/tmp/pwres-e131/test-results/`: reading, storage READY marker, and sync receipt.
This round changes E2E infrastructure, Sonar scope and documentation only.
No production code, dependencies, Docker harness or remote/GitHub commands were
changed/run. The earlier local harness launch hung for over 15 minutes; this
round explicitly prohibits another launch.

## Cause → fix ledger

| Test/finding | Cause and classification | Fix | Product change |
| --- | --- | --- | --- |
| `pwa-reading`: cold offline restart | `loginAs` performed a raw REST login, then waited for a bootstrap redirect that did not complete. Test-fixture auth failure. | Reuse the real login UI pattern from `auth.spec.ts`: email, exact Password label, Log In, confirmed `/feed`. Capture `/api/auth/login` response and return its access token. | No |
| Reading and `pwa-storage`: READY publication | Substring `Saved offline` also matched `Not saved offline`, allowing inspection before the durable publish. Test-locator false positive. | Exact READY text matching; keep READY marker and positive active-version assertions unchanged. | No |
| `pwa-sync`: acknowledgement | Focus dispatch starts an asynchronous foreground drain; the immediate receipt read returned null. Test synchronization race. | Bounded 15-second `expect.poll` on the durable receipt with the original `operationId` and `APPLIED` assertions; then require an empty outbox. Remove the unnecessary swallowed save-offline click: UI login already initializes the schema. | No |
| Sync second device (later section, not reached in the supplied failing trace) | A fresh context had no credentials, and `/books` is a catalog, not an annotation view. Test setup/assertion-target mismatch. | Independently authenticate the fresh context using the same UI helper. Fetch the existing generated authoritative snapshot query with its token and require the exact acknowledged entity ID and text; reject transport/GraphQL errors. Close context in `finally`. No first-device storage state or fabricated annotations are copied. | No |
| Persistent-profile login | Prior refresh cookies and persisted display auth can trigger redirects/bootstrap while login is being prepared. Test isolation issue. | Stop the old page on `about:blank`, clear only the refresh cookie, clear only `auth-storage` via the public offline route, then mount the login form. Preserve IndexedDB ownership, downloads and queued work. No extra fixture refresh call. | No |
| Sonar gate | E2E fixture files were analyzed as uncovered production sources because spec-only exclusions do not cover helper files. Quality-gate scope configuration. | Exclude `/apps/web/e2e/**` from sources and `apps/web/e2e/**` from coverage, as test infrastructure. Record the finding in `docs/SONAR-GUIDELINES.md`. | No |

## Locally verified

- `pnpm --filter @transformlit/web typecheck`: **passed**.
- `pnpm --filter @transformlit/api test:harness`: **21/21 passed** on final run.
  The first run was 20/21 because its source-string contract still requires the
  refresh endpoint name in the fixture. The fixture now explicitly documents
  why `/api/auth/refresh` must not be called separately. The API test was not
  edited; this is a textual safety check, not verification of UI login behavior.
- `pnpm --dir apps/web exec playwright test -c playwright.pwa.config.ts --list`:
  **passed**, 37 tests discovered in 9 files. Discovery is not an E2E pass.
- Diff inspection and `git diff --check`: **passed**.

## CI-only verification and concerns

- **Production HTTPS PWA harness: skipped by explicit instruction.** UI login,
  download completion, foreground replay, conflict behavior, cold restart and
  independent-device snapshot assertions still require a fresh CI harness run.
- **Sonar scan/gate: not run.** Only configuration changes were locally inspected.
- No genuine production bug is proven by the supplied traces; all confirmed
  causes are fixture, locator, asynchronous assertion or scan-scope errors.
- The second-device assertion now checks server visibility through an
  authenticated generated snapshot rather than claiming annotation rendering on
  `/books`. Annotation UI hydration on a fresh reader remains separate runtime
  coverage, not a product behavior silently implemented here.
- The API harness's endpoint source-string assertion is brittle: it can match a
  comment. Its 21/21 result does not replace the required CI browser evidence.
