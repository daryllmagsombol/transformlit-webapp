# Core

## Source Map

- `apps/api/` — NestJS 11 backend, GraphQL (Apollo) + REST, Prisma 7 ORM, PostgreSQL
- `apps/web/` — Next.js 16 frontend (App Router under `src/app/`), React 19, Tailwind CSS v4, Apollo Client, Zustand
- `packages/shared/` — shared utilities across apps
- `packages/graphql/` — shared GraphQL codegen types and operations

## Top-Level Invariants

- pnpm workspaces + Turborepo for orchestration. All root scripts (`dev`, `build`, `lint`, `test`) run through turbo.
- Prisma config lives at repo root: `prisma.config.ts` (schema path `apps/api/prisma/schema.prisma`, seed command `tsx apps/api/prisma/seed.ts`).
- DB is PostgreSQL. Local connection: `postgres:postgres@localhost:5432/transformlit`. Prisma uses driver adapter (`@prisma/adapter-pg` + `pg`), not the built-in engine.
- Prisma 7 does NOT auto-load `.env` files. CLI commands (migrate/seed) need `DATABASE_URL` in shell env — source `apps/api/.env` before running.
- Integration tests use Testcontainers (`@testcontainers/postgresql`) spinning up `postgres:15-alpine`.

## Module Map

API modules (all in `apps/api/src/`): auth, users, groups, friends, chat, books, feed, notifications, azure, health, prisma.

Web app routes (all in `apps/web/src/app/`): root, login, register, auth-redirect, and `(app)/` route group for authenticated pages.

## Key Files

- `mem:tech_stack` — versions, frameworks, pinned dependencies
- `mem:suggested_commands` — dev, test, lint, DB operations
- `mem:conventions` — code style, naming, patterns
- `mem:task_completion` — verification checklist
- `mem:api/core` — API-specific module structure and patterns
- `mem:web/core` — web app-specific patterns