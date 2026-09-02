# API Core (`apps/api/`)

## Entry & Config

- `src/main.ts` — NestJS bootstrap (Express 5 adapter, CORS, GraphQL subscriptions)
- `src/app.module.ts` — root module importing all domain modules + ConfigModule + GraphQLModule
- `.env` / `.env.example` — local secrets (DATABASE_URL, JWT_SECRET, OAuth creds, Azure creds)
- `nest-cli.json` — NestJS CLI config

## Architecture

- **Driver adapter pattern**: Prisma 7 uses `PrismaPg` adapter with a `pg.Pool` instead of the built-in query engine. See `src/prisma/prisma.service.ts`.
- **Dual Postgres connections**: Prisma for ORM queries + raw `pg.Pool` for LISTEN/NOTIFY pub/sub (see `src/chat/pubsub.service.ts`).
- **GraphQL code-first**: schema auto-generated from NestJS decorators (`autoSchemaFile`). No manual `.gql` files.
- **Subscriptions**: GraphQL-WS protocol on `/graphql` path. WebSocket context extracts auth from `connectionParams`.
- **REST only for OAuth**: `auth.controller.ts` handles Google/Facebook/Microsoft callback redirects (Passport REST routes), returns tokens via URL params to frontend.

## Module Pattern

Each domain module (`auth`, `users`, `groups`, `friends`, `chat`, `books`, `feed`, `notifications`) follows:

- `*.module.ts` — declares imports, providers, controllers
- `*.resolver.ts` — GraphQL queries/mutations, guarded with `@UseGuards(JwtAuthGuard)`
- `*.service.ts` — business logic, injects `PrismaService`
- `models/` — GraphQL ObjectType/InputType definitions
- Guards in `guards/`, Passport strategies in `strategies/`

Shared modules: `prisma/` (global PrismaService), `azure/` (Blob Storage + Email), `health/` (health check endpoint), `common/` (decorators like `@CurrentUser`, `@Public`).

## Auth Flow

- Local: email + argon2 password hash → JWT access token + refresh token (rotated, family-tracked)
- OAuth: Passport strategies for Google, Facebook, Microsoft → `findOrCreateOAuthUser` (cross-provider email linking) → JWT tokens
- Frontend receives tokens via URL redirect: `/login?token=<access>&refresh=<refresh>`

## Testing

- Unit: Jest with `@nestjs/testing` `Test.createTestingModule()`. Mock PrismaService.
- Integration: `@testcontainers/postgresql` spins up `postgres:15-alpine`. DB name `transformlit_test`.
- Test files: `*.spec.ts` co-located with source files.

## Key Gotchas

- **`.js` extension required** in all imports (NodeNext module resolution)
- **Prisma client not auto-generated** after fresh clone — run `db:generate` before anything
- **Soft deletes**: all core entities have `deletedAt` — always filter `deletedAt: null` in queries
- **Refresh token reuse detection**: reuse of a consumed refresh token revokes the entire family
- **Pub/sub is NOT Prisma subscriptions** — it's raw pg LISTEN/NOTIFY, separate connection pool