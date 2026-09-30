# Task 1B implementation report

## Scope completed

- Confirmed API scripts live under `apps/api/test/scripts/`; API declares `tsx` as a dev dependency. All harness/fixture scripts run from the API workspace. Consumes Task 1A's sole `startOwnedDisposableDatabase` and `assertOwnedDisposableDatabaseUrl` helper; no duplicate DB guard was added. The round-1 ownership update added the invocation-label parameter to that same helper without schema/package changes.
- Added `up`, `test`, and idempotent `down` lifecycle commands. Metadata lives at ignored repository-root `.pwa-harness/environment.json`, records a UUID owner, fixed endpoints/ports, DB/container/image/process/artifact ownership, and is validated before cleanup. Startup checks Docker, existing metadata, and the fixed loopback ports before provisioning. It does not substitute a local/default DB URL.
- Production API and web images are built and started as uniquely tagged/labelled containers. Web build arguments are the exact same-origin HTTPS/WS GraphQL URLs from the brief. API uses production mode and `CORS_ORIGIN=https://localhost:3443`.
- Added an HTTPS reverse proxy for browser requests: `/api` is stripped for API HTTP forwarding, GraphQL WS upgrades are passed to `/graphql`, ordinary traffic goes to the web server, and bodies stream through. Status/MIME/CSP/Set-Cookie are retained; cache is forced to `no-store`; upstream errors do not fall back to HTML. The proxy test exercises secure local TLS trust, response streaming, status/headers/cookies, 404 non-fallback, and WebSocket forwarding.
- Added deterministic two-account/readable multi-page/restricted-book fixture planning and a guarded seeder. Database writes validate against the live Task 1A disposable Testcontainers handle. The round-1 implementation seeds usable v1 assets/authenticated users and exposes an owner-guarded v2 publish hook. Added the HTTPS-only production Playwright configuration, a pinned Chromium TLS trust path, and a secure-context/API proxy smoke test. No service-worker registration assertion was added (Task 3 owns it).

## TDD / verification evidence

- The safety tests were authored before the implementation. The initial existing Jest integration configuration did not collect the non-integration `.spec.ts` suite, so the focused tests were moved to Node's built-in test runner (`tsx --test`). That runner was used for final green verification; a runnable missing-implementation red result was not captured (TDD red-stage deviation).
- `pnpm exec tsx --test test/scripts/pwa-harness.spec.ts`: **6 passed, 0 failed** (five safety/fixture tests, including occupied-port refusal, and one end-to-end local proxy test).
- Focused TypeScript check over the new API harness/helper/test files: **passed**.
- `pnpm --filter @transformlit/api run build`: **passed** (115 files compiled); API typecheck: **passed**.
- `pnpm --filter @transformlit/web run typecheck`: **passed**.
- `git diff --check`: **passed**.
- `docker info --format '{{.ServerVersion}}'`: **blocked** because Docker is not installed (`docker: command not found`). `pnpm exec tsx test/scripts/pwa-harness.ts up` failed closed with “Docker runtime is unavailable; refusing PWA harness startup”; it created no DB/container/process/TLS artifacts or metadata. Consequently production image startup, browser smoke test, and live DB migration/seeding were **not run**.

## Known limitation / follow-up

Current Prisma models store `Book.contentVersion` as a scalar and have no immutable content-version snapshot model/table. The seed setup exercises the 1-to-2 version transition and carries both version identifiers in its deterministic fixture plan, but cannot persist/read an old immutable snapshot without schema support. Task 1B did not change Task 1A-owned schema; Task 5 retained-version assertions therefore remain blocked on an appropriate application persistence contract. The publication-change-during-download scenario is represented in the fixture plan for later orchestration; no real concurrent download was exercised here.

The container/browser trust and startup path remains unverified in this environment. The harness uses a Chromium-only exception pinned to the generated certificate SPKI and Playwright keeps certificate errors enabled (`ignoreHTTPSErrors: false`).

## Fix round 1 evidence — 2026-10-01

### Changed files

