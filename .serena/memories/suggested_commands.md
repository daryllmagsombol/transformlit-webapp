# Suggested Commands

## Development

- `pnpm dev` — start all apps in watch mode (turbo orchestrates; API on port 3005, web on port 3000)
- `pnpm build` — production build all apps
- `pnpm clean` — remove all dist/build artifacts

## Testing

- `pnpm test` — unit tests across all apps (Jest)
- `pnpm test:integration` — integration tests (Testcontainers spins up Postgres)
- `pnpm test:e2e` — end-to-end tests (Playwright in apps/web)
- `pnpm test:coverage` — coverage report

## Linting & Formatting

- `pnpm lint` — ESLint across all apps
- `pnpm format` — Prettier write (`**/*.{ts,tsx,json,md}`)

## GraphQL

- `pnpm graphql:codegen` — generate shared GraphQL types and operations

## Database (run from `apps/api/` or root)

- `pnpm --filter @transformlit/api db:generate` — regenerate Prisma client after schema changes
- `set -a; source apps/api/.env; set +a; pnpm --filter @transformlit/api db:migrate` — create/apply dev migrations (opens prisma migrate dev)
- `set -a; source apps/api/.env; set +a; pnpm --filter @transformlit/api db:migrate:deploy` — apply pending migrations in CI/deploy
- `set -a; source apps/api/.env; set +a; pnpm --filter @transformlit/api db:seed` — seed database (idempotent upserts)
- `set -a; source apps/api/.env; set +a; pnpm --filter @transformlit/api db:studio` — open Prisma Studio GUI

### DB Gotcha

Prisma 7 does NOT auto-load `.env`. Always source `apps/api/.env` before any Prisma CLI command, or export `DATABASE_URL` manually. The `prisma.config.ts` at repo root reads `process.env.DATABASE_URL`.

## Per-App (from `apps/api/`)

- `pnpm dev` — NestJS in watch mode
- `pnpm build` — production build
- `pnpm lint` — ESLint
- `pnpm graphql:schema` — generate GraphQL schema file

## Per-App (from `apps/web/`)

- `pnpm dev` — Next.js dev server on port 3000
- `pnpm build` — production build
- `pnpm lint` — next lint
- `pnpm test:e2e` — Playwright tests

## Darwin-Specific

- Homebrew-managed PostgreSQL: `brew services start postgresql@15` (or whichever version is installed)
- `createdb transformlit` — only needed on fresh setup (DB must exist before Prisma migrate)
- Default superuser on macOS Homebrew Postgres is your macOS username, NOT `postgres`. The project `.env` expects `postgres:postgres@localhost:5432/transformlit`. To make this work: `psql -d postgres -c "CREATE ROLE postgres WITH LOGIN SUPERUSER PASSWORD 'postgres';" && createdb -O postgres transformlit`