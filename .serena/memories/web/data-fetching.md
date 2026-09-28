# Web Data Fetching

## Three distinct mechanisms — pick by concern

1. **Apollo (GraphQL)** — the default for app data. NOTE: the codebase uses the
   **imperative client**, not hooks: `apolloClient.query()` / `.mutate()` inside
   `async` handlers + `useState` (19 files). `useQuery`/`useMutation` hooks are
   NOT used anywhere. Do not introduce hooks; match the imperative pattern.
2. **REST `fetch`** — auth only (`login-form`, `register-form`, `apollo-client`
   refresh, `lib/reader/api.ts` file streaming) via `API_BASE` from `lib/constants.ts`.
3. **Plain `fetch` to external APIs** — the Bible content API (bible.helloao.org),
   see `mem:bible/domain`.

## Conventions

- **Query documents are often module-level consts in `lib/`**, not inline in components:
  `export const GROUP_BY_SLUG_QUERY = gql\`...\`` in `lib/groups.ts`, `lib/reader/api.ts`,
  `lib/chat-queries.ts`. Some components define theirs locally (e.g. `users-client.tsx`,
  `friends-client.tsx`). Follow whichever the surrounding file already does.
- `lib/groups.ts` is a **service layer** that wraps `apolloClient` calls + normalises
  errors — prefer calling it over raw `apolloClient` in group UI.
- Consumers import shared GraphQL result types from `@transformlit/shared`
  (e.g. `GraphQLUser`, `GraphQLGroup`), which must be built — `mem:build/startup`.

## Auth

- Access token attached by a `SetContextLink` `authLink` in `lib/apollo-client.ts`
  (`authorization: Bearer <token>`); refresh handled there too via
  `callRestRefresh()` → `POST /auth/refresh` with `credentials:'include'`.
- The **refresh token is an httpOnly cookie** (`transformlit_refresh`) and never reaches JS.
- The **access token is browser-memory ONLY** (`lib/auth.ts` → module-level `let memoryAccessToken`).
  It is NOT persisted. The Zustand auth store persists to localStorage under `auth-storage`,
  but `partialize` saves **only `user`** — never the token.
- Consequence: a page reload has no token, so the session must bootstrap via
  `POST /auth/refresh` (the httpOnly cookie). Do not "fix" a reload by persisting the token.
  This is why several ops briefly 401 then succeed on cold load.
- Web has **no `middleware.ts`**. Auth gating is client-side: `useRequireAuth()`
  (`lib/hooks/use-require-auth.ts`) redirects to `/login?redirect=<path>`, and
  `app/auth-redirect.tsx` bounces signed-in users away from public pages.

## Known behaviour

- On a cold load, some GraphQL ops briefly return `Unauthorized` and then succeed
  after the refresh cycle — benign; see `mem:verification/browser-and-blindspots`.

## Related

- Component/hook locations: `mem:web/components`
- Auth flow detail: `mem:api/core`
