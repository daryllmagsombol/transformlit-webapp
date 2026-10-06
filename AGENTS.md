# Transformlit — Agent Guidelines

Project-specific rules for AI coding agents. These supplement the global AGENTS.md with conventions learned from SonarQube audits and codebase patterns.

## SonarQube Compliance

All code MUST pass SonarQube quality gate. See `docs/SONAR-GUIDELINES.md` for the full rule set.

**Mandatory review workflow (do not skip):**

- **ANY finding from ANY SonarQube or opencode/AI code review MUST be added to `docs/SONAR-GUIDELINES.md` so it cannot happen again.** No exceptions: every new rule, gate condition, hotspot, or review finding gets recorded there (rule ID, the fix, and a ❌/✅ example) **in the same change/PR**.
- Every SonarQube and every opencode/AI code review MUST be performed **against `docs/SONAR-GUIDELINES.md`** and MUST **update that file** with any newly discovered rule, gate condition, or finding — so the same issue cannot recur in a future session.
- Treat `docs/SONAR-GUIDELINES.md` as a **living document**: when a review surfaces a finding not already documented, append it (rule ID, fix, and a ❌/✅ example) **in the same change/PR**.
- Reviews must check the **New Code quality-gate conditions** (0 new issues, ≥80% new-line coverage, ≤3% new duplication, 100% security hotspots reviewed) — a single Low/Minor issue or an unreviewed hotspot fails the entire gate. See the "Quality Gate Conditions" section.
- Prefer writing code that **cannot** trigger a finding (e.g. avoid hardcoded IPs/secrets so no security hotspot needs review).

Key non-negotiable rules:

- **No `window` references** — use `globalThis.window` or `globalThis` (S6653)
- **No array index in React keys** — use stable unique IDs; for structurally identical items (e.g. Bible `line_break`), key by a per-render ordinal (S6479)
- **Prefer native `<progress>` / `<output>`** over `role="progressbar"` / `role="status"`; assert `value`/`max`, not `aria-valuenow` (S6811)
- **Sort with an explicit comparator** — `arr.sort((a, b) => a.localeCompare(b))`, never bare `.sort()` on strings (S6353)
- **Use a regex literal, not `new RegExp(...)`** — literals never need `String.raw` (S6325)
- **Fold redundant `if (x > y)` into `Math.max`/`Math.min`** when the assignment is flagged as redundant (S1854)
- **Never use `FormEvent`** (bare or `React.FormEvent`) — it is deprecated and "does not actually exist" in @types/react 19; use `React.SyntheticEvent<HTMLFormElement>` (S1874)
- **No empty methods** — implement or remove (S1186)
- **No unused imports** — remove immediately (S1128, S1440)
- **Mark constructor params `readonly`** when never reassigned (S6643)
- **Use `String.raw`** for regex patterns with backslashes (S6650)
- **Use `node:crypto`** over bare `crypto` import (S2208)
- **Use `export…from`** for re-exports (S6632)
- **Use `String#replaceAll()`** over `String#replace()` for global replacement (S6657)
- **Use `String.fromCodePoint()`** over `String.fromCharCode()` (S6660)
- **Use optional chains** (`?.`, `??`) over explicit null checks (S6606, S6647)
- **No nested ternary operations** — extract to independent statements (S6644)
- **No `void` operator** in expressions (S6659)
- **No `await` on non-Promise values** (S6648)
- **Default parameters must be last** (S6651)
- **Cognitive complexity ≤ 15** per function (S6652)
- **No nested template literals** (S6654)
- **No nested functions > 4 levels** (S6655)
- **Promise rejection reasons must be `Error` instances** (S6661)
- **Use `??=`** over assignment with nullish check (S6662)
- **No negated conditions** where positive reads better (S6663)
- **No duplicate CSS selectors** (S6664)
- **No deprecated APIs** — Zod `.email()`, `.url()`, `.uuid()`, `.datetime()`, `.cuid()`, `.cuid2()`, `.ulid()`, `.ip()`, `.date()`, `.time()`, `.duration()`, `.emoji()`, `.base64()`, `.cidr()`, `.trim()`, `.toLowerCase()`, `.toUpperCase()`, `.nonempty()`, `.min()`, `.max()`, `.length()`, `.regex()`, `.startsWith()`, `.endsWith()`, `.datetime()` with string arg; Apollo `createHttpLink`, `split`, `setContext`, `onError`, `query`, `mutate` legacy signatures; React `FormEvent`; `MockedResponse` (S6665–S6690)

## Accessibility (S6700–S6710)

