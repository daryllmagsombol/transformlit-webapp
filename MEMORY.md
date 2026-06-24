# Transformlit — Project Memory & Task Tracker

Date: 2026-06-25
Branch: `feature/major-rearchitecture`

## Key Decisions (Locked In)

| Decision | Choice |
|---|---|
| Architecture | Modular monolith (NestJS) on Azure Container Apps. Domain modules with zero cross-deps, ready for extraction into microservices later. |
| API style | Full Apollo GraphQL (queries, mutations, subscriptions via `graphql-ws`). No REST except webhook/file-stream. |
| Real-time | GraphQL subscriptions backed by Postgres LISTEN/NOTIFY (no Redis at MVP). Chat + friend requests + group updates pushed. |
| Auth | Google OAuth (day 1) + local email/password. JWT access (15min) + rotating refresh (7d, Postgres-backed). Microsoft + Facebook phase 2. |
| Frontend state | Apollo Client (server cache + subscriptions). Zustand for UI state (theme, sidebar). TanStack Query dropped. |
| Roles | Global: Admin / Moderator / Member. Group-scoped: Owner / Member. |
| Tenancy | Single-instance (one community). No `tenant_id` columns. |
| Email | Azure Communication Services Email with custom domain. Terraform-managed domain verification. |
| DB | PostgreSQL (Azure Flexible Server Burstable B1ms, always-on). Prisma 7. |
| PDF streaming | NestJS server-proxied from Blob Storage (no signed URLs). Read progress + scroll pos + bookmarks + highlights. |
| Paid books | "Coming Soon" badge only — no payments in MVP. |
| Dark mode | Extend existing `DESIGN_SYSTEM.md` tokens with dark variants. Tailwind v4 `dark:` utilities. |
| Infra | Terraform with Azure Storage backend. Modules per service. Dev + Prod environments. |
| CI/CD | GitHub Actions: `infra.yml` (plan/apply), `deploy-api.yml`, `deploy-web.yml`. Images to GHCR. |
| APIM | Skipped for MVP. |
| Redis | Not needed — Postgres LD/NOTIFY covers pub/sub. |
| Domains | Prod: `app.transformlit.com` (web), `/api/*` (NestJS). Dev: `dev.transformlit.com`. Cloudflare DNS + Full SSL. |
| Cost target | ~$25-30/mo (covered by Azure nonprofit sponsorship → $0 out-of-pocket). |

## Pre-Work Checklist

- [x] GitHub Actions OIDC enabled on repo
- [x] Cloudflare DNS write access confirmed
- [x] Switched to pnpm (faster, better workspace support)
- [x] Dependencies audited — 7 vulns patched, all latest compatible versions
- [ ] Google OAuth application registered (client ID + secret)
- [ ] Our Manna Verse of the Day API key obtained
- [x] Azure nonprofit sponsorship confirmed (subscription verified)

## Current Stack Versions (2026-06-25)

| Package | Version | Notes |
|---|---|---|
| TypeScript | 6.0.3 | Latest! |
| Zod | 4.4.3 | Latest! |
| GraphQL | 16.14.2 | 17 blocked (ecosystem not ready) |
| NestJS | 11.x | Modules: Auth, Users, Groups, Friends, Chat, Books, Feed, Notifications |
| Next.js | 16.2.9 | Turbopack build |
| Tailwind | 4.3.1 | CSS variable tokens, dark mode |
| Prisma | 7.8.0 | 14 models, PostgreSQL |
| pnpm | 10.4.1 | Workspaces manager |

## Implementation Phases

| # | Phase | Status | Est. Days |
|---|---|---|---|
| 0 | **Cleanup** — remove old `apps/api`, `apps/web`, `packages/shared`. Preserve `DESIGN_SYSTEM.md`. Rewrite docs. | ✅ Done | 0.5 |
| 1 | **Monorepo + Shared** — turbo config, `packages/shared` (Zod schemas, enums), `packages/graphql` (codegen) | ✅ Done | 1 |
| 2 | **Backend Foundation** — NestJS init, Prisma schema, Apollo GraphQL, Auth (OAuth + local + JWT + refresh), ACS Email | ✅ Done | 3-4 |
| 3 | **Backend Features** — Users, Groups, Friends, Chat (subs + LD/NOTIFY), Books (PDF stream + progress), Feed, Notifications | ✅ Done | 4-5 |
| 4 | **Frontend Foundation** — Next.js 16, Tailwind v4 + dark tokens, Apollo Client, auth flow, layout shell, primitives | ✅ Done | 2 |
| 5 | **Frontend Features** — Auth pages, Feed, Groups, Friends, Chat (live), Books browser + reader | ⬜ Pending | 5-7 |
| 6 | **Terraform IaC** — all modules, dev + prod, OIDC auth | ⬜ Pending | 2-3 |
| 7 | **CI/CD + Deploy** — workflows, GHCR build/push, provision dev, smoke test | ⬜ Pending | 1-2 |
| 8 | **Prod Cutover** — provision prod, DNS switch, final testing | ⬜ Pending | 1 |

**Total: ~3.5–4.5 weeks** (solo dev, full-time)

## Future: Microservice Extraction (Phase 9+)

Conditions that trigger splitting a domain into its own Container App:
- Chat: >100 concurrent WebSocket connections → split to `apps/api-chat/` + Redis pub/sub
- Books: PDF streaming bandwidth dominates API container memory → split to `apps/api-books/`
- Groups/Friends: high traffic independent of auth → split both together

Extraction steps per domain:
1. Create new workspace `apps/api-{domain}/`
2. Move domain module + controller/resolvers from monolith
3. Copy shared `PrismaModule`, `AuthModule` imports (they are zero-coupling)
4. Add Dockerfile, package.json, nest-cli.json
5. Add Container App to Terraform `module.container-app`
6. Update GitHub Actions deploy matrix

## Open Questions (Not Blocking)

- Notification delivery: in-app only, or email push as well? (defer — in-app only for MVP)
- Group chat: default all-members conversation or opt-in channels? (defer — one per group for MVP)
- Admin dashboard: separate SPA or integrated into main web app? (defer — integrated for MVP)
- Bible API refresh frequency: daily at midnight UTC or on-demand with 24h cache? (daily at midnight)
- Book catalog: admin-upload only, or import metadata from Google Books/Open Library APIs? (admin upload for MVP)
