# Transformlit Architecture

Date: 2026-06-25
Branch: `feature/major-rearchitecture`

## Overview

Transformlit is a single-instance community platform for reading groups, book sharing, chat, and literary engagement. The backend is a **modular NestJS monolith** with domain boundaries designed for future microservice extraction. The frontend is a **mobile-first Next.js App Router** app. The API is **Apollo GraphQL-first** with subscriptions for real-time features.

```
┌──────────────────────────────────────────────────────┐
│                  Cloudflare (DNS + Full SSL)          │
└────────────────────┬─────────────────────────────────┘
                     │
      app.transformlit.com  /  dev.transformlit.com
                     │
┌────────────────────▼─────────────────────────────────┐
│         Azure Container Apps Environment             │
│                                                      │
│  ┌──────────────────────┐  ┌──────────────────────┐  │
│  │  container-app: api  │  │ container-app: web   │  │
│  │  NestJS + Apollo      │  │ Next.js 16           │  │
│  │  /api/*               │  │ /*                   │  │
│  │  min_replicas: 1      │  │ min_replicas: 0      │  │
│  └──────┬───────────────┘  └──────────────────────┘  │
│         │                                             │
└─────────┼─────────────────────────────────────────────┘
          │
    ┌─────┴─────┬──────────────┬──────────────┐
    │           │              │              │
┌───▼────┐ ┌───▼────┐  ┌─────▼──────┐ ┌────▼─────┐
│Postgres │ │ Blob   │  │  Key Vault │ │ ACS Email│
│B1ms     │ │Storage │  │            │ │          │
└─────────┘ └────────┘  └────────────┘ └──────────┘
```

## Backend Architecture

### Modular Monolith Structure

The NestJS app is organized into **domain modules** with a strict dependency rule: **modules do not import each other**. All cross-cutting concerns (auth, Prisma, email, blob) live in shared infrastructure modules that domains consume.

```
apps/api/src/
├── main.ts                     # Bootstrap, Apollo plugin, CORS
├── app.module.ts               # Root module — imports all domains
├── auth/                       # OAuth providers, JWT, refresh tokens
│   ├── auth.module.ts
│   ├── auth.service.ts
│   ├── auth.resolver.ts        # login, register, refreshToken, connectOAuth
│   └── guards/                 # GqlAuthGuard, RolesGuard
├── users/
│   ├── users.module.ts
│   ├── users.service.ts
│   └── users.resolver.ts
├── groups/
├── friends/
├── chat/                       # Subscriptions + PubSub via Postgres LISTEN/NOTIFY
├── books/                      # PDF streaming + read progress
├── feed/                       # Announcements + verse-of-day
├── notifications/
├── prisma/                     # PrismaService (@Global)
├── azure/                      # BlobService, EmailService
└── common/                     # Decorators, filters, pipes, scalars
```

**Dependency rule**: Auth, Chat → imports Prisma, Auth. Chat never imports Books, etc. This guarantees extraction without refactoring.

### GraphQL API

- **Server**: Apollo Server via `@nestjs/graphql` (code-first with decorators)
- **Schema**: Single unified schema — all resolvers register in root `GraphQLModule.forRootAsync`
- **Subscriptions**: Backed by a custom `PubSubService` wrapping Postgres `LISTEN`/`NOTIFY`. Each subscription channel maps to a Postgres channel name.
- **Auth**: `GqlAuthGuard` extracts JWT from `Authorization` header or `connectParams` (for WebSocket upgrade). `@CurrentUser()` decorator provides the resolved user context.
- **WebSocket transport**: `graphql-ws` protocol on `wss://{domain}/api/graphql`. Container Apps ingress forwards WebSocket connections with sticky sessions.

**Operations** (conceptual — full schema in code):
- Queries: `me`, `users`, `friends`, `groups`, `group(id)`, `conversations`, `messages(conversationId, cursor)`, `books`, `book(id)`, `readProgress(bookId)`, `announcements`, `feed`, `notifications`
- Mutations: `registerLocal`, `loginLocal`, `refreshToken`, `logout`, `connectOAuth(provider)`, `updateProfile`, `friendRequest`, `acceptFriend`, `removeFriend`, `createGroup`, `joinGroup`, `leaveGroup`, `sendMessage`, `markRead`, `uploadBook` (admin), `updateBook`, `saveProgress`, `addBookmark`, `addHighlight`, `publishAnnouncement`, `markNotificationRead`
- Subscriptions: `messageAdded(conversationId)`, `friendRequestReceived`, `friendRequestUpdated`, `groupUpdated(groupId)`

### Auth Flow

1. **Local register**: email + password → argon2 hash → ACS email verification → JWT access (15 min) + rotating refresh (7 days)
2. **Google OAuth**: redirect → consent → callback → exchange code → find-or-create user → JWT + refresh
3. **Refresh rotation**: each refresh issuance invalidates the prior refresh. Reuse detection revokes the entire token family.
4. **JWT payload**: `{ sub: userId, role: userRole }`. No session server-side; stateless verification.
5. **Future (phase 2)**: add Microsoft + Facebook OAuth providers.

### PDF Streaming