- **Use semantic HTML** — `<nav>` not `role="navigation"`, `<dialog>` not `role="dialog"`, `<hr>` not `role="separator"`, `<button>` not `role="button"`, `<input type="button">` not `role="button"`
- **Interactive elements need keyboard support** — `onClick` on non-interactive elements requires `onKeyDown` or `onKeyUp`
- **Form labels must be associated** — use `htmlFor`/`id` pairing
- **Media elements need `<track>`** — `<audio>` and `<video>` require captions track
- **Clickable non-native elements need `role`** + tab/keyboard/mouse/touch support

## React Patterns (S6720–S6730)

- **Props must be read-only** — mark component props as `readonly` (S6643)
- **No array index in keys** — use stable unique IDs (S6479)
- **No useless variable assignments** — remove unused vars and redundant assignments (S6477, S6478)
- **Context provider values must be stable** — wrap in `useMemo` if object literal (S6480)
- **No setter with matching state** — don't use state variable in its own setter (S6481)

## Code Organization

- **Re-export with `export…from`** — don't re-export via intermediate variable
- **Default params last** — put parameters with defaults after required params
- **No duplicate selectors** — consolidate CSS rules
- **No nested template literals** — extract to variables
- **Cognitive complexity ≤ 15** — extract helper functions

## Security

- **No `window` direct reference** — always `globalThis.window` for SSR safety
- **No unused imports** — they bloat bundles and confuse tree-shaking
- **No empty methods** — they hide missing implementation

## Production Deployment and Release Work

