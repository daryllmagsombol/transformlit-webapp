# Task 13A — Authenticated identity, auth-failure classification, and activation fencing

## Status

Implemented and committed. Every web auth activation path now routes through a
single account-lifecycle gate. Real-browser/Playwright verification remains
**BLOCKED** (no Docker/Chrome).

- Commit: `68feb57` — `feat(auth): fence offline account activation`
- Branch: `feature/pwa-lane-b`

## Discovery — activation/bootstrap/login/OAuth/refresh/logout call sites

Searched all auth activation and clearing sites before editing. Exact files
touched by this task:

- `apps/web/src/lib/offline/account-context.ts` — added owner/epoch helpers.
- `apps/web/src/lib/offline/account-lifecycle.ts` (**new**) — the activation/
  fencing gate and interfaces (`establishIdentity`, `installIdentity`,
  `writePermit`, `requireReplayIdentity`, `beginExit`/`completeExit`,
  `markAuthRequired`/`markTransient`, barrier persistence).
- `apps/web/src/lib/offline/account-activation.ts` (**new**) — the app-wide
  lifecycle singleton, epoch capture, and the C3 Bible-subject wiring.
- `apps/web/src/lib/offline/database.ts` — lifecycle/barrier persistence +
  IndexedDB/memory lifecycle persistence factories.
- `apps/web/src/lib/offline/contracts.ts` — `IdentityVerification`,
  `InstallOutcome`, `WritePermit`, `ReplayIdentity`, `ExitDecision`,
  `AuthFailureClassification`.
- `apps/web/src/lib/apollo-client.ts` — `refreshTokens`, `bootstrapAuth`,
  `doRefreshTokens`, `redirectToLogin`: classification + epoch fencing + Web
  Locks serialization; no direct token/user installs.
- `apps/web/src/lib/auth.ts` — lifecycle install tickets (`issueAuthInstallTicket`
  / `isAuthInstallTicket`) and `AuthHttpError`; never persists tokens.
- `apps/web/src/lib/offline/install-ticket.ts` (**new, Round 1**) — the
  lifecycle-owned ticket minter/guard, not re-exported from any public barrel.
- `apps/web/src/store/auth.ts` — replaced ungated `setAuth`/`setUser` with a
  ticket-gated `installAuth`.
- `apps/web/src/app/login/login-form.tsx` — local login via `completeLocalAuth`.
- `apps/web/src/app/register/register-form.tsx` — registration via
  `completeLocalAuth`.
- `apps/web/src/app/auth-redirect.tsx`, `apps/web/src/lib/hooks/use-require-auth.ts`
  — documented as display-only (not ownership authority).
- Specs: `account-lifecycle.spec.ts`, `account-activation.spec.ts`,
  `apollo-client.auth.spec.ts`, `auth.spec.ts`, `store/auth.spec.ts`,
  `login.spec.tsx`, `register.spec.tsx`.

Read but deliberately **not** edited (Lane A / Task 13B scope):
`apps/api/**` (session/logout), `apps/web/src/components/ui/user-menu.tsx`
(logout/drain is 13B), `apps/web/src/lib/reader/api.ts`,
`apps/web/playwright.pwa.config.ts`.

OAuth start/return: OAuth providers redirect to `/login` with no URL tokens;
the httpOnly refresh cookie is exchanged by `bootstrapAuth()` on mount, which
now crosses the same gate. No separate OAuth return module exists.

## What was implemented

- **Two-layer identity check.** `installIdentity` verifies the origin lifecycle
  epoch, then `establishIdentity` verifies the subject. A delayed refresh/login
  result tagged with a stale epoch (or a different subject) installs nothing.
  Nothing installs from a persisted display profile alone.
- **Ticket-gated store installs.** `useAuthStore.setAuth`/`setUser` were removed;
  `installAuth(user, token, ticket)` requires a ticket minted only by the
  lifecycle gate. A component cannot bypass the scaffold via a direct setter.
- **Failure classification.** `classifyAuthFailure`/`classifyAuthError` map
  genuine 401 to `AUTH_REQUIRED` and network/5xx to `TRANSIENT`. Genuine auth
  failure pauses replay (`requireReplayIdentity → PAUSED/AUTH_REQUIRED`) but
  preserves the local owner; a transient outage preserves ownership and does
  not fabricate a reauth state.
- **Cross-tab refresh serialization.** `refreshTokens()`/`bootstrapAuth()` run
  inside the `transformlit-auth-refresh` Web Lock (when available) and an
  in-tab shared promise, so the rotating cookie is not double-spent across
  tabs. Notifications carry no tokens.
- **Durable barrier.** `readBarrier`/`writeBarrier`/`clearBarrier` live in the
  `lifecycle` IndexedDB store, so a sign-out/switch barrier survives restart;
  a present barrier makes activation fail closed.
- **Exit scaffolding is fail-closed.** `beginExit`/`completeExit` return
  `BLOCKED: EXIT_NOT_IMPLEMENTED` rather than clearing data or switching
  subjects. Task 13B completes exit/drain/logout.
- **C3 wiring (mandatory).** Every successful activation calls
  `useBibleStore.setAccountSubject(subject)`, resetting the per-account Bible
  position/index so a previous account's position cannot surface under another.
  **Scope correction (Round 1):** same-subject activation is gate-wired and
  proven; a real A→B gate-level switch cannot traverse the gate until Task 13B
  (exit/drain). The A→B reset is proven through the public Bible seam the gate
  drives, not through a completed gate-level account switch.

