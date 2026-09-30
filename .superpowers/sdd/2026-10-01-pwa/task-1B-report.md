# Task 1B implementation report

## Scope completed

- Confirmed API scripts live under `apps/api/test/scripts/`; API declares `tsx` as a dev dependency. All harness/fixture scripts run from the API workspace. Consumed Task 1A's `startOwnedDisposableDatabase` and `assertOwnedDisposableDatabaseUrl`; did not alter its helper or schema/package files.
- Added `up`, `test`, and idempotent `down` lifecycle commands. Metadata lives at ignored repository-root `.pwa-harness/environment.json`, records a UUID owner, fixed endpoints/ports, DB/container/image/process/artifact ownership, and is validated before cleanup. Startup checks Docker, existing metadata, and the fixed loopback ports before provisioning. It does not substitute a local/default DB URL.
- Production API and web images are built and started as uniquely tagged/labelled containers. Web build arguments are the exact same-origin HTTPS/WS GraphQL URLs from the brief. API uses production mode and `CORS_ORIGIN=https://localhost:3443`.
- Added an HTTPS reverse proxy for browser requests: `/api` is stripped for API HTTP forwarding, GraphQL WS upgrades are passed to `/graphql`, ordinary traffic goes to the web server, and bodies stream through. Status/MIME/CSP/Set-Cookie are retained; cache is forced to `no-store`; upstream errors do not fall back to HTML. The proxy test exercises secure local TLS trust, response streaming, status/headers/cookies, 404 non-fallback, and WebSocket forwarding.
- Added deterministic two-account/readable multi-page/restricted-book fixture planning and a guarded seeder. Database writes validate against the live Task 1A disposable Testcontainers handle. The readable book is transitioned from content version 1 to 2. Added the HTTPS-only production Playwright configuration, repository-local NSS certificate trust profile requirement, and a secure-context/API proxy smoke test. No service-worker registration assertion was added (Task 3 owns it).

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

The container/browser trust and startup path remains unverified in this environment. The harness fails closed if Docker or repository-local `certutil` trust-profile provisioning is unavailable, and Playwright keeps certificate errors enabled (`ignoreHTTPSErrors: false`).
