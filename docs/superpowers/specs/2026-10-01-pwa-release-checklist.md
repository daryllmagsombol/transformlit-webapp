# Transformlit PWA Release Checklist (Tasks 14A/14C)

Evidence path for the release gates in `2026-10-01-pwa-design.md`. Items are grouped by
where the evidence must be produced. **Local-only checks cannot substitute for
live-origin/device checks, and vice versa.** Sources are primary vendor docs; see the end.

Date: 2026-10-02 · Branch: `feature/pwa-offline` · HEAD: `a0371ac` · Base: `main`.

**Overall status: RELEASE BLOCKED.** Repository-controlled code and blocking CI gates are
complete and review-clean, but the live-origin, CDN-retention, trusted-HTTPS,
translation-rights and real-iOS-device evidence is **unverified** (external). See
`docs/Deployment.md` §"PWA offline delivery path and release gates (Task 14C)" for the
delivery-path description and the E1–E11 supplier table.

Status legend: `[x]` verified · `[~]` partially verified · `[ ]` not done ·
`[BLOCKED]` requires external evidence that cannot be produced in this repo/worktree.

Evidence classes used below:

- **Repo/local** — reproducible from this branch or the built production image.
- **External** — requires the real Cloudflare/ACA origin, a physical iOS device, supplied
  licensing records, or repository-admin configuration.

## P0 — Local (repo + built production image) — evidence produced

Verified against the built image `transformlit-web@sha256:bbd588d4303a…` (14A), served on
`localhost:3100` with `PORT=3000`. These are asset/header diagnostics only, **not**
production proxy/auth/DB acceptance.

- [x] Manifest (`app/manifest.ts`) emits valid name/`start_url`/scope/`display`/icons;
  observed body: `start_url:/offline`, `scope:/`, `display:standalone`, maskable
  `pwa-maskable-512.png`.
- [x] `/sw.js` served at root with `application/javascript; charset=utf-8` and
  `Cache-Control: no-cache, no-store, must-revalidate`.
- [x] `public/` is copied into the standalone output; `/offline`, icons, manifest,
  `pwa-assets.json`, `/_next/static/**` all resolve locally (missing hashed chunk → `404`).
- [x] `Service-Worker-Allowed: /` present.
- [x] Effective CSP on the registration document contains `worker-src 'self'`
  (`default-src 'self'`, `script-src 'self' 'unsafe-inline'`).