## TDD evidence

- **RED:** reverted the gate to pre-fix behavior (removed epoch/subject/barrier
  checks, weakened the ticket gate, disabled the status classifier) and ran the
  new specs: **8 failed / 31 passed**. Failures were exactly stale-epoch,
  subject-mismatch, different-subject-while-owned, barrier, forged-ticket,
  no-ticket, and stale/different-subject session installs.
- **GREEN:** restored the implementation; focused specs pass (39/39), full suite
  passes (108 suites / 830 tests).

## Verification

- `pnpm --filter @transformlit/web test --runInBand` — **108 suites / 830 tests passed** (pre-fix).
- `pnpm --filter @transformlit/web typecheck` — passed.
- `pnpm --filter @transformlit/web build` — passed (Next.js 16.3.6).
- `git diff --check` — passed.
- Real-browser/Playwright — **BLOCKED** (no Docker/Chrome); no browser result
  claimed. The JS auth/fencing behavior above is fully unit-covered in jsdom.

## Notes / deferrals

- **Task 13B** owns exit/drain/logout, remote session invalidation, deferred
  logout completion, and account-data cleanup. The API-side session/logout
  change needed to invalidate the old HttpOnly cookie offline remains out of
  Lane B scope (Lane A) and is flagged here rather than edited.
- Private downloads/replay stay fail-closed: no code enables them; the gate's
  `writePermit`/`requireReplayIdentity` are the seams Tasks 6/11 consume.
- `markTransient()` intentionally does not clear a pending `AUTH_REQUIRED`
  state; only a successful same-subject activation resumes replay.
- No tokens are persisted; the access token remains memory-only.

## Round 1 fix — review findings (C1–C2, I1–I4, M1–M2)

### Status

All Critical and Important items addressed; M1/M2 fixed as cheap in-lane
changes. No new dependencies. Real-browser verification remains **BLOCKED**.

### RED / GREEN evidence

RED captured by mutating the fixed code back to the pre-fix policy
(unconditional clear+redirect on every failure; `hydrate()` a no-op) and running
the specs: **7 failed / 21 passed**. Failures were exactly the transient
preservation (refresh + bootstrap + network) and the 401 non-clear, plus all
three cold-start rehydration cases.

GREEN after restore: focused specs 74/74, full suite 108 suites / 841 tests.

### Changes

- **C1 — transient refresh no longer logs out.** `doRefreshTokens`'s catch only
  clears the session and redirects when `classifyAuthError` returns
  `AUTH_REQUIRED`. A 5xx/network failure calls `markTransient()` and returns
  false without clearing the token, the in-memory user, the persisted
  `auth-storage` profile, or navigating.
- **C2 — bootstrap same gate.** `bootstrapAttempt` clears/redirects only on
  `AUTH_REQUIRED`; a cold-start transient outage now preserves the persisted
  profile instead of discarding it.
- **Mandatory test.** Added `destructive-policy separation (C1/C2)` coverage:
  503 (refresh), 502 (cold-start bootstrap), and a network `TypeError` all
  keep `useAuthStore.user` + persisted `auth-storage` and never invoke the
  redirect seam; a 401 still clears both and redirects once. The redirect is a
  small injectable seam (`setAuthRedirectForTests`) because jsdom's `location`
  is non-configurable; production behavior is unchanged and the real clear +
  redirect path still runs on 401.
- **I1 — cold-start ownership rehydrated.** `AccountLifecycle.hydrate()`
  (idempotent) restores the persisted owner; `bootstrapAuth` and every
  `activateIdentity`/`installEpochTaggedAuth`/`completeLocalAuth` call it, so
  the different-subject fail-closed guard applies across restarts. Tests cover
  restore-after-restart, idempotency, and a blocked different-subject result
  across a restart.
- **I2 — report corrected.** C3 wording now states same-subject activation is
  gate-wired/proven and that a real A→B gate traversal is Task 13B; the
  seam-level A→B test remains.
- **I3/I4 — hard gate.** The ticket minter `issueAuthInstallTicket` now lives
  in the lifecycle-owned `lib/offline/install-ticket.ts`, which is not part of
  any public barrel; `lib/index.ts` no longer re-exports `setAccessToken`
  (verified: no consumers of the barrel). Internal importers were updated.
- **M1 — install-ticket success honored.** `installEpochTaggedAuth` binds
  account-scoped state only when `install(ticket)` returns true; a rejected
  install now returns `BLOCKED` instead of claiming activation.
- **M2 — local auth verified.** `completeLocalAuth` decodes the access-token
  `sub` and requires it to equal `user.id` before activating, and captures the
  lifecycle epoch like refresh does.

### Deferred minors (recorded, not fixed)

- M3/M4/M5 (as flagged by review) were not separately enumerated here beyond
  the I3/I4 export tightening.

### Round 1 verification

- RED: mutated code → 7 targeted failures as above.
- `pnpm --filter @transformlit/web test --runInBand` — **108 suites / 841 tests passed**.
- `pnpm --filter @transformlit/web typecheck` — passed.
- `pnpm --filter @transformlit/web build` — passed (Next.js 16.3.6).
- `git diff --check` — passed.
- Real-browser/Playwright — **BLOCKED**; no browser result claimed.
