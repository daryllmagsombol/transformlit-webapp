# Task 1B implementation report

## Scope completed

- Confirmed API scripts live under `apps/api/test/scripts/`; API declares `tsx` as a dev dependency. All harness/fixture scripts run from the API workspace. Consumed Task 1A's `startOwnedDisposableDatabase` and `assertOwnedDisposableDatabaseUrl`; did not alter its helper or schema/package files.
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
- `apps/api/test/scripts/pwa-db.ts`, `pwa-process.ts`, `pwa-harness.ts`: uses Task 1A's exact live-container URL assertion (including `localhost`), validates owner-scoped resource IDs/labels before any deletion, handles confirmed NotFound only, leaves image caches in place, enforces strict owner-directory descendant paths, and controls a long-lived detached supervisor via a mode-0600 Unix socket plus constant-time UUID-run nonce authentication. `environment.json` writes are atomic and carry `starting`/`ready`/`failed`/`stopping` state, fixed endpoints, resource IDs, fixture IDs and random test credentials. The supervisor retains the Testcontainers handle, API/web containers and HTTPS proxy across `up`/`test`/`down`; startup gates on API `/health`, web `/offline`, and HTTPS proxy readiness. Startup failure discovers resources only by the unique invocation label, then inspects all exact IDs before cleanup. No PID-based or tag-based resource deletion remains.
- `apps/api/test/helpers/pwa-fixtures.ts` and `apps/api/test/scripts/pwa-fixtures.ts`: uses random credentials hashed with the application's Argon2 convention, seeds ready/published reader state, and writes v1 image/text payload bytes through the existing `LocalStorageAdapter` into the API container's mounted storage. `publish-v2` is a callable supervisor-guarded hook that replaces page payloads and advances the content version from 1 to 2.
- `apps/web/e2e/pwa-fixtures.ts`, `pwa-smoke.pwa.spec.ts`, `playwright.pwa.config.ts`: starts Chromium using Playwright's persistent-context API and an invocation-local repository profile; uses only a certificate-SPKI-pinned Chromium exception, keeps `ignoreHTTPSErrors: false`, uses browser-origin `fetch`, logs in using owner metadata credentials, consumes fixture IDs, and checks HttpOnly cookie invisibility plus secure context.

### TDD and verification

- RED: after adding round-specific ownership, Task 1A localhost, readiness, path and context/TLS assertions, `pnpm exec tsx --test test/scripts/pwa-harness.spec.ts` failed as expected for the missing cleanup/URL helpers and missing `.dockerignore` exclusion. The initial failing output is available in this session evidence: 3 failing ownership/URL/readiness tests, followed by the Docker-context/TLS test failing on absent `/.pwa-harness/` exclusion.
- GREEN: `pnpm exec tsx --test test/scripts/pwa-harness.spec.ts` — **12 passed, 0 failed**. Coverage includes mocked Task 1A `localhost` URI identity and modified-URI refusal; label mismatch and daemon inspection error cause zero removals; a confirmed NotFound is idempotently skipped; occupied port refusal; strict artifact boundary; readiness failure; nonce and socket inode identity; fixture credentials/assets metadata; pinned TLS and Docker context exclusions; plus the local HTTPS HTTP/WS proxy suite.
- GREEN: focused API harness/helper TypeScript check — passed.
- GREEN: `pnpm --filter @transformlit/api run build` — passed (115 files); API typecheck — passed.
- GREEN: `pnpm --filter @transformlit/web run typecheck` — passed.
- GREEN: `git diff --check` — passed.
- BLOCKED: Docker is not installed. `pnpm exec tsx test/scripts/pwa-harness.ts up` failed closed before creating `.pwa-harness`, containers, database, processes, ports, credentials, or TLS artifacts. Production image/browser/fixture startup acceptance remains unverified. The required production readiness probe for `/offline` is intentionally strict; this worktree has no `/offline` page yet, so browser startup will remain blocked until the later PWA application work provides it.

### Ownership and security rationale / remaining concerns

- The UUID label is applied at creation to the Task 1A disposable database and both application containers. Cleanup receives only immutable IDs from current metadata and checks the exact inspected ID and `transformlit.owner` label for every resource before the first removal. Any inspect/daemon error or foreign label aborts the cleanup batch. Image caches are intentionally never deleted. Process teardown is a nonce-authenticated supervisor request over a mode-`0600` socket whose device/inode/UID is recorded; no PID probing or signal-based process kill is used.
- The Docker API runtime env (including random 48-byte JWT secret) is written mode `0600` beneath the owner directory; the JWT secret is passed via `--env-file`, never logged or committed. The generated fixture passwords are random, stored only in mode-`0600` ignored owner metadata, and never printed. The owner-specific data is explicitly excluded from Docker build contexts.
- Container/browser acceptance is blocked by missing Docker. Live Prisma fixture/auth verification, actual `/offline` readiness, and the real Chromium pin behavior were not run. Existing schema has no immutable version snapshot table; `publish-v2` updates current page asset/text keys and `contentVersion`, while Task 5 still owns any retained-old-version assertions.
