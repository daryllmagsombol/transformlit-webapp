# Transformlit MVP

A multi-tenant community platform built for reading groups, book clubs, and literary organizations. Warm, paper-toned design with group management, chat, announcements, and document sharing.

**Production:** https://transformlit.darjosh.dev

---

## Documentation Map

| File | Contents |
|---|---|
| `ARCHITECTURE.md` | System design, scope, data model, API plan, frontend stack, deployment strategy |
| `DB_DESIGN.md` | Full PostgreSQL schema: tables, enums, indexes, constraints, soft delete conventions |
| `DESIGN_SYSTEM.md` | Brand direction, color tokens, typography scale, spacing, components, Tailwind config |
| `Deployment.md` | VM runbook, Docker Compose, nginx, Cloudflare, CI/CD trigger |
| `SETUP_NESTJS_NEXTJS_TURBOREPO.md` | How the monorepo was scaffolded from scratch |

---

## Stack

| Layer | Technology |
|---|---|
| **Monorepo** | Turborepo + npm workspaces |
| **API** | NestJS (TypeScript) |
| **Frontend** | Next.js 15 (App Router) |
| **Shared** | `packages/shared` — DTOs, types, validation |
| **Database** | PostgreSQL 16 via Prisma ORM |
| **Auth** | Email/password, argon2 hashing, JWT (7d expiry) |
| **Deployment** | Docker Compose on Azure VM, nginx reverse proxy, Cloudflare SSL |
| **State (client)** | Tanstack Query (server state), Redux Toolkit (UI state) |

---

## Project Structure

```
new-transformlit-webapp/
├── apps/
│   ├── api/                    # NestJS backend (:3005)
│   │   ├── src/
│   │   │   ├── auth/           # Register, login, JWT guard
│   │   │   ├── announcements/  # Tenant-wide CRUD + publish/unpublish
│   │   │   ├── friends/        # Requests, accept/reject, search
│   │   │   ├── groups/         # Create, join, roles, search
│   │   │   ├── documents/      # Upload, stream, access control
│   │   │   ├── prisma/         # Schema, migrations, seed
│   │   │   ├── app.module.ts   # Root module
│   │   │   └── main.ts         # Bootstrap, CORS, validation
│   │   └── Dockerfile
│   ├── web/                    # Next.js frontend (:3000)
│   │   ├── src/
│   │   │   ├── app/            # App Router pages
│   │   │   ├── components/     # UI primitives + feature components
│   │   │   ├── lib/            # API client, helpers
│   │   │   └── store/          # Redux slices
│   │   └── Dockerfile
├── packages/
│   └── shared/                 # Shared DTOs, types, validation
├── deploy/                     # (on VM) Docker Compose + nginx config
├── images/                     # Brand assets
├── turbo.json                  # Turborepo pipeline
├── package.json                # Workspace root
└── *.md                        # Documentation (see map above)
```

---

## Features (MVP Scope)

- **Multi-tenant**: Every tenant gets isolated data via `tenant_id` on all rows. Registration creates a tenant + admin user in one step.
- **Groups**: Public/private groups, join requests, member roles (owner, admin, member).
- **Friends**: Request/accept/reject/block friendships.
- **Chat**: Direct and group conversations via short polling (5–10s). Schema compatible with future WebSocket upgrade.
- **Announcements**: Tenant-wide feed with draft/publish/archive workflow. Scheduled publishing and expiry.
- **Documents**: PDF upload, access control per user or group, authorized streaming.

### Out of Scope (v1)

- Realtime chat, typing indicators, read receipts
- Mobile apps
- Recommendation engine
- Payments or subscriptions
- Advanced search and discovery

---

## Database

Multi-tenant PostgreSQL with UUID primary keys, soft deletes, and audit fields.

**Enums:** `user_status`, `user_role`, `group_visibility`, `group_member_role`, `friendship_status`, `conversation_type`, `announcement_status`, `document_access_type`

**Core tables:** `tenants`, `users`, `profiles`, `friendships`, `groups`, `group_members`, `conversations`, `conversation_members`, `messages`, `documents`, `document_access`, `announcements`

See `DB_DESIGN.md` for full schema with indexes and constraints.

---

## API Endpoints

### Auth
| Method | Path | Auth | Body |
|---|---|---|---|
| POST | `/auth/register` | No | `{ tenantName, email, password, displayName? }` |
| POST | `/auth/login` | No | `{ tenantSlug, email, password }` |
| GET | `/auth/me` | JWT | — |

### Announcements
| Method | Path | Auth |
|---|---|---|
| GET | `/announcements` | JWT |
| GET | `/announcements/:id` | JWT |
| POST | `/announcements` | JWT |
| PATCH | `/announcements/:id` | JWT |
| POST | `/announcements/:id/publish` | JWT |
| POST | `/announcements/:id/unpublish` | JWT |
| DELETE | `/announcements/:id` | JWT |

### Groups
| Method | Path | Auth |
|---|---|---|
| GET | `/groups` | JWT |
| GET | `/groups/:id` | JWT |
| GET | `/groups/search` | JWT |
| POST | `/groups` | JWT |
| PUT | `/groups/:id` | JWT |
| DELETE | `/groups/:id` | JWT |
| POST | `/groups/:id/members` | JWT |
| DELETE | `/groups/:id/members/:memberId` | JWT |

