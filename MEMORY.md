# Transformlit — Project Memory & Task Tracker

Date: 2026-06-25 (updated after audit fixes)
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
| Redis | Not needed — Postgres LISTEN/NOTIFY covers pub/sub. |
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
| 3 | **Backend Features** — Users, Groups, Friends, Chat (subs + LISTEN/NOTIFY), Books (PDF stream + progress), Feed, Notifications | ✅ Done | 4-5 |
| 4 | **Frontend Foundation** — Next.js 16, Tailwind v4 + dark tokens, Apollo Client, auth flow, layout shell, primitives | ✅ Done | 2 |
| 5 | **Frontend Features** — Landing + auth pages done, auth pages (Feed placeholder with dynamic Apollo). Full feature pages pending. | 🟡 Foundation Ready | 2 |
| 6 | **Terraform IaC** — 8 modules, dev + prod environments, providers pinned, secrets wired | ✅ Done | 2-3 |
| 7 | **CI/CD + Deploy** — 3 workflows (infra plan/apply, deploy-api, deploy-web), GHCR + Container Apps | ✅ Done | 1-2 |
| 8 | **Audit & Fixes** — 25+ bugs fixed across backend (InputTypes, Auth, PubSub, Prisma, Guards, OAuth, Subscriptions), Docker (--filter, packages/shared), Terraform (providers, KV name, secrets, ACS), CI/CD (matrix, TF_VAR wiring) | ✅ Done | 1 |
| 9 | **Prod Cutover** — provision prod, DNS switch, final testing | ⬜ Pending | 1 |

**Total: ~3.5–4.5 weeks** (solo dev, full-time)

## Audit & Fixes (2026-06-25)

Full-stack audit found 25+ issues across backend, frontend, Docker, Terraform, and CI/CD. All fixed:

### Backend Critical Blockers (11 fixes)
| # | Issue | Fix |
|---|---|---|
| 1 | No `@InputType()` classes — schema gen would fail | Created 13 @InputType classes across all 6 domains |
| 2 | `AuthPayload.user` non-null but never returned | `generateTokens()` now fetches and returns user |
| 3 | Duplicate `me` query (auth + users resolvers) | Removed from auth resolver |
| 4 | `NOTIFY $1, $2` — invalid SQL | Changed to `SELECT pg_notify($1, $2)` |
| 5 | LISTEN/publish/asyncIterator channel-name mismatch | Standardized on `messageAdded` (camelCase) |
| 6 | `autoSchemaFile` path wrong for Docker | Uses `join(__dirname, 'schema.gql')` |
| 7 | Google OAuth unreachable — no REST controller | Added `AuthController` with `/auth/google` + callback |
| 8 | Subscription pushed all messages to all clients | Added `filter` by `conversationId` |
| 9 | WebSocket auth broken (connectionParams vs header) | Context extracts auth from `connectionParams` |
| 10 | `CommonModule` no-op | Removed, decorators kept as standalone |
| 11 | Unused `JWT_REFRESH_SECRET` in .env.example | Removed |

### Prisma Schema (3 fixes)
| # | Fix |
|---|---|
| 12 | `onDelete: Cascade` on Message.sender, AuditLog.user |
| 13 | `onDelete: SetNull` on createdBy/publishedBy relations |
| 14 | Removed broken `RefreshToken.replacedById` self-relation |

### Docker + Packages (4 fixes)
| # | Fix |
|---|---|
| 15 | `--filter` flag moved to `pnpm --filter=@transformlit/api run db:generate` |
| 16 | `packages/shared/dist` copied to final Docker image |
| 17 | `packages/shared/package.json` main/types → `./dist/index.js` |
| 18 | `.gitignore` ignores `terraform.tfvars` but tracks `.tfvars.example` |

### Terraform (8 fixes)
| # | Fix |
|---|---|
| 19 | `providers.tf` copied into `infra/dev/` + `infra/prod/` (root dead code removed) |
| 20 | Key Vault name → `kvtransformlitdev` (alphanumeric, no hyphens) |
| 21 | `tenant_id` → `data.azurerm_client_config.current.tenant_id` |
| 22 | Container App secrets → top-level `secret {}` + env `secret_name` reference |
| 23 | Sensitive env vars (DB, JWT, storage key) moved to `secret_env_vars` |
| 24 | ACS Email domain → `AzureManagedDomain` (no DNS verification needed) |
| 25 | `ghcr_owner` variable added to env configs |
| 26 | Removed dead `infra/providers.tf`, `infra/variables.tf`, `infra/outputs.tf` |

### CI/CD (2 fixes)
| # | Fix |
|---|---|
| 27 | `infra.yml` — matrix replaced with explicit `apply` + `apply-prod` jobs, `TF_VAR_*` secrets wired |
| 28 | `infra.yml` — `terraform apply -auto-approve` (no `tfplan` from separate plan job) |

### Frontend Notes
| Item | Status |
|---|---|
| Apollo SSR | Pages use `force-dynamic` — public pages SSR, auth pages CSR (production standard) |
| Full feature pages (groups, friends, books, chat) | Stubs present — Apollo queries ready, deferred for post-deploy iteration |
| `RolesGuard` + `@Roles()` | Declared but not wired to admin mutations yet (security hardening phase) |

### Build Verification (post-fix)
| Check | Result |
|---|---|
| API `tsc --noEmit` | 0 errors |
| API `nest build` (SWC) | 49 files, 98ms |
| Next.js `next build` | Passes with `force-dynamic` |
| Prisma `prisma generate` | 14 models generated |

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
