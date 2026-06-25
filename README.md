# 📖 Transformlit

A community-driven platform for reading groups, book sharing, chat, and literary engagement. Warm, paper-toned design with dark mode. Mobile-first web app with a future React Native companion.

**Production:** `app.transformlit.com` (API at `/api` path)
**Dev:** `dev.transformlit.com`

---

## 📚 Documentation Map

| File | Contents |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | 🏛️ System design, modular monolith, GraphQL API, subscriptions, auth flow, PDF streaming |
| [`docs/DB_DESIGN.md`](docs/DB_DESIGN.md) | 🗄️ Full PostgreSQL schema: tables, enums, indexes, constraints, conventions |
| [`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md) | 🎨 Brand direction, color tokens (light + dark), typography, spacing, components |
| [`docs/MEMORY.md`](docs/MEMORY.md) | 🧠 Task tracker, decisions log, open questions, future microservice extraction plan |
| [`docs/Deployment.md`](docs/Deployment.md) | 🚀 Azure Container Apps, Terraform IaC, GitHub Actions CI/CD, Cloudflare DNS, GHCR |

---

## 🏗️ Stack

| Layer | Technology |
|---|---|
| **Monorepo** | Turborepo + pnpm workspaces |
| **API** | NestJS 11 (TypeScript) + Apollo GraphQL |
| **Frontend** | Next.js 16 (App Router) + React 19 |
| **Database** | PostgreSQL via Prisma 7 ORM |
| **Auth** | Google OAuth + email/password, JWT (15min access) + rotating refresh tokens (7d) |
| **Client state** | Apollo Client (server cache + subscriptions), Zustand (UI state) |
| **Styling** | Tailwind CSS v4, CSS variables, dark/light mode |
| **Forms** | React Hook Form + Zod, shared schemas |
| **Tables** | TanStack Table |
| **Azure cloud** | Container Apps, PostgreSQL Flexible Server, Blob Storage, Key Vault, ACS Email |
| **IaC** | Terraform (Azure Storage backend) |
| **CI/CD** | GitHub Actions (infra + deploy), GHCR (container registry) |
| **DNS/SSL** | Cloudflare Full (strict) |

---

## 📁 Project Structure

```
new-transformlit-webapp/
├── apps/
│   ├── api/                     # NestJS backend (Apollo GraphQL)
│   │   ├── src/
│   │   │   ├── auth/            # OAuth, JWT, refresh rotation
│   │   │   ├── users/
│   │   │   ├── groups/
│   │   │   ├── friends/
│   │   │   ├── chat/            # Subscriptions via Postgres LISTEN/NOTIFY
│   │   │   ├── books/           # PDF streaming + read progress
│   │   │   ├── feed/            # Announcements + verse-of-day
│   │   │   ├── notifications/
│   │   │   ├── prisma/          # PrismaService (@Global)
│   │   │   ├── azure/           # BlobService, EmailService
│   │   │   ├── common/          # Guards, decorators, pipes, filters
│   │   │   ├── app.module.ts
│   │   │   └── main.ts
│   │   ├── prisma/schema.prisma
│   │   ├── test/
│   │   ├── Dockerfile
│   │   └── package.json
│   └── web/                     # Next.js frontend
│       ├── src/
│       │   ├── app/             # App Router pages + layouts
│       │   ├── components/      # UI primitives + feature components
│       │   ├── lib/             # Apollo Client, auth helpers
│       │   ├── store/           # Zustand stores
│       │   └── styles/          # Tailwind globals + tokens
│       ├── Dockerfile
│       ├── next.config.ts
│       └── package.json
├── packages/
│   ├── shared/                  # Zod schemas, enums, constants, DTOs
│   └── graphql/                 # Codegen types + .graphql operations
├── infra/                       # Terraform IaC
│   ├── modules/
│   │   ├── resource-group/
│   │   ├── postgresql/
│   │   ├── blob-storage/
│   │   ├── container-apps-env/
│   │   ├── container-app/
│   │   ├── key-vault/
│   │   ├── communication-services/
│   │   └── monitoring/
│   ├── dev/main.tf
│   ├── prod/main.tf
│   └── backend.tf
├── .github/workflows/
│   ├── infra.yml                # Terraform plan/apply
│   ├── deploy-api.yml           # Build → GHCR → ACA deploy
│   └── deploy-web.yml           # Build → GHCR → ACA deploy
├── docs/                        # 📚 Documentation
│   ├── ARCHITECTURE.md          # 🏛️ System architecture
│   ├── DB_DESIGN.md             # 🗄️ Database schema
│   ├── DESIGN_SYSTEM.md         # 🎨 Visual design system
│   ├── Deployment.md            # 🚀 Deployment guide
│   └── MEMORY.md                # 🧠 Project memory & tracker
└── turbo.json / package.json
```

---

## ⭐ Key Features

- 💬 **Real-time Chat**: GraphQL subscriptions over WebSocket. No polling.
- 🔄 **Web Reactive**: Apollo Client with `graphql-ws`. Zero stale data.
- 📚 **Books**: Protected PDF streaming, read progress (page + scroll), bookmarks, highlights. Paid books show "Coming Soon."
- 🔐 **SSO Auth**: Google OAuth + local email/password with rotating refresh tokens. Microsoft and Facebook phase 2.
- 👥 **Roles**: Admin / Moderator / Member (global). Owner / Member (per group).
- 🌓 **Dark Mode**: Full light/dark theme with Tailwind v4 `dark:` utilities.
- 📰 **Feed**: Announcements with category badges + Bible Verse of the Day (Our Manna API via `beta.ourmanna.com`, key-less, cached daily, UTC+8).
- 🧱 **Modular Monolith**: NestJS domain modules with zero cross-deps — extract to microservices later with zero rewrites.

## 🧠 Architecture Decisions

| Decision | Rationale |
|---|---|
| **Modular monolith** | Domain modules with zero cross-deps. Single deploy for MVP. Extract to microservices when needed — no rewrites. |
| **Full GraphQL (Apollo)** | One API paradigm. Queries, mutations, subscriptions. Optimal for mobile/React Native future. |
| **Postgres LISTEN/NOTIFY** | Pub/sub for GraphQL subscriptions. Zero extra infra (no Redis at MVP). Works natively on Burstable tier. |
| **No APIM** | Frontend calls Container Apps directly (Cloudflare → ACA ingress). Revisit if external API consumers added. |
| **Container Apps over App Service** | Scale-to-zero for web. Per-second billing. Native WebSocket support + sticky sessions. |
| **Path-based routing** | `app.transformlit.com/api/*` → NestJS container. Same origin → no CORS, simpler WebSocket. |
| **GHCR over ACR** | Free with GitHub. Auth built into Actions. No separate registry cost. |
| **Azure Storage TF backend** | Simplest. No HCP Terraform dependency. Free at <1 GB state storage. |

---

## 🛠️ Development

### 📋 Prerequisites

- Node.js 22+
- pnpm 10+
- PostgreSQL 16+
- Azure CLI (for infra)

### ⚡ Quick Start

```bash
pnpm install

# Environment
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env

# Database
pnpm exec prisma generate --schema=apps/api/prisma/schema.prisma
pnpm exec prisma migrate dev --schema=apps/api/prisma/schema.prisma
pnpm exec prisma db seed --schema=apps/api/prisma/schema.prisma

# Dev servers (API + Web via Turbo)
pnpm dev
```

🔌 API (GraphQL playground): `http://localhost:3005/graphql`
🌐 Web: `http://localhost:3000`

### 💻 Workspace Commands

```bash
pnpm --filter @transformlit/api dev
pnpm --filter @transformlit/web dev
pnpm --filter @transformlit/api build
pnpm --filter @transformlit/web build
pnpm lint
pnpm test

# Prisma
pnpm exec prisma migrate dev --schema=apps/api/prisma/schema.prisma
pnpm exec prisma db seed --schema=apps/api/prisma/schema.prisma
pnpm exec prisma studio --schema=apps/api/prisma/schema.prisma
```

### 🔑 Environment Variables

**API (`apps/api/.env`)**

| Variable | Description | Required |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string (local dev) | Yes |
| `JWT_SECRET` | HS256 signing key for JWT | Yes |
| `JWT_REFRESH_SECRET` | HS256 signing key for refresh tokens | Yes |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID | For SSO |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | For SSO |
| `AZURE_STORAGE_CONNECTION_STRING` | Blob Storage for PDF uploads/streaming | Yes (prod) |
| `ACS_CONNECTION_STRING` | Azure Communication Services email | Yes (prod) |
| `PORT` | API port (default 3005) | No |

**Web (`apps/web/.env`)**

| Variable | Description | Required |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | GraphQL endpoint | Yes |
| `NEXT_PUBLIC_WS_URL` | WebSocket endpoint (graphql-ws) | Yes |

---

## 🚀 Deployment

See [`docs/Deployment.md`](docs/Deployment.md) for full details. Summary:

1. 📤 Push code → GitHub Actions builds Docker image → pushes to GHCR
2. 🏗️ `infra.yml` manages Azure infra via Terraform (plan on PR, apply on merge)
3. 🔄 Container Apps pull updated images and swap active revision
4. 🔒 Cloudflare fronts `app.transformlit.com` with Full (strict) SSL → ACA ingress

**💰 Cost**: ~$25-30/mo per environment, covered by Azure nonprofit sponsorship.
