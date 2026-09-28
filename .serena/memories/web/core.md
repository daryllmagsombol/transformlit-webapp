# Web Core (`apps/web/`)

## Structure

- `src/app/` — Next.js App Router (route → component map in `mem:web/routes`)
  - `layout.tsx` (root), `page.tsx` (landing), `login/`, `register/`
  - `auth-redirect.tsx` — **guard** that bounces signed-in users from public pages to `/feed`.
    It does NOT parse tokens (an older flow put tokens in the URL; that is gone).
  - `(app)/` — authenticated group, wrapped by `AppShell` (TopBar + Sidebar + BottomNav)
  - `(reader)/` — immersive book reader, deliberately OUTSIDE the app shell
  - `error.tsx`, `loading.tsx`, `not-found.tsx` boundaries
- `src/components/` — `ui/` (design system) + feature dirs `bible/ chat/ friends/ groups/ home/ layout/ notifications/ providers/ reader/`
- `src/lib/` — non-React logic: `apollo-client.ts` (10k), `auth.ts`, `groups.ts`, `chat-queries.ts`, `constants.ts`, `motion.ts`, `time.ts`, plus dirs `bible/`, `reader/`, `hooks/`
- `src/store/` — Zustand stores (`auth-store`, `chat-store`, `ui-store`, `bible-store`, `reader-store`)
- `src/styles/globals.css` — the ONLY stylesheet (Tailwind v4 `@theme`; no `tailwind.config.js`)

## Non-obvious details

- **No `middleware.ts`.** Auth gating is entirely client-side (`useRequireAuth`,
  `auth-redirect.tsx`). Do not assume server-side route protection.
- **No GraphQL hooks.** Data access is imperative `apolloClient.query/mutate` + `useState`
  (19 files). Match this; see `mem:web/data-fetching`.
- **`app/(app)/layout.tsx`** is a thin wrapper: `AuthenticatedLayout` → `ApolloProvider` + `AppShell`.
- **API base**: `NEXT_PUBLIC_API_URL` (default `http://localhost:3005/graphql`); `API_BASE` in
  `lib/constants.ts` is that value with `/graphql` stripped, for REST calls.

## Testing

- Unit: Jest 30 + React Testing Library; `testRegex .*\.spec\.(ts|tsx)$`, setup `jest.setup.ts`
  (mocks `matchMedia` + `IntersectionObserver`). Specs are **co-located**; `test/` holds only
  `helpers/render-with-providers.tsx` and `__mocks__/`.
- E2E: Playwright in `apps/web/e2e/` (`playwright.config.ts`); requires API + web running.
  Note `next lint` no longer exists in Next 16 — see `mem:suggested_commands`.

## Key Gotchas

- No `.js` extension in imports (bundler resolution)
- CORS: API allows the web origin; dev is cross-origin (`:3000` → `:3005`)
- CSP is set in `next.config.ts` and is environment-aware; dev needs `'unsafe-eval'`,
  prod is strict. Adding a new external host (image/font/media) requires editing those directives
- Animating? Read `mem:web/motion` first — transform on a wrapper breaks fixed-position FABs

## Related

- `mem:web/routes` — which component renders each route
- `mem:web/data-fetching` — Apollo/REST/external patterns + auth wiring
- `mem:web/components` — UI inventory
- `mem:build/startup` — build graph and the `packages/shared` dist trap
