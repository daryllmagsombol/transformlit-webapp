# Core

## Source Map

- `apps/api/` — NestJS 11 backend, GraphQL (Apollo) + REST, Prisma 7 ORM, PostgreSQL
- `apps/web/` — Next.js 16 frontend (App Router under `src/app/`), React 19, Tailwind CSS v4, Apollo Client, Zustand
- `packages/shared/` — shared enums/schemas/types. **Must be built to be importable** (`mem:build/startup`)
- `packages/graphql/` — shared GraphQL codegen types and operations (generated `__generated__/` is gitignored)

## Top-Level Invariants

- pnpm workspaces + Turborepo. Root scripts (`dev`, `build`, `test`, …) go through turbo.
  Root `dev`/`build` auto-build workspace deps (`dependsOn: ["^build"]`); **filtered** commands do not.
- Prisma config lives at repo root: `prisma.config.ts` (schema path `apps/api/prisma/schema.prisma`, seed `tsx apps/api/prisma/seed.ts`).
- DB is PostgreSQL. Local `postgres:postgres@localhost:5432/transformlit`. Prisma uses the driver adapter (`@prisma/adapter-pg` + `pg`), not the built-in engine.
- Prisma 7 does NOT auto-load `.env`. CLI commands need `DATABASE_URL` sourced from `apps/api/.env`.
- Prisma tables/columns are snake_case / quoted camelCase — raw SQL must quote (`"userId"`, `"deletedAt"`).
- Integration tests use Testcontainers (`postgres:15-alpine`), specs in `apps/api/test/*.integration.spec.ts`.

## Module Map

API modules (all in `apps/api/src/`): auth, users, groups, friends, chat, books, feed, notifications, azure, storage, health, prisma.
Web feature areas (in `apps/web/src/components/`): bible, chat, friends, groups, home, layout, notifications, providers, reader, ui.

## Key Files

- `mem:tech_stack` — versions, frameworks, pinned dependencies
- `mem:build/startup` — build graph, the `packages/shared` dist trap, ports/orphaned processes
- `mem:suggested_commands` — dev, test, DB operations, **and which commands are currently broken**
- `mem:conventions` — code style, naming, patterns
- `mem:task_completion` — verification checklist
- `mem:verification/browser-and-blindspots` — jsdom false positives, real-browser recipe, pre-existing-vs-introduced triage
- `mem:seeded-data` — login credentials, seeded groups, local DB facts
- `mem:api/core` — API module structure, auth flow (REST + OAuth cookie flow), gotchas
- `mem:web/core` — web app structure, entry points, non-obvious details (no middleware, no GraphQL hooks)
- `mem:web/routes` — route → client-component map (read this before exploring a page)
- `mem:web/components` — `components/ui` inventory + overlay conventions
- `mem:web/data-fetching` — Apollo vs REST vs external fetch, auth wiring
- `mem:web/motion` — motion tokens/variants, native-feel invariants, reduced motion
- `mem:web/overlays` — Modal/Sheet/Confirm semantics and stacking rules
- `mem:bible/domain` — Bible reader (external API, translations, Strong's, deep links)
- `mem:bible-strongs-popup-dialog-pitfall` — the `<dialog open>` regression + why tests missed it
- `mem:testing-motion-in-jsdom` — AnimatePresence/fake-timer behaviour in Jest
- `mem:memory_maintenance` — how to add/update memories
