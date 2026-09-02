# Web Core (`apps/web/`)

## Structure

- `src/app/` — Next.js App Router
  - `layout.tsx` — root layout
  - `page.tsx` — landing/home page
  - `login/` — login page
  - `register/` — registration page
  - `auth-redirect.tsx` — handles OAuth token callback from API
  - `(app)/` — route group for authenticated pages
  - `error.tsx`, `loading.tsx`, `not-found.tsx` — Next.js error/loading/not-found boundaries
- `src/components/` — shared React components
- `src/lib/` — utilities, Apollo client setup, API helpers
- `src/store/` — Zustand stores (client state)
- `src/styles/` — global styles
- `public/` — static assets

## Tech Details

- **Apollo Client 4** — configured in `src/lib/`, connects to API at `NEXT_PUBLIC_API_URL` (default `http://localhost:3005/graphql`)
- **GraphQL-WS** — subscriptions via `graphql-ws` client, auth token passed in connection params
- **Tailwind CSS v4** — CSS-first config via `@tailwindcss/postcss` (no `tailwind.config.js`)
- **Zustand 5** — lightweight client state (auth state, UI state)
- **React Hook Form + Zod** — form handling with schema validation
- **Motion** — animations (Framer Motion successor)

## Testing

- **Unit**: Jest + React Testing Library (`test/` directory). Jest config in `jest.config.ts`, setup in `jest.setup.ts`.
- **E2E**: Playwright (`e2e/` directory). Config in `playwright.config.ts`. Requires API running on port 3005.
- Test files: `*.spec.tsx` / `*.spec.ts` co-located or in `test/` directory.

## Key Gotchas

- **No `.js` extension needed** in imports (bundler module resolution)
- **`pnpm dev` runs on port 3000** (Next.js), API on port 3005 — CORS configured in API to allow frontend origin
- **Auth tokens live in URL params** after OAuth redirect — `auth-redirect.tsx` parses them and stores in Apollo/localStorage
- **No `tailwind.config.js`** — Tailwind v4 uses CSS-first config via PostCSS plugin