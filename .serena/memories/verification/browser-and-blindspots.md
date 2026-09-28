# Verification & False Positives

## jsdom blind spots (this repo has been bitten twice)

Unit tests passing does NOT mean the feature works. Two confirmed cases where the
Jest suite was green while the feature was completely broken in a browser:

1. **Native `<dialog>` missing `open`** → computes to `display:none`; jsdom doesn't
   apply UA dialog styles, so queries still found the children. See `mem:bible-strongs-popup-dialog-pitfall`.
2. **A `hashchange` listener that never fires** → Next.js App Router navigates with
   `history.pushState`/`replaceState`, which do **not** emit `hashchange` (verified in
   a real browser; `hashchange` appears nowhere in Next's client code). A test that
   dispatched a synthetic `hashchange` passed while real in-app navigation never scrolled.

Rule: for anything involving **computed styles, layout/scroll, focus, or browser
events**, verify in a real browser; do not trust jsdom alone.

## Real-browser verification recipe

- Servers must be up: API `:3005`, web `:3000`. Check with `curl localhost:3005/health`
  and `curl -o /dev/null -w '%{http_code}' localhost:3000/login`.
- Playwright's bundled Chromium works headless; the `playwright_browser_*` MCP tool
  requires Chrome installed at the system path and may fail — prefer a throwaway
  `import { chromium } from '@playwright/test'` script run via `node`.
- Log in with seeded users: `admin@transformlit.com` / `Transformlit123!` (ADMIN),
  `sarah@transformlit.com` / `password123` (MEMBER). See `mem:seeded-data`.
- Assert on **computed style / bounding box / `getBoundingClientRect`**, not just DOM presence.
- Poll for async transitions instead of a single snapshot — chapter/verse content mounts
  asynchronously and smooth-scrolls, so a one-shot read produces flaky false negatives.
- Delete any scratch verification script afterwards; do not leave `*.mjs` probes in the repo.

## Provenance: pre-existing vs introduced

Before claiming a failure is yours, stash only your files and re-run:
`git stash push -- <your files>` → re-run → `git stash pop`.
This has already distinguished: a `tsconfig` `rootDir` error (pre-existing) and an
`/users` GraphQL failure (pre-existing) from real regressions.

## Authenticated GraphQL smoke test (bypasses mocks)

Unit tests mock Prisma, so they cannot catch non-null/select mismatches. Hit the real API:

```bash
TOKEN=$(curl -s -X POST localhost:3005/auth/login -H 'content-type: application/json' \
  -d '{"email":"admin@transformlit.com","password":"Transformlit123!"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["accessToken"])')
curl -s -X POST localhost:3005/graphql -H 'content-type: application/json' \
  -H "authorization: Bearer $TOKEN" -d '{"query":"{ users { id displayName role } }"}'
```

## Known benign noise

- **Transient `Unauthorized` on first load**: several ops (e.g. `unreadNotificationCount`,
  `conversations`, `myGroups`) fail then immediately succeed via the token-refresh
  cycle. Confirm it is transient by checking the same op later succeeds — not a bug.
- **`act(...)` warnings** from async state updates in tests are noise if the suite passes.

## Related

- Commands + which ones are currently broken: `mem:suggested_commands`
- Completion checklist: `mem:task_completion`