### Friends
| Method | Path | Auth |
|---|---|---|
| GET | `/friends` | JWT |
| GET | `/friends/search` | JWT |
| POST | `/friends/request` | JWT |
| POST | `/friends/:id/accept` | JWT |
| POST | `/friends/:id/reject` | JWT |
| DELETE | `/friends/:id` | JWT |

### Documents
| Method | Path | Auth |
|---|---|---|
| GET | `/documents` | JWT |
| GET | `/documents/:id` | JWT |
| POST | `/documents` | JWT |
| PUT | `/documents/:id` | JWT |
| DELETE | `/documents/:id` | JWT |
| POST | `/documents/:id/access` | JWT |
| DELETE | `/documents/:id/access/:accessId` | JWT |

---

## Development

### Prerequisites

- Node.js 20+
- npm 10+
- PostgreSQL 15+

### Setup

```bash
# Install dependencies
npm install

# Create environment files
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env

# Generate Prisma client, run migrations, seed
npm run db:generate -w apps/api
npm run db:migrate -w apps/api
npm run db:seed -w apps/api

# Start both API and web dev servers
npm run dev
```

API runs on `http://localhost:3005`, web on `http://localhost:3000`.

### Useful Commands

```bash
# Targeted workspace scripts
npm run dev -w apps/api          # API dev server with watch
npm run dev -w apps/web          # Web dev server
npm run build -w apps/api        # Build API
npm run build -w apps/web        # Build web

# Database
npm run db:generate -w apps/api  # Generate Prisma client
npm run db:migrate -w apps/api   # Run migrations
npm run db:seed -w apps/api      # Seed data

# Root scripts (runs all workspaces)
npm run dev                      # Full stack via Turborepo
npm run build                    # Build all workspaces
npm run lint                     # Lint all workspaces
npm run test                     # Test all workspaces
```

### Environment Variables (API)

| Variable | Default | Required |
|---|---|---|
| `DATABASE_URL` | — | Yes |
| `JWT_SECRET` | — | Yes |
| `PORT` | `3005` | No |
| `CORS_ORIGIN` | `http://localhost:3000` | No |

---

## Design System

Warm, literary aesthetic anchored on orange-and-ink branding.

- **Colors:** Brand orange (`#F4A11C`), ink black (`#111111`), warm paper (`#FFF6E8`), teal accent (`#1F7A6D`)
- **Typography:** Space Grotesk (UI), Newsreader (reading), JetBrains Mono (code)
- **Spacing:** 4px scale through 64px
- **Radius:** sm 8px, md 12px, lg 16px, xl 20px

See `DESIGN_SYSTEM.md` for full token set, Tailwind config, component specs, and motion guidelines.

---

## Deployment

The app runs on an Azure VM (Standard_B2s, Ubuntu) via Docker Compose alongside the blink-social-media stack.

**Infrastructure:**
- Docker Compose: `postgres`, `transformlit-api`, `transformlit-web`, `nginx`
- nginx reverse proxy with Cloudflare Full (strict) SSL
- Shared PostgreSQL instance across stacks
- Variable-based proxy_pass with Docker DNS resolver

**Production URL:** https://transformlit.darjosh.dev
**API base:** `https://transformlit.darjosh.dev/api`

See `Deployment.md` for the VM runbook, Dockerfile details, and CI/CD trigger setup.

---

## Auth & Security

- Email/password authentication with argon2 password hashing
- JWT-based API access (7-day expiry, no refresh tokens)
- Custom `JwtAuthGuard` — `CanActivate` guard with `JwtService.verifyAsync`
- Tenant-scoped data isolation via `tenant_id` on all queries
- Soft deletes: `deleted_at` + `deleted_by` on all major tables

**Seed credentials (dev):**
- Tenant: `transformlit`
- Admin: `admin@transformlit.local` / `Transformlit123!`

---

## Architecture Decisions

| Decision | Rationale |
|---|---|
| **No global API prefix** | Routes at `/auth/register` (not `/api/auth/register`); nginx strips `/api` in `proxy_pass` via rewrite |
| **Custom JWT guard** | Simple `CanActivate` with `JwtService.verifyAsync` instead of Passport; fewer abstractions for MVP |
| **Short-polling chat** | Avoid WebSocket infrastructure for MVP; compatible schema for future upgrade |
| **Shared Prisma in root** | Avoids workspace-hoisting conflicts with Prisma version; use `npx prisma@<exact-version>` in production |
| **npm workspaces** | Simpler than pnpm for MVP; adequate workspace isolation |

---

## Related

- [ARCHITECTURE.md](./ARCHITECTURE.md) — Full system design and scope
- [DB_DESIGN.md](./DB_DESIGN.md) — Database schema and conventions
- [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md) — Visual design tokens and components
- [Deployment.md](./Deployment.md) — Infrastructure and deployment steps
- [SETUP_NESTJS_NEXTJS_TURBOREPO.md](./SETUP_NESTJS_NEXTJS_TURBOREPO.md) — Monorepo scaffold guide