1. Admin uploads PDF → NestJS → private Blob Storage container (`pdfs`)
2. Reader opens a book → GraphQL query returns metadata + auth token
3. Browser requests `GET /api/books/:id/stream` → NestJS verifies JWT + access rules → streams bytes from Blob with:
   - `Content-Type: application/pdf`
   - `Cache-Control: no-store`
   - `X-Content-Type-Options: nosniff`
4. No `Content-Disposition: attachment` — browser renders inline, not download.

### PubSub via Postgres LISTEN/NOTIFY

```typescript
// apps/api/src/chat/pubsub.service.ts
@Injectable()
export class PubSubService implements OnModuleInit, OnModuleDestroy {
  private pool: Pool;

  publish(channel: string, payload: object): void {
    await this.pool.query('NOTIFY $1, $2', [channel, JSON.stringify(payload)]);
  }

  asyncIterator<T>(channel: string): AsyncIterator<T> {
    // Uses pg-listen or raw pg pooling — maps NOTIFY payload to AsyncIterator
  }
}
```

Zero extra infrastructure. Postgres handles the pub/sub; Prisma handles persistence. A single `pg` raw connection per replica listens for notifications.

Triggered in services:
```typescript
// chat.service.ts
async sendMessage(...) {
  const msg = await this.prisma.message.create(...);
  await this.pubSub.publish(`message:${conversationId}`, newMessageAdded);
  return msg;
}
```

## Frontend Architecture

- **Framework**: Next.js 16 (App Router), React 19
- **Rendering**: Static generation for landing/marketing. Client components for authenticated shell (sidebar + top bar + page content). Server Components where they reduce bundle (metadata, SEO).
- **Data fetching**: Apollo Client (`@apollo/client` + `@apollo/experimental-nextjs-app-support` for SSR/RSC). `InMemoryCache` with type policies.
- **State**: Zustand for UI-only state (theme, sidebar collapsed, active modal). Apollo Client handles all server cache.
- **Styling**: Tailwind v4 with CSS variables from `DESIGN_SYSTEM.md`. Dark mode via `next-themes` + `dark:` variants.
- **Forms**: React Hook Form + Zod resolver. Shared schemas from `packages/shared`.
- **Tables**: TanStack Table for data grids (groups list, book catalog, member lists).
- **Mobile-first**: All layouts designed mobile-first. Sidebar becomes bottom sheet / swipeable drawer on small viewports.

### Auth on the Client

- Apollo Link chain: `authLink` (attaches JWT from storage) → `errorLink` (catches 401, attempts refresh, retries) → `wsLink` (split for subscriptions) → `httpLink`
- JWT stored in `httpOnly` cookie (preferred) or localStorage fallback. Refresh token in `httpOnly` only.
- WebSocket connection sends JWT in `connectionParams` during upgrade handshake.

## Cloud Infrastructure

| Service | Purpose | Terraform Module |
|---|---|---|
| Azure Container Apps Environment | Runtime for api + web containers | `container-apps-env` |
| Container App: api | NestJS + Apollo (min_replicas=1, sticky sessions) | `container-app` |
| Container App: web | Next.js (min_replicas=0, scale-to-zero idle) | `container-app` |
| PostgreSQL Flexible Server | Burstable B1ms, always-on | `postgresql` |
| Blob Storage | Private containers: pdfs, uploads, covers, avatars | `blob-storage` |
| Key Vault | Secrets: OAuth clients, JWT secret, DB password | `key-vault` |
| ACS Email | Transactional email via custom domain | `communication-services` |
| App Insights + Log Analytics | Observability | `monitoring` |
| GHCR | Container images (free with GitHub) | — (GH Actions) |

## Environment Strategy

| Env | Purpose | Auto-deploy trigger |
|---|---|---|
| `dev` | Develop & test | merge PR to `main` |
| `prod` | Production | tag `v*` on `main` |

Both share the same Terraform module set. `terraform.tfvars` per environment controls SKU, scale rules, secrets.

## Observability

- **Logs**: NestJS structured logging (request ID, user ID, operation). Shipped to Log Analytics.
- **Metrics**: Apollo Server plugin collects query latency, error rates. Custom metrics for PDF stream throughput.
- **Traces**: Request → resolver → Prisma query → database round trip. App Insights distributed tracing.
- **Alerts**: 5xx error rate > 1%, DB connection failure, container crash loop.

## Security

- All traffic over HTTPS (Cloudflare Full SSL → Container Apps TLS)
- CORS: `app.transformlit.com` allowed origin; all others rejected
- Rate limiting: ThrottlerModule on auth and subscription endpoints
- JWT validation: stateless, no server-side session store
- Blob access: never public; all reads via authenticated NestJS proxy
- Secrets: never in code; loaded from Key Vault references in Container Apps env vars
- DB: private endpoint + firewall rules; no public access

## Future: Microservice Extraction (Phase 9+)

When a domain's load or team ownership justifies isolation:

1. Create `apps/api-{domain}/` workspace
2. Copy domain module + its resolver/service from `apps/api/src/`
3. Create minimal `AppModule` importing only: `PrismaModule`, `AuthModule`, `{Domain}Module`
4. Deploy as separate Container App in the same ACA environment
5. Ingress path: `/api/chat/*` → chat container; `/api/books/*` → books container
6. Extend Apollo Client with `splitLink` to route operations by domain

No rewrites. No schema changes. Module boundaries designed for this from day one.
