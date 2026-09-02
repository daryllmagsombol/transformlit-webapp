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

Some modules add a REST controller (e.g. `auth.controller.ts` for OAuth callback redirects).

## Import Style

- All API imports use `.js` extension: `import { PrismaService } from '../prisma/prisma.service.js'`
- This is required by NodeNext module resolution in the API app
- Web app uses bundler resolution — no `.js` extension needed

## Naming

- Files: `<domain>.<role>.ts` (e.g. `users.service.ts`, `auth.resolver.ts`)
- Classes: PascalCase, role-suffixed (`UsersService`, `AuthResolver`, `PrismaModule`)
- NestJS decorators: `@Resolver()`, `@Query(() => Type)`, `@Mutation(() => Type)`
- GraphQL schema: code-first (auto-generated from decorators), not SDL-first
- Prisma models: PascalCase in schema, mapped to snake_case tables (`model User { @@map("users") }`)
- Prisma queries filter soft-deletes: always include `deletedAt: null` when reading soft-deletable entities

## Auth Pattern

- GraphQL queries/mutations: guard with `@UseGuards(JwtAuthGuard)` + extract user via `@CurrentUser()`
- REST endpoints (OAuth callbacks): guard with `@UseGuards(AuthGuard('google'))` etc.
- Public endpoints: decorate with `@Public()` decorator from `../common/decorators/public.decorator.js`
- Refresh tokens: rotated on use, family-based reuse detection, SHA-256 hashed in DB

## Frontend Patterns

- App Router with route groups: `(app)/` for authenticated routes
- Zustand for client state, Apollo for server state
- React Hook Form + Zod for form validation
- Tailwind CSS v4 (CSS-first config via `@tailwindcss/postcss`)
- Motion (Framer Motion successor) for animations