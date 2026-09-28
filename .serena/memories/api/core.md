# API Core (`apps/api/`)

## Entry & Config

- `src/main.ts` — NestJS bootstrap (Express 5 adapter, CORS, GraphQL subscriptions)
- `src/app.module.ts` — root module (domain modules + ConfigModule + GraphQLModule)
- `nest-cli.json` — `builder: swc`, `typeCheck: true`, `deleteOutDir: true`
- `.env` / `.env.example` — DATABASE_URL, JWT_SECRET, OAuth creds, Azure creds

## Modules (`src/`)

`auth`, `users`, `groups`, `friends`, `chat`, `books`, `feed`, `notifications`, `azure`,
`storage`, `uploads`, `worker`, `health`, `prisma`, `common`.

## Architecture

- **Driver adapter pattern**: Prisma 7 uses `PrismaPg` + `pg.Pool` (not the built-in engine).
  See `src/prisma/prisma.service.ts`.
- **Dual Postgres connections**: Prisma for ORM + raw `pg.Pool` for LISTEN/NOTIFY pub/sub
  (`src/chat/pubsub.service.ts`).
- **GraphQL code-first**: `schema.gql` is auto-generated from decorators (`autoSchemaFile`).
  Never edit `schema.gql` manually; regenerate via `graphql:schema`.
- **Subscriptions**: GraphQL-WS on `/graphql`; auth from `connectionParams`.
- **Background worker**: separate entry `src/worker/main.ts` + `worker.module.ts`
  (`pnpm --filter @transformlit/api worker:dev`).

## Auth Flow

- **REST** (`auth.controller.ts`) — local `POST /auth/login|register|refresh|logout`, plus
  OAuth start/callback routes. Refresh token is set as an **httpOnly cookie**
  (`transformlit_refresh`); access token returns in the JSON body (local login) — it is
  NEVER put in a URL.
- **OAuth callbacks redirect with NO tokens**: `finishOAuthCallback()` sets the refresh
  cookie then redirects to `${FRONTEND_URL}/login` (or `?error=oauth_failed`). The web then
  bootstraps via `POST /auth/refresh`. An older "tokens in URL params" flow is gone —
  do not document or reintroduce it.
- OAuth account linking goes through `findOrCreateOAuthUser` (cross-provider email linking).
- GraphQL: `@UseGuards(JwtAuthGuard)` + `@CurrentUser()`; public routes via `@Public()`.
- Refresh tokens: rotated on use, family reuse-detection, SHA-256 hashed in DB.

## Testing

- Unit: Jest + `Test.createTestingModule()`, PrismaService mocked. `*.spec.ts` co-located in `src/`.
- Integration: `apps/api/test/*.integration.spec.ts` + Testcontainers (`postgres:15-alpine`).
  Helpers/fixtures in `apps/api/test/helpers` + `test/fixtures`.

## Key Gotchas

- **`.js` extension required** on all imports (NodeNext)
- **Prisma client not auto-generated** after a clean checkout — run `db:generate` first
- **Soft deletes**: filter `deletedAt: null` on core entities
- **GraphQL non-null fields**: `@Field()` is non-nullable by default — a `select` that omits one
  breaks the whole query. This caused a real outage; see `mem:conventions` and
  `mem:verification/browser-and-blindspots`
- **Pub/sub is NOT Prisma subscriptions** — raw pg LISTEN/NOTIFY on a separate pool

## Related

- Build/startup traps: `mem:build/startup`
- Conventions incl. GraphQL non-null discipline: `mem:conventions`
- Commands incl. known-broken lint: `mem:suggested_commands`