- `.dockerignore`: excludes the repository-local PWA owner directory, profiles, artifacts, PEMs and worktrees from `COPY . .` build contexts.
- `apps/api/test/helpers/pwa-disposable-db.ts`: continues to own the single Task 1A Testcontainers guard; accepts an invocation UUID and applies it as the immutable Docker `transformlit.owner` label.
- `apps/api/test/scripts/pwa-db.ts`, `pwa-process.ts`, `pwa-harness.ts`: uses Task 1A's exact live-container URL assertion (including `localhost`), validates owner-scoped resource IDs/labels before any deletion, handles confirmed NotFound only, leaves image caches in place, enforces strict owner-directory descendant paths, and controls a long-lived detached supervisor via a mode-0600 Unix socket plus constant-time UUID-run nonce authentication. `environment.json` writes are atomic and carry `starting`/`ready`/`failed`/`stopping` state, fixed endpoints, resource IDs, fixture IDs and random test credentials. The supervisor retains the Testcontainers handle, API/web containers and HTTPS proxy across `up`/`test`/`down`; startup gates on API `/health`, web `/login` 2xx/3xx, and HTTPS proxy readiness. Startup failure discovers resources only by the unique invocation label, then inspects all exact IDs before cleanup. No PID-based or tag-based resource deletion remains.
- `apps/api/test/helpers/pwa-fixtures.ts` and `apps/api/test/scripts/pwa-fixtures.ts`: uses random credentials hashed with the application's Argon2 convention, seeds ready/published reader state, and writes v1 image/text payload bytes through the existing `LocalStorageAdapter` into the API container's mounted storage. `publish-v2` is a callable supervisor-guarded hook that replaces page payloads and advances the content version from 1 to 2.
- `apps/web/e2e/pwa-fixtures.ts`, `pwa-smoke.pwa.spec.ts`, `playwright.pwa.config.ts`: starts Chromium using Playwright's persistent-context API and an invocation-local repository profile; uses only a certificate-SPKI-pinned Chromium exception, keeps `ignoreHTTPSErrors: false`, uses browser-origin `fetch`, logs in using owner metadata credentials, consumes fixture IDs, and checks HttpOnly cookie invisibility plus secure context.

### TDD and verification

- RED: after adding round-specific ownership, Task 1A localhost, readiness, path and context/TLS assertions, `pnpm exec tsx --test test/scripts/pwa-harness.spec.ts` failed as expected for the missing cleanup/URL helpers and missing `.dockerignore` exclusion. The initial failing output is available in this session evidence: 3 failing ownership/URL/readiness tests, followed by the Docker-context/TLS test failing on absent `/.pwa-harness/` exclusion.
- GREEN: `pnpm exec tsx --test test/scripts/pwa-harness.spec.ts` — **12 passed, 0 failed**. Coverage includes mocked Task 1A `localhost` URI identity and modified-URI refusal; label mismatch and daemon inspection error cause zero removals; a confirmed NotFound is idempotently skipped; occupied port refusal; strict artifact boundary; readiness failure; nonce and socket inode identity; fixture credentials/assets metadata; pinned TLS and Docker context exclusions; plus the local HTTPS HTTP/WS proxy suite.
- GREEN: focused API harness/helper TypeScript check — passed.
- GREEN: `pnpm --filter @transformlit/api run build` — passed (115 files); API typecheck — passed.
- GREEN: `pnpm --filter @transformlit/web run typecheck` — passed.
- GREEN: `git diff --check` — passed.
- BLOCKED: Docker is not installed. `pnpm exec tsx test/scripts/pwa-harness.ts up` failed closed before creating `.pwa-harness`, containers, database, processes, ports, credentials, or TLS artifacts. Production image/browser/fixture startup acceptance remains unverified.

### Ownership and security rationale / remaining concerns

- The UUID label is applied at creation to the Task 1A disposable database and both application containers. Cleanup receives only immutable IDs from current metadata and checks the exact inspected ID and `transformlit.owner` label for every resource before the first removal. Any inspect/daemon error or foreign label aborts the cleanup batch. Image caches are intentionally never deleted. Process teardown is a nonce-authenticated supervisor request over a mode-`0600` socket whose device/inode/UID is recorded; no PID probing or signal-based process kill is used.
- The Docker API runtime env (including random 48-byte JWT secret) is written mode `0600` beneath the owner directory; the JWT secret is passed via `--env-file`, never logged or committed. The generated fixture passwords are random, stored only in mode-`0600` ignored owner metadata, and never printed. The owner-specific data is explicitly excluded from Docker build contexts.
- Container/browser acceptance is blocked by missing Docker. Live Prisma fixture/auth verification, production `/login` readiness, and real Chromium pin behavior were not run. Existing schema has no immutable version snapshot table; `publish-v2` updates current page asset/text keys and `contentVersion`, while Task 5 still owns any retained-old-version assertions.

## Fix round 1 follow-up — controller ruling and final review findings

### TDD evidence

- RED: added focused tests for transient readiness errors, login/refresh smoke setup, controller-owned `/login` readiness, and image-build-before-runtime-secret ordering. The first run had **2 expected failures**: readiness aborted on the first refused connection, and the browser fixture did not call `/api/auth/refresh`.
- GREEN: `pnpm exec tsx --test test/scripts/pwa-harness.spec.ts` — **14 passed, 0 failed** after the fixes. Injected fakes cover transient/process-exit polling, repeated owned cleanup/NotFound, interrupted-startup cleanup verification, foreign labels, inspection errors and zero deletion on failed validation.

### Final changes and verification