- [x] `/_next/static/**` responses carry `public, max-age=31536000, immutable`.
- [x] `/pwa-assets.json` is `application/json` + `no-cache, no-store, must-revalidate`
  (matches the worker's `cache: 'no-store'` inventory fetch).
- [x] Generated `sw.js` embeds release ID + inventory digest; `build-pwa-assets.mjs
  --verify` matches `.next/BUILD_ID`; mixed worker/inventory install fails and asset-only
  change yields a waiting worker requiring consent (unit-covered, Task 3/14A).
- [x] Each Bible translation has recorded license metadata before its download control can
  enable; unknown rights stay disabled (fail-closed —
  `2026-10-01-bible-offline-rights.md`; all curated translations currently disabled).

## P0 — Live origin and real device — BLOCKED (external)

- [BLOCKED] `curl -sSI https://<origin>/sw.js` through Cloudflare: `cf-cache-status` is
  `BYPASS`/`DYNAMIC` (never `HIT`), plus correct `content-type`, `cache-control`,
  `service-worker-allowed`. **E2.**
- [BLOCKED] Same headers confirmed direct against the ACA origin and a revision-label FQDN
  (proves Cloudflare is not masking an origin defect). **E1/E5.**
- [BLOCKED] `curl -sSI https://<origin>/` shows CSP `worker-src 'self'`. Local CSP is
  verified; the real-origin header (and any edge rewrite) is not. **E1/E4.**
- [BLOCKED] After a real deploy, an **old** hashed `/_next/static/**` chunk still returns
  `200`/`HIT` (edge/CDN retention protects open tabs and installed PWAs). **E3** — this is
  the Task 14A retention blocker; see `docs/Deployment.md`.
- [BLOCKED] ACA revision mode/traffic weights/`maxInactiveRevisions` confirmed; rollout
  keeps the prior revision until old-hash traffic drains. Repo evidence: `revision_mode =
  "Single"`, single traffic weight `latest_revision = true` (`infra/modules/container-app/main.tf`)
  — single mode **deprovisions** old revisions. **E5.**
- [BLOCKED] iOS Safari and Android Chrome: install, go offline, reload, navigate;
  foreground-only behavior holds and background-sync paths degrade gracefully (iOS has no
  Background Sync/Periodic Sync/Background Fetch). **E7.**
- [BLOCKED] Deploy pipeline contains no "Purge Everything"; only changed non-hashed URLs are
  purged. No in-repo deploy/purge config exists (deploy workflows are disabled). **E4.**
- [BLOCKED] Trusted HTTPS on the real supported origin; cert setup must not implicitly
  modify user/OS trust stores or weaken TLS. **E6.**

## P0 — Physical iOS device / installed PWA — BLOCKED (external)

Playwright WebKit is **supplemental only** and is not proof of any item below. The owned
HTTPS harness itself is environment-blocked (14A: detached supervisor reaped; Playwright
fails at first request). Real-browser E2E was **never claimed passing**.

- [BLOCKED] Install from Safari to the home screen against the production origin. **E7.**
- [BLOCKED] Cold (full device/process restart) offline relaunch renders the generic hub.
  **E7.**
- [BLOCKED] Storage/quota: persistent-storage request, estimated usage/quota, graceful
  failure without evicting outbox. **E7.**
- [BLOCKED] Worker update flow: asset-only change yields waiting worker; activation
  requires explicit consent; shell-cache cleanup independent of IndexedDB/account data.
  **E7.**
- [BLOCKED] Multi-tab behavior and cross-tab fencing. **E7.**
- [BLOCKED] Account lifecycle on device: same-account reauthentication, explicit
  conflict/sync-discard decisions, sign-out barrier, deferred logout. **E7.**
- [BLOCKED] Accessibility on the deployed origin: keyboard/focus, status announcements,
  colour contrast/theming, and `prefers-reduced-motion`. Reduced motion exists in the app
  (`globals.css`, `layout.tsx`); live verification is deferred here (14A ownership split).
  **E9.**

## P1 — Live config audit — BLOCKED (external)

- [BLOCKED] Cloudflare Cache Rule matching `http.request.uri.path eq "/sw.js"` → Bypass
  cache (Cache Rules override Page Rules; last matching rule wins). **E1/E2.**
- [BLOCKED] No Worker/Snippet/Page Rule/Rocket Loader/HTML rewrite intercepting `/sw.js`,
  `/offline` or the app path. **E4.**
- [BLOCKED] Cache Reserve (or equivalent durable edge storage) enabled for
  `/_next/static/**` if edge-eviction risk is unacceptable. **E3.**

## P2 — Rights evidence (external) — BLOCKED

- [BLOCKED] Written license/permission for each restricted translation that explicitly
  covers **offline/download storage, redistribution to end users, and format conversion**
  (not merely verse quotation limits). Store with the content metadata and add to
  `apps/web/src/lib/bible/offline-rights.ts`. **E8.**
- [BLOCKED] Public-domain / CC translations may ship first; restricted translations remain
  online-only until rights are obtained. **E8.**

## End-to-End PR / CI / Review / Merge checklist (verified state)

### Branch and implementation safety

- [x] Working tree inspected and unrelated user work preserved (worktree clean).
- [x] Work on a feature branch following repo naming: `feature/pwa-offline`.
- [x] Tasks executed in dependency order; parallel lanes had explicit file ownership.
- [x] Committed at each checkpoint after focused verification.
- [x] No fixture credentials, browser profiles, cookies, tokens or generated private data
  committed (`.superpowers/` and build artifacts are gitignored).
- [x] Generated public build inventory (`sw.js`, `pwa-assets.json`) is untracked and
  regenerated by `build-pwa-assets.mjs`; `--verify` confirms reproducibility.

### Final local verification

- [x] Ordinary `AppModule`/integration boot and `graphql:schema:check` never write canonical
  SDL; stale/malformed fixtures fail with canonical bytes unchanged; guarded
  `graphql:schema:export` runs separately. Verified 14A/14B (`git diff --exit-code` clean).
- [x] Clean-checkout generated GraphQL package: codegen from tracked canonical schema,
  package build/typecheck, CommonJS-compatible package root, real `DocumentNode` consumer
  import; generated source/dist untracked and generated before compile. 2/2 passed.
- [~] Worker release A→B in production harness: worker/inventory identities match, assets
  precede worker, mismatch cannot replace A, downloads/outbox survive, consent-gated
  activation — **repo unit** coverage exists; the real A→B harness exercise is BLOCKED
  (14A). Old-release retention is the CDN gate (E3).
- [~] Under actual production CSP, Blob frame `img.decode()`/natural dimensions/text-version
  match: authored; real-browser execution BLOCKED. Local CSP (`worker-src 'self'`) verified.
- [x] Migrations to a fresh disposable DB and populated-fixture upgrade through the owned
  integration test: `pwa-migration.integration.spec.ts` runs real `db:migrate:deploy`
  (fresh + populated) and asserts Prisma bookkeeping and safe rerun (14A, under Colima).
- [x] Delayed legacy progress/bookmark/highlight writes reject with `UPGRADE_REQUIRED`, no
  state change, no resurrection (Task 8 fix; reader-schema integration).
- [~] Affected unit, API integration, reader/auth/Bible regressions, and production PWA E2E:
  unit (web 133/1121, api 40/667, shared 127) and scoped integration (8 suites/52) pass;
  PWA browser E2E BLOCKED; 4 pre-existing drift suites (groups/chat/friends/auth) fail and
  are tracked separately (14A).
- [x] PWA suites do not pass through fixture-based skips.
- [~] Builds, typechecks, supported lint checks, coverage: api/web/graphql typecheck + build
  and coverage pass; **lint unsupported** — no ESLint flat config (api) and `next lint`
  absent in Next 16 (web). Not faked, not wired as a gate.
- [x] Baseline `next lint`/codegen/environment failures reported accurately, not marked pass.
- [x] Full diff inspected: migration SQL, Dockerfiles, canonical schema non-mutation/export,
  package exports, CI, public worker code.
- [x] Approved exclusions remain excluded (no CORS/CSP/cookie weakening; no new deps;
  disabled deploy workflows untouched).

### Pull request creation

- [BLOCKED] PR not created: branch `feature/pwa-offline` is **not pushed** to `origin`
  (`git ls-remote --heads origin` shows no matching ref) and no PR exists. **E11.** Before
  creating it: `git status --short`, `git diff`, `git remote -v`, `git branch -vv`,
  `git log --oneline -10`; discover the target branch (`main`) and use `gh pr create`.
- [ ] PR describes architecture, retention limits, account behavior, migration/backfill,
  rollout order, rollback window, and licensing availability.
- [ ] Include exact commands/results and browser/deployment evidence.
- [ ] List the five Review Focus risks and their tests.
- [ ] State task dependency order and external blockers; distinguish local-harness evidence
  from actual CDN/deployment and real iOS device evidence (see E1–E11).
- [ ] Link unresolved release blockers explicitly (14A retention; 14B CI caveats).
- [BLOCKED] Return the created PR URL during implementation execution. **E11.**

### CI and review

- [BLOCKED] Observe checks with `gh pr checks`: no PR exists, so no branch CI run has been
  observed. CI is authored (14B) but not exercised on this branch. **E11.**
- [BLOCKED] Require real build/type/unit/integration/PWA checks and Sonar quality gate
  success: jobs are wired blocking; `pwa-chromium` is **unverified** (harness blocked) and
  the Sonar quality gate has not been observed on this branch. **E10/E11.**
- [x] The informational AI-review job is not treated as a security/correctness gate (the
  14B `gate` job uses `!= 'success'` over correctness jobs only; `review` stays
  `continue-on-error`).
- [~] Independent review focused on R1–R5 done per-task (all task reviews complete and
  review-clean); a PR-level independent review has not occurred because no PR exists.
- [x] Review explicitly covered schema non-mutation, clean generated consumer, worker A→B,
  Blob production-CSP rendering, fresh/populated migration records, legacy-write rejection,
  and dependency/ownership serialization.
- [x] Actionable findings addressed; affected checks re-run after each correction.
- [x] Review checkpoints performed automatically without further planning approval.

### Merge and staged release

- [BLOCKED] Confirm branch protections and actual merge authorization/policy before
  `gh pr merge`: repository-admin dependency. **E10.**
- [BLOCKED] Merge only when required checks and independent review are satisfied: not
  merged; no PR/CI. **E10/E11.**
- [ ] Deploy additive database/API changes before enabling new client writes.
- [ ] Validate immutable/versioned content backfill and permanent receipt behavior.
- [BLOCKED] Deploy public assets before workers/manifests that reference them; retain
  supported previous assets. **E3.**
- [BLOCKED] Enable translation downloads only where rights are documented. **E8.**
- [BLOCKED] Release private downloads/offline edits only after account lifecycle acceptance
  (real-device evidence). **E7.**
- [ ] Monitor download failures, storage errors, sync/conflict outcomes, and lifecycle
  recovery without logging private payloads or tokens.
- [~] Rollback rehearsal: additive-only, non-destructive migration rollback is verified in
  the repo (`pwa-migration.integration.spec.ts`; no DROP/TRUNCATE; lower-version client
  fails safely). A live deploy rollback rehearsal is BLOCKED (no deploy pipeline). **E5.**
- [BLOCKED] Actual delivery-path/old-asset retention, trusted HTTPS and real iOS
  installed-PWA evidence before release. **E1–E7.**
- [x] Completion report separates **Changed**, **Verified**, and **Notes/remaining
  limitations** (per-task reports under `.superpowers/sdd/2026-10-01-pwa/`).

## Acceptance Gates Summary (current state)

- [x] **Gate 1 — Contracts:** Complete download sets, identities, revisions, idempotency,
  tombstones, conflicts, licensing, storage failures, and deployment assumptions have
  testable definitions (`2026-10-01-pwa-contracts.md`, tasks 1A/5/8/9, migration spec).
  Licensing has a fail-closed testable definition; the per-translation rights *evidence*
  is external (E8) and does not reopen the definition.
- [~] **Gate 2 — Installability:** Manifest/icons/scope work and private/RSC responses are
  never cached/substituted (unit + local headers verified). Cold offline hub hydration and
  real-origin worker headers remain unverified (harness BLOCKED; E1/E2).
- [~] **Gate 3 — Read-only downloads:** Explicit selected chapters/whole books survive
  restart in unit/repo tests; interrupted/mixed-version never ready; quota/update/removal
  recover safely. Real-browser restart-offline E2E is BLOCKED.
- [x] **Gate 4 — Server guarantees:** DB-backed `reader-sync` (incl. same-base and
  duplicate-operation races), `reader-security`, and `pwa-migration` pass on real disposable
  Postgres under Colima; replay-safe, tombstones, authoritative snapshots, ownership/access
  enforced; review-clean.
- [~] **Gate 5 — Local-first/account lifecycle:** Code complete and review-clean after three
  fix rounds (durable edits, ordered replay, cross-tab fencing, same-account reauth,
  conflict decisions, sync/discard exit, deferred logout). Real-browser/device lifecycle
  E2E is BLOCKED (Gate 5 is not device-verified).
- [BLOCKED] **Gate 6 — Release:** Production-like packaging is verified locally, but CDN
  old-asset retention, trusted-origin headers, current Chromium/real-iOS behavior, rolling
  compatibility, live accessibility, and the Sonar quality gate are unverified. Blocked by
  E1–E11.

Passing an earlier gate does not authorize releasing account-specific offline
functionality before Gate 5; Gate 5's device evidence is still outstanding, so private
downloads/offline edits must not be released.

## Cross-references and known caveats

- **14A retention blocker:** no repository-controlled mechanism guarantees prior-release
  hashed assets; ACA `Single` revision mode deprovisions old revisions and no CDN/static
  module exists. Required rule/evidence documented; release BLOCKED until E3 supplies proof.
  No guessed CDN config was created and `infra/*` was not modified.
- **14B CI caveats:** `pwa-chromium` is wired as a blocking job but **never observed green**
  (harness environment-blocked); 4 pre-existing drift integration suites
  (groups/chat/friends/auth) are excluded by honest scoping and need a tracked follow-up
  non-blocking lane; merge-blocking depends on branch protection requiring `gate` (E10).
- **Harness:** real-browser production E2E remains BLOCKED (14A harness supervisor reaped).
  Playwright WebKit is supplemental, not proof.
- **Pre-existing baseline failures:** api lint has no ESLint flat config; web `next lint`
  absent in Next 16; unrelated reader/auth integration drift.

## External blockers and suppliers

| # | Blocker | Supplier |
| --- | --- | --- |
| E1 | Edge path ownership for `/`, `/sw.js`, `/api/*`, `/graphql`, WS, `/_next/static/**` | Cloudflare/edge owner |
| E2 | `/sw.js` + `/pwa-assets.json` cache bypass evidence | Cloudflare/edge owner |
| E3 | Old hashed-asset retention after real A→B deploy | Cloudflare/edge owner + release operator |
| E4 | No Worker/Page Rule/Rocket Loader/HTML rewrite intercept | Cloudflare/edge owner |
| E5 | ACA revision mode/weights/overlap; live rollback rehearsal | Release operator |
| E6 | Trusted HTTPS on real origin without trust-store/security changes | Cloudflare/edge owner + release operator |
| E7 | Real iOS Safari + installed-PWA checks | QA/device owner |
| E8 | Per-translation offline rights records | Content/licensing owner |
| E9 | Live a11y / reduced-motion / theme sign-off | QA/accessibility owner |
| E10 | Branch protection requires the 14B `gate` | Repository admin |
| E11 | Push branch + open PR against `main`; observe `gh pr checks` | Release operator |

## Key operational findings (from Lane D research)

- **Cloudflare caches by file extension, so `/sw.js` is cacheable by default.** Next's
  `no-store` normally prevents it, but Page Rules `Cache Everything`/Edge Cache TTL, Cache
  Rules, or Workers can override. Add an explicit **Cache Rule bypass** for `/sw.js`; use a
  **Cache Rule** (not a Response Header Transform Rule) to change caching behavior.
- **Never "Purge Everything" during a PWA deploy.** Rely on immutable hashed assets +
  durable edge cache; purge only changed non-hashed URLs.
- **Azure Container Apps `Single` revision mode deprovisions old revisions automatically**,
  so old hashed chunks disappear from origin. Retention must come from the CDN/edge (or an
  external static asset origin via `assetPrefix`), not from ACA revision pinning alone.
  `Multiple` mode + weights/labels can bridge rollouts.
- **Background Sync / Periodic Sync / Background Fetch are not supported on iOS Safari** and
  are absent in Firefox. Foreground retry is mandatory for correctness; background APIs are
  enhancements only, and handlers must be idempotent.
- **Bible rights are license-class dependent:** public-domain (e.g. BSB, WEB), CC
  (CC0/PDM permissive; ND forbids reformatting; NC restricts commercial use), DBL
  custom/open licenses, and all-rights-reserved with limited quotation permission (e.g.
  ESV's ~500-verse grant) which is **not** an offline-copy license.

## Sources

Next.js: PWA guide, `output: standalone`, `headers`/Cache-Control, `assetPrefix`.
Cloudflare: default cache behavior, Cache Rules (overview/settings/order/create), Response
Header Transform Rules, Workers+cache, Page Rules.
Microsoft Learn: ACA revisions, traffic splitting, blue-green.
MDN/BCD: `Service-Worker-Allowed`, CSP `worker-src`, Background Sync, Background Fetch,
offline/background operation.
Licensing: Creative Commons licenses/CC0/PDM, U.S. Copyright Office, Digital Bible Library,
Crossway ESV permissions, eBible.

Caveats: cloud defaults vary by plan/location and can change; re-verify on the actual
account before final release. Licensing notes are guidance, not legal advice; the specific
source repository's license record is authoritative.