These are execution rules, not a promise that any particular deployment is complete. Detailed deployment review fixes and bad/good examples live in [`docs/SONAR-GUIDELINES.md`](docs/SONAR-GUIDELINES.md#oracle-deployment-review-findings--ai-review-ids-not-sonar-rules). Apply the documented `DEPLOY-*` findings; do not copy their full examples here.

### Establish ownership and checkpoints once

- Before a production command, inspect the current runbook, workflow and action definitions, actual installed CLI options, target host services, and existing evidence. Do one initial risk review, identify material uncertainties for escalation, then write a short phase/owner/checkpoint list and choose one durable evidence path. Do not assume checkout directory, workflow default branch, command behavior, or environment from stale notes; do not escalate every mechanical step.
- Assign one executor to the ordered production sequence. Parallelize only independent read-only research or disjoint-file documentation/preparation. Do not start competing cutover streams, repeat successful review/preflight work or valid hash/test evidence, or send status pings that do not produce new evidence.
- Read-only acceptance probes may be split only across hostnames in the controller/user-approved active-origin inventory; assign one owner for shared runtime/baseline checks. A hostname retired from this server's acceptance scope is not a DNS deletion, and does not prove its other origin cannot write shared DB/book storage. Do not parallelize competing state-changing phases or repeat shared checks.
- On resume, record the last successful command/result, current migration ledger/schema and DB-write state, running service IDs, and latest backup/recovery evidence. Continue from that successful checkpoint; do not repeat completed preparation or non-idempotent operations. A busy/waiting task is not progress without new evidence. Every substantive phase needs an exit condition and checkpoint: target SHA, output path, public maintenance state, write status, and next owner/action. Record timestamps. If roughly 15 minutes pass without a checkpoint or new evidence, stop speculative work, make the system safe without interrupting an in-flight durable operation, and report the blocker/state/next action; this is not a total-task deadline.
- Give estimates only when evidence supports them; state assumptions and uncertainty, never promise an unsupported finish time or report an elapsed duration not supported by timestamped evidence. On handoff, state the latest verified SHA, merge/build/artifact state, last completed phase, current failure/blocker, and exact checkpoint. Do not copy stale summary state over newer evidence.

### Make commands and retries auditable

- For each state-changing or failing command, retain the exact command with secrets redacted, UTC timestamp, exit status, stdout, stderr, and resulting service/database state before retrying. Capture and persist raw command results before parsing, hashing, or recovery; syntax/import-check failure wrappers and stub-test both initiating-command and recovery failures so exceptions cannot erase the original evidence. Never discard stderr or claim a command passed without its result. Do not record credentials, signed URLs, or sensitive environment values.
- After one failed hypothesis, reassess from observed evidence. After two failed methods for the same blocker, stop trying variants; use the documented standard recovery or escalate for the necessary shared-outage/user approval. Do not bypass a release, backup, writer-drain, or validation gate to preserve momentum.
- For failed child processes, host events, or DB operations, inspect actual partial state once and follow the documented lifecycle recovery. Do not respawn an unchanged broken process, silently take over a multi-step run, or abandon a useful checkpoint. If a new executor is needed, hand over ownership and the checkpoint explicitly.
- Bound network and polling work. Probe an artifact with a small bounded transfer (for example, 1 MiB / 30 seconds); one stalled transfer means stop and diagnose, not repeated ten-minute download/poll cycles. Prefer the verified CI artifact. Keep permanent GitHub credentials local; handle signed redirect capabilities in memory and pass them only through SSH stdin. Never log or place signed URLs/tokens in argv. Bound reload and HTTP connect/request polling too.

### Pin source, workflows, and image identity

- Pin all release inputs to the exact approved full SHA. The local `HEAD`, a prepared override, or a prior summary may be stale: inspect the requested target with `git show <sha>:<path>` or verified staged source, and verify the actual workflow checkout path, ref/default branch, merge status, CI run, artifact revision, and digest before deployment.
- Inspect repository package scripts and installed subcommand help before choosing commands. Check checkout/action `working-directory`, Node/package-manager version, and target platform/architecture; verify API and web build from the intended source rather than assuming a development-server path or platform. Verify the web artifact uses same-origin relative HTTP and WebSocket routes through `/api/graphql`, not a stale build-time host. For workflow dispatch, verify the configured default branch and ref behavior instead of assuming it runs the current PR branch.
- Build only the approved release with explicit resource limits if host building is approved; never assume unlimited host CPU/disk or use an unpinned local rebuild. Distinguish OCI config, manifest, and index digests; verify the descriptor/reference chain, blobs, runtime config, ordered layer IDs, OS/architecture, and revision. Do not treat gzip size or `inspect.Size` as portable disk requirements; budget stored layers, unpacked snapshots, temporary space, and reserve against actual filesystem capacity.
- Verify Compose flags for the installed subcommand. `compose run` does not accept `--no-build`; use a build-free pinned-image config with `run --rm --no-deps --pull never`. `compose up` supports `--no-build --no-deps`. Name the intended project/services explicitly; do not use broad `up`/`down` operations that change unrelated services or dependencies.

### Protect production data and shared services

- On shared PostgreSQL, select the application database explicitly (`--dbname=transformlit`), never infer it from `POSTGRES_DB` (which may be `postgres`). Before migration/rollback work, require fresh quiesced DB and book-storage backups, checksums, a nonempty archive, `pg_restore --list`, and an isolated restore/application-identity check. Restore only to a separate authorized target with verified capacity/reserve; never test a restore against production or the existing staging database.
- Resolve migration-ledger entries only after full catalog equivalence: exact formatted types/precision, schema/enum order, PK/FK/index definitions and index valid/ready state, and constraint validation/deferrability. For release-specific expected ledger counts, use the approved recorded pre/post state (including the documented four-entry pre-state/eight-entry post-state when that release requires it); do not infer equivalence from names or generic types. See `DEPLOY-BACKUP-DATABASE-SELECTION`, `DEPLOY-MIGRATION-PROOF`, and `DEPLOY-CATALOG-EXACTNESS`.
- Drain real writers before backup or migration: a maintenance 503 and graceful Nginx reload do not close existing WebSockets or stop API/worker processes. Stop API and worker using the approved lifecycle, then prove their processes and DB/book-storage writers are absent. Never create a test account, login session, sync, download, or conversion job without explicit authorization.
- Run conversion processing in an independent worker using the same approved API image and `node apps/api/dist/worker/main.js`; match API database configuration/network, book-storage mount, UID, and filesystem permissions. Verify worker startup/readiness and record whether any backfill worker was stopped, promoted, or intentionally skipped. Do not create a conversion job to test it without explicit authorization.
- Cleanup only after inspecting the exact target set and confirming no active build. Remove only explicitly authorized unused build cache with `docker builder prune -a -f`; remove a stopped container only by its individually verified ID after rechecking it is stopped and not Compose/deployment/staging-managed. Never use `docker system prune`, image/volume/network prune, remove candidate/rollback images, or stop shared services. Record reclaimed bytes and compare live container IDs/start times and protected image/volume baselines.

### Apply and prove Nginx cutover safely

- Before editing/reloading a single-file Docker bind mount, compare host and container-mounted device/inode/hash and inspect the effective config with `nginx -T`. A host pathname/checksum change or successful `nginx -t`/reload signal does not prove the container reads the new inode or has activated the config. Preserve the host inode with in-place updates and a read-only mount. Prefer a narrowly scoped, tested Nginx-only recreation with a rollback plan and explicit approval over ad hoc namespace/`nsenter`/proc-FD/remount experiments. A raw inherited FD proves FD lifetime, not `/proc/<pid>/fd` visibility; Docker may reject cross-namespace binds. Follow `DEPLOY-BIND-MOUNT-INODE-CONSISTENCY` and `DEPLOY-NAMESPACE-PROC-FD-VISIBILITY` before any approved exception. Never describe an ongoing fallback as a completed fix.
- If a controller explicitly approves the documented temporary dual-inode workaround, update only the private mounted config and host source in place, restore read-only before validation/reload, record both inodes, and prove both hashes plus `nginx -T`. Mark it as a content workaround, not inode repair. After an approved, tested Docker-only recreation removes the workaround, require and record host/mount same-inode and hash agreement before cutover.
- Use staged maintenance only for the controller/user-approved active hostnames and their verified effective origins. Confirm fresh bounded requests to both public DNS and the corresponding direct origin (correct SNI/certificate) reach the expected 503 on app/auth/GraphQL HTTP and WebSocket routes while static `/_next/static/` paths remain served in the later static phase. Keep the immutable old/new union only for hashed `/_next/static/` assets; do not alias `/sw.js`, `/pwa-assets.json`, `/offline`, or the manifest through that union. Stop on byte collisions, and ensure missing assets return 404 rather than HTML. Do not purge a CDN or restore a whole old Nginx file by guesswork.
- Cut over in order: enable maintenance; drain API/worker and prove all DB/book-storage writer ownership is accounted for and relevant writers are absent; take and verify fresh backups; pass config, catalog, and migration gates; confirm backfill-worker disposition; start target API/web while keeping public maintenance; prove internal DB-backed authentication and storage readiness; start the independent worker and prove its readiness; check public static assets while maintenance remains; reopen with the tested config and retained static locations; then bounded-poll activation and immediately test direct-origin and public responses for every approved active hostname. No API/worker writer starts before backup and migration gates pass. A reload signal alone is not acceptance; do not demand public API success during the intentional 503 window.
- Post-cutover verify exact release/image identity, `/api/graphql` prefix stripping, auth routes, GraphQL HTTP and WebSocket behavior, health plus an authenticated DB-backed operation, service-worker/inventory release and cache headers, CSP, static asset hashes/cache behavior, worker image/command and storage mount parity, missing-asset 404, and unchanged shared-service IDs/start times. A static `{status: "ok"}` health response alone is insufficient. Keep technical examples in `DEPLOY-EXACT-RELEASE`, `DEPLOY-WORKER-PARITY`, `DEPLOY-READINESS-EVIDENCE`, `DEPLOY-STATIC-RETENTION`, `DEPLOY-MAINTENANCE-ACCEPTANCE-ORDER`, and `DEPLOY-EFFECTIVE-ORIGIN-OWNERSHIP`.
- Before an authenticated readiness probe, verify the credential came from the canonical application origin and is an existing application access JWT, not a refresh cookie/provider token or token copied from a retired origin. Supply raw JWT bytes to helpers that add `Bearer`; do not add a prefix or quotes twice. If `JwtAuthGuard`/a protected `me` read returns `UNAUTHENTICATED`, stop blind token-copy retries and do not rotate secrets or restart services; report the auth gate blocked, not a proven production-login regression.
- After a DB/schema write, do not blindly roll back to an old image against a changed schema. Re-enter/retain maintenance, preserve evidence, and use the approved roll-forward or backup-restore plan with explicit approval. Report the state honestly; only mark a release complete after the required gates and acceptance for every approved active hostname pass.
- Keep acceptance checks phase-scoped: initial maintenance verifies app/auth/GraphQL HTTP+WS 503 only; static-under-maintenance starts only after the static service is available; open-phase checks follow route restoration. Initial maintenance requires every approved active hostname × 2 endpoints (public/direct-origin) × 4 routes = 8N cells; every request must complete transport and return the expected status. Retain each cell's result; timeout/missing cells fail, and do not short-circuit while discarding remaining status/stderr evidence. The historical 2-host example was 16 cells, not a standing mandate to probe retired hostnames.

### Bound validation to the risk and state its limits

- First verify the changed code and release evidence that matter; run the focused tests/scripts, then only the broader CI checks required by the change. Inspect actual package scripts before running them. If a wrapper mangles direct TypeScript checks, run the supported direct compiler command. Preserve unrelated pre-existing test failures and do not rerun every suite repeatedly without a new hypothesis.
- After branch switches, verify the intended target checkout and regenerate generated Prisma clients before builds/tests. Test against that source/client; a stale generated client or development database is not proof that the target CI build is broken. The PWA harness has known potentially hanging paths: use a bounded attempt and CI as the authority rather than repeating long local hangs.
- For offline/PWA changes, exercise cold deep links, account isolation, hydration/ownership restoration before local reader access, and persisted feed-body reads before browser reload where relevant. Distinguish source/unit evidence from a real browser install/update, offline cold restart, account sync, authenticated subscription, or physical iOS test. If credentials, a browser, or authorized write-capable test data are unavailable, mark that evidence blocked/not run; never invent credentials or claim those checks passed.
- Every SonarQube or AI-review finding still follows the mandatory same-change update to `docs/SONAR-GUIDELINES.md`. Known deferred Sonar gates are not passes; state explicitly when they were not run. Do not auto-commit or broaden the file scope without authorization.
