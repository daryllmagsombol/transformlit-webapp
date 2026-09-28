# Conventions

## API Module Structure (`apps/api/src/`)

Each domain follows a consistent NestJS module pattern:

```
<domain>/
  <domain>.module.ts        — NestJS module declaration
  <domain>.resolver.ts      — GraphQL resolver (queries + mutations)
  <domain>.resolver.spec.ts — resolver unit tests
  <domain>.service.ts       — business logic, Prisma queries
  <domain>.service.spec.ts  — service unit tests
  models/                   — GraphQL type definitions (InputType, ObjectType)
  guards/                   — auth guards (e.g. JwtAuthGuard)
  strategies/               — Passport strategies (e.g. GoogleStrategy)
```

Some modules add a REST controller (e.g. `auth.controller.ts` for OAuth callbacks + cookie auth).

## Import Style

- API imports use `.js` extension: `import { PrismaService } from '../prisma/prisma.service.js'`
  (required by NodeNext). Web uses bundler resolution — no extension.

## Naming

- Files `<domain>.<role>.ts`; classes PascalCase role-suffixed (`UsersService`, `AuthResolver`).
- GraphQL schema is **code-first** (auto-generated `schema.gql`) — never edit `schema.gql` by hand.
- Prisma models PascalCase, mapped to snake_case tables (`model User { @@map("users") }`).
- Always filter soft deletes: include `deletedAt: null` when reading soft-deletable entities.

## GraphQL contract discipline (caused a real outage)

- NestJS `@Field()` is **non-null by default**, so the emitted schema has `field: Type!`.
  If a Prisma `select` omits such a field, GraphQL throws
  `Cannot return null for non-nullable field …` and the whole query fails (the `/users`
  Members page died this way because a "public" projection dropped `role`).
- When building a `select` projection for a GraphQL object type, either include every
  non-null field, or mark the field nullable in the model. Prefer including the field and
  keeping PII (`email`, `status`) out.
- Unit tests that mock Prisma **cannot catch this** — validate against the real API
  (`mem:verification/browser-and-blindspots`).
- PII rule: public/list projections exclude `email` and `status`; `role` is required for the
  UI and is public.

## Testing layout

- **API**: `*.spec.ts` co-located in `src/`; integration specs in `apps/api/test/*.integration.spec.ts`
  (Testcontainers).
- **Web**: `*.spec.tsx|ts` co-located next to source (`testRegex: .*\.spec\.(ts|tsx)$`).
  Two exceptions live in `components/ui/__tests__/`. `apps/web/test/` holds only helpers
  (`helpers/render-with-providers.tsx`) and `__mocks__/` — NOT the test files.

## Frontend Patterns

- App Router with route groups `(app)/` (shell) and `(reader)/` (immersive, no shell)
- Zustand for client state; Apollo (imperative) for server state — see `mem:web/data-fetching`
- React Hook Form + Zod for forms; Tailwind v4 CSS-first config (no `tailwind.config.js`)
- Motion for animation — read `mem:web/motion` before animating (there are hard constraints)

## SonarQube compliance

Project mandates SonarQube rules (see root `AGENTS.md` + `docs/SONAR-GUIDELINES.md`): no direct
`window` (use `globalThis.window`), no array-index React keys, no unused imports, `readonly`
props, optional chaining, no nested ternaries, cognitive complexity ≤ 15.

**Caution**: a SonarQube-driven refactor introduced the `<dialog>` regression. Semantic-HTML
"fixes" must preserve required functional attributes — see `mem:bible-strongs-popup-dialog-pitfall`.