- Replaced the web readiness target with the existing `/login` route (accepting 2xx/3xx only); Task 2/14A continue to own `/offline` readiness. Readiness probes now retry connection failures instead of terminating on the first refusal.
- Moved API/web image builds before fixture password/JWT secret generation. The runtime API environment remains in a 0600 owner-only env file, and `.dockerignore` excludes the entire owner directory. JWT secret is generated per invocation and passed only at container runtime.
- The production browser fixture now validates `globalThis.isSecureContext` itself, performs browser-origin login and refresh fetches, and verifies the refresh cookie remains HttpOnly. `ignoreHTTPSErrors` remains false and TLS bypass remains SPKI-pinned Chromium-only.
- Replaced the old numeric-IP URL utility with a metadata endpoint-shape check only; all database access continues to use Task 1A's assertion against the live owned container URI. The mocked owned `localhost` URI passes; a port-modified URI is rejected.
- V1/v2 frame bytes now differ (v2 carries a valid PNG text chunk), v2 text and storage keys differ, and the existing owner-guarded transition updates page keys/contentVersion without claiming schema snapshot retention.
- Added owner-directory marker verification and used the same UUID-scoped owner record before cleanup. Supervisor shutdown remains authenticated by nonce and recorded socket identity; no PID-only process kill is used.
- `pnpm exec tsx --test test/scripts/pwa-harness.spec.ts`: **14 passed, 0 failed**.
- Focused API harness TypeScript check: **passed**.
- `pnpm --filter @transformlit/api run build`: **passed**, 115 files; API typecheck: **passed**.
- `pnpm --filter @transformlit/web run typecheck`: **passed**.
- `git diff --check`: **passed**.
- Docker-backed API/container/DB/browser checks: **BLOCKED** because Docker is unavailable. No DB/container command was run in this follow-up. The SPKI exception was source-checked but actual Chromium trust behavior remains acceptance-blocked until Docker/browser execution is available.

### Remaining concerns

- Immutable content-version snapshots remain outside Task 1B: the v2 hook changes the current `BookPage` payloads and content version; Task 5 owns retained-history persistence/assertions.
- The secure browser smoke and auth refresh flow are implemented but unexecuted because Docker is unavailable. `/offline` is deliberately not a Task 1B readiness dependency.

## Fix round 1 follow-up — lifecycle and fixture finalization

### RED/GREEN

- RED: added an injected transient-readiness test and asserted the fixture performs a same-origin refresh request after login. First focused run: **2 failed** as expected (readiness propagated `connection refused`; refresh route call was absent).
- GREEN: after retry behavior, browser login/refresh, and controller-owned `/login` readiness were implemented, `pnpm exec tsx --test test/scripts/pwa-harness.spec.ts` passed **14 tests, 0 failures**.
- Lifecycle fakes also verify retry after process/probe exit, repeated NotFound cleanup, startup-cleanup verification failure preserving failed-owner state, socket identity reuse refusal, and zero removal on owner-label/inspect mismatch.
- The local HTTPS proxy test additionally asserts that the first response chunk arrives separately before the delayed second chunk and that the WebSocket upstream receives exactly `/graphql`.

### Commands/results

- `pnpm exec tsx --test test/scripts/pwa-harness.spec.ts` — **14 passed**.
- Focused harness/helper TypeScript check — **passed**.
- `pnpm --filter @transformlit/api run build` — **passed**, 115 files; API `typecheck` — **passed**.
- `pnpm --filter @transformlit/web run typecheck` — **passed**.
- `pnpm --filter @transformlit/web run build` — **passed**; build output includes the existing static `/login` route.
- `pnpm --filter @transformlit/api exec node --import tsx -e "console.log('tsx-loader-ready')"` — **passed**; confirms the detached supervisor can be launched as the actual Node process from the API workspace rather than relying on a PID-only pnpm wrapper.
- `git diff --check` — **passed**.
- Docker/API-image/database/browser acceptance — **BLOCKED**. Docker was found unavailable in the previous round; no Docker or database operation was run in this follow-up. Pinned SPKI behavior remains fail-closed but not locally exercised in Chromium.

### Files touched in this follow-up

- `apps/api/test/scripts/pwa-process.ts`: metadata-only DB endpoint shape validation (not ownership), retryable readiness probes, supervisor exit polling, and startup cleanup helper.
- `apps/api/test/scripts/pwa-harness.ts`: `/login` readiness, build-before-runtime-secrets ordering, owner-directory marker checks, lifecycle cleanup/exit helper use.
- `apps/api/test/helpers/pwa-fixtures.ts`: distinct valid v1/v2 PNG frame payloads while retaining current-schema-only v2 transition.
- `apps/api/test/scripts/pwa-harness.spec.ts`: RED/GREEN readiness, refresh, ordering, cleanup, asset-payload and owner assertions.
- `apps/web/e2e/pwa-fixtures.ts`: secure-context validation in the fixture and browser-origin refresh verification.
- This report: appended round-1 follow-up evidence. This follow-up did not change the Task 1A guard, GraphQL/schema/package, or application route files.
