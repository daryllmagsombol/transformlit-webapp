# Suggested Commands

## Development

- `pnpm dev` — all apps via turbo (API `:3005`, web `:3000`). Turbo builds workspace deps first.
- `pnpm build` / `pnpm clean` — build / remove dist+`.next`

## Testing

- `pnpm test` — unit tests across all apps (Jest). Currently green: 546 API, 708 web, 127 shared.
- `pnpm test:integration` — Testcontainers Postgres (`postgres:15-alpine`), specs in `apps/api/test/`
- `pnpm test:e2e` — Playwright in `apps/web/e2e`; needs API + web running
- `pnpm --filter @transformlit/web exec jest <path>` — scope web tests
- `pnpm --filter @transformlit/api test -- <pattern>` — scope API tests

## Formatting

- `pnpm format` — Prettier over `**/*.{ts,tsx,json,md}`. Works.

## ⚠️ Lint is currently BROKEN at the root — do not rely on it

`pnpm lint` fails. Two independent, pre-existing causes:

- **`apps/api`**: script is `eslint "src/**/*.ts"`, ESLint 10 is installed, but there is **no
  `eslint.config.js`** (flat config required since ESLint 9) → exits 2.
- **`apps/web`**: script is `next lint`, which **no longer exists in Next 16** — it is parsed as
  a directory and fails ("Invalid project directory … /lint").

Use `pnpm test` + `pnpm build` (+ `tsc --noEmit` per package) as the real gates.
`packages/shared` "lint" is just `tsc --noEmit`, so it does work.

## GraphQL

- `pnpm graphql:codegen` — regenerate shared GraphQL types/operations
- API: `pnpm --filter @transformlit/api graphql:schema` — regenerate `apps/api/src/schema.gql`.
  That file is **auto-generated (code-first) — never edit it by hand**; change decorators instead.

## Database

Always source env first (Prisma 7 does not read `.env`):

```bash
set -a; source apps/api/.env; set +a; pnpm --filter @transformlit/api db:<cmd>
```

- `db:generate` — regenerate Prisma client (required after schema change)
- `db:migrate` / `db:migrate:deploy` / `db:seed` / `db:studio`

### DB Gotcha

Prisma 7 does NOT auto-load `.env`; `prisma.config.ts` reads `process.env.DATABASE_URL`.

## Darwin-Specific

- Homebrew Postgres: `brew services start postgresql@15`. Default superuser is your macOS
  username, NOT `postgres`, but `.env` expects `postgres:postgres`. Fix:
  `psql -d postgres -c "CREATE ROLE postgres WITH LOGIN SUPERUSER PASSWORD 'postgres';" && createdb -O postgres transformlit`
- `timeout` is NOT available on macOS by default (GNU coreutils); use `&` + `sleep` or `gtimeout`.

## Related

- Startup failure modes (`EADDRINUSE`, missing `shared/dist`): `mem:build/startup`
