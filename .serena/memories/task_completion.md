# Task Completion

## Verification Checklist (ordered, cheapest first)

### 1. Type check / build

```bash
pnpm build                                   # turbo; builds workspace deps first
pnpm --filter @transformlit/web build        # web only
pnpm --filter @transformlit/api build        # api only
```

Or scoped typecheck: `pnpm --filter <pkg> exec tsc --noEmit`.

### 2. Unit tests (the real gate)

```bash
pnpm test                                    # all packages via turbo
pnpm --filter @transformlit/web exec jest <path>
pnpm --filter @transformlit/api test -- <pattern>
pnpm --filter @transformlit/shared test
```

### 3. Lint — ⚠️ BROKEN, do not rely on it

`pnpm lint` fails for pre-existing reasons (no flat `eslint.config.js` in API; `next lint`
removed in Next 16). See `mem:suggested_commands`. Do not report lint as passing.

### 4. Integration tests (DB/API logic changed)

```bash
set -a; source apps/api/.env; set +a
pnpm test:integration
```

### 5. E2E (web UI flows changed)

```bash
pnpm test:e2e    # needs API + web up
```

### 6. Browser verification — REQUIRED for UI/style/scroll/focus/event work

jsdom does not catch computed-style, layout, scroll, or real browser-event bugs. Two
confirmed false positives exist in this repo. Recipe + triage:
`mem:verification/browser-and-blindspots`.

### 7. Housekeeping

```bash
pnpm format                                   # Prettier (works)
pnpm graphql:codegen                          # if GraphQL types/queries changed
```

## Failure modes

- **`packages/shared` must be built** before API/web typecheck or tests can resolve
  `@transformlit/shared`. `dist/` is gitignored — see `mem:build/startup`.
- **Prisma client must be generated** after a schema change (`db:generate`).
- **Filtered commands bypass turbo** and therefore skip `^build` dependency builds.
- **Integration tests self-provision Postgres** via Testcontainers — no seed/migrate needed.
- **Web e2e requires both servers running.**
- **`EADDRINUSE`** on startup usually means a stale/orphaned server from a previous run
  (orphans survive SIGTERM) — see `mem:build/startup`.

## Before claiming a failure is yours

Stash only your files, re-run, then pop. This repo has multiple pre-existing failures
(API lint, `tsc` rootDir error in `pdf.converter.spec.ts`, `next lint`). Distinguish
pre-existing from introduced. Details: `mem:verification/browser-and-blindspots`.

## Related

- `mem:verification/browser-and-blindspots` — false positives + authenticated GraphQL smoke test
- `mem:build/startup` — startup traps
