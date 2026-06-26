# 🧠 Transformlit — Project Memory & Task Tracker

Date: 2026-06-25 (updated after feed page implementation + DRY refactor)
Branch: `feature/major-rearchitecture`

## 🔒 Key Decisions (Locked In)

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

## ✅ Pre-Work Checklist

- [x] GitHub Actions OIDC enabled on repo
- [x] Cloudflare DNS write access confirmed
- [x] Switched to pnpm (faster, better workspace support)
- [x] Dependencies audited — 7 vulns patched, all latest compatible versions
- [ ] Google OAuth application registered (client ID + secret)
- [x] Our Manna Verse of the Day API key obtained → **No longer needed — `beta.ourmanna.com` is key-less**
- [x] Azure nonprofit sponsorship confirmed (subscription verified)

## 📦 Current Stack Versions

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

## 🚧 Implementation Phases

| # | Phase | Status | Est. Days |
|---|---|---|---|
| 0 | **Cleanup** — remove old `apps/api`, `apps/web`, `packages/shared`. Preserve `DESIGN_SYSTEM.md`. Rewrite docs. | ✅ Done | 0.5 |
| 1 | **Monorepo + Shared** — turbo config, `packages/shared` (Zod schemas, enums), `packages/graphql` (codegen) | ✅ Done | 1 |
| 2 | **Backend Foundation** — NestJS init, Prisma schema, Apollo GraphQL, Auth (OAuth + local + JWT + refresh), ACS Email | ✅ Done | 3-4 |
| 3 | **Backend Features** — Users, Groups, Friends, Chat (subs + LISTEN/NOTIFY), Books (PDF stream + progress), Feed, Notifications | ✅ Done | 4-5 |
| 4 | **Frontend Foundation** — Next.js 16, Tailwind v4 + dark tokens, Apollo Client, auth flow, layout shell, primitives | ✅ Done | 2 |
| 5 | **Frontend Features** — Landing + auth pages done, **Feed page fully implemented** (MD3 color tokens, Our Manna verse-of-day, announcements with categories, groups sidebar, mobile bottom nav, FAB). Full feature pages (friends, groups, books) pending. | ✅ Feed Done | 2 |
| 6 | **Terraform IaC** — 8 modules, dev + prod environments, providers pinned, secrets wired | ✅ Done | 2-3 |
| 7 | **CI/CD + Deploy** — 3 workflows (infra plan/apply, deploy-api, deploy-web), GHCR + Container Apps | ✅ Done | 1-2 |
| 8 | **Audit & Fixes** — 25+ bugs fixed across backend (InputTypes, Auth, PubSub, Prisma, Guards, OAuth, Subscriptions), Docker (--filter, packages/shared), Terraform (providers, KV name, secrets, ACS), CI/CD (matrix, TF_VAR wiring) | ✅ Done | 1 |
| 9 | **Prod Cutover** — provision prod, DNS switch, final testing | ⬜ Pending | 1 |

**Total: ~3.5–4.5 weeks** (solo dev, full-time)

## 🔧 Audit & Fixes

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
| Full feature pages (groups, friends, books, chat) | Partially done — Feed ✅, Groups ✅, Books ✅. Friends + Chat still stubs |
| `RolesGuard` + `@Roles()` | Declared but not wired to admin mutations yet (security hardening phase) |

### Auth Hardening (2026-06-26)

Implemented automatic JWT refresh and Zustand hydration guards to fix the logout-after-refresh bug.

| Change | File(s) | Notes |
|---|---|---|
| **Apollo error link** | `apps/web/src/lib/apollo-client.ts` | Intercepts `UNAUTHENTICATED` / 401 errors, calls `refreshToken` mutation, retries the failed request once, and redirects to `/login` on failure. Deduplicates concurrent refresh attempts. |
| **Proactive refresh** | `apps/web/src/lib/apollo-client.ts` | Refreshes the access token ~2 minutes before the 15-minute expiry on the next GraphQL operation. |
| **Hydration guard** | `apps/web/src/store/auth.ts`, `feed/books/groups-client.tsx` | Added `isHydrated` state so protected pages no longer redirect to `/login` before Zustand rehydrates the persisted token. |
| **Token helpers** | `apps/web/src/lib/auth.ts` | Centralized access/refresh token localStorage access + JWT decode + expiry checks. |
| **JWT secret** | `apps/api/src/auth/auth.module.ts`, `jwt.strategy.ts` | Removed `dev-secret` fallback; `JWT_SECRET` is now required (`getOrThrow`). |
| **OAuth URL cleanup** | `apps/web/src/app/login/login-form.tsx` | OAuth callback now uses `router.replace('/feed')` so tokens are not retained in the `/login` browser history entry. |

**Remaining security risks & recommended follow-up:**
1. **Tokens still live in `localStorage`** — XSS can steal them. Long-term, move the refresh token to an `httpOnly`, `Secure`, `SameSite=Lax` cookie and keep only the short-lived access token in memory.
2. **OAuth tokens still pass through the redirect URL** — server logs, referrer headers, and analytics may capture them. Replace the query-param redirect with either (a) `httpOnly` cookies set by the backend callback, or (b) a short-lived one-time code exchanged by the frontend.
3. **No server-side logout** — `clearAuth()` only clears client storage. Add a `logout` mutation that revokes the current refresh token family in Postgres.
4. **No rate limiting / lockout** — Add rate limiting to `loginLocal`, `registerLocal`, and `refreshToken` to mitigate brute-force and token reuse.
5. **CSRF** — Not currently relevant because auth is bearer-token-in-header, but required if cookies are adopted.

### Build Verification (post-fix)
| Check | Result |
|---|---|
| API `tsc --noEmit` | 0 errors |
| API `nest build` (SWC) | 49 files, 98ms |
| Web `tsc --noEmit` | 0 errors |
| Next.js `next build` | Passes |

### Feed Page Implementation (2026-06-25)

Full `/feed` page built matching the Material Design 3 spec:

| Area | Details |
|---|---|
| **Design tokens** | 60+ MD3 color tokens (primary, secondary, tertiary, surface containers, outline, inverse) + typography scale (micro→display) + Manrope font |
| **TopNavBar** | Brand, desktop nav tabs (Feed/Library/Community), search pill, notifications, avatar |
| **SideNavBar** | Nav items with active indicator, "Your Progress" widget (yearly goal bar, quote, CTA), Settings/Help links |
| **Verse of the Day** | Bento hero card with gradient glow. Reads from `verse_of_day` cache table, fetches `beta.ourmanna.com` on miss (**key-less API**). |
| **Announcements** | Cards with `AnnouncementCategory` badges (EVENT=teal, UPDATE=blue, GENERAL=neutral). Sourced from DB. |
| **Groups Update** | Sidebar widget listing groups with member counts, activity text, discover CTA |
| **Quick Track** | Dashed-border card with quick-chapter pills |
| **Mobile** | BottomNavBar (Feed/Friends/Groups/Books) + FAB (edit action) |
| **Dark mode** | `@custom-variant dark` wired to next-themes `.dark` class |
| **New DB migration** | `AnnouncementCategory` enum (EVENT/UPDATE/GENERAL) + `category` field on `Announcement` |
| **Seed data** | 5 groups, 3 categorized announcements, verse of the day, 2 users, 7 memberships |

### Code Quality & DRY Refactor (2026-06-26)

Extracted duplicated patterns into shared components, utilities, and constants. Unified the entire app (layout shell, auth pages, error pages) to use MD3 color tokens.

| Change | Files Affected | Lines Removed |
|---|---|---|
| **`components/ui/icons.tsx`** — 10 shared SVG icon components (`MailIcon`, `LockIcon`, `EyeIcon`, `EyeOffIcon`, `PersonIcon`, `GoogleIcon`, `FacebookIcon`, `MicrosoftIcon`, `SpinnerIcon`, `AutoStoriesIcon`) | login-form.tsx, register-form.tsx | ~180 |
| **`lib/constants.ts`** — added `API_BASE` (derived from `NEXT_PUBLIC_API_URL`) | login-form.tsx, register-form.tsx | 4 |
| **`sidebar.tsx`** — replaced inline `<Link>` loop with `<NavItem>` + `SIDEBAR_NAV_ITEMS` import; updated all tokens to MD3 (`surface-container-low`, `outline-variant`, `primary`, `on-surface-variant`) | sidebar.tsx | ~30 |
| **`topbar.tsx`** — replaced local nav array + old tokens with `SIDEBAR_NAV_ITEMS` import + MD3 tokens | topbar.tsx | ~20 |
| **`app-shell.tsx`** — updated container to MD3 tokens (`bg-surface`, `border-outline-variant`) | app-shell.tsx | 2 |
| **`loading.tsx`** — swapped `brand`/`ink-soft` → `primary`/`on-surface-variant` | loading.tsx | 2 |
| **`error.tsx`** — replaced old `card` class + `ink` tokens with MD3 card (`surface-container-low`, `outline-variant`, `rounded-xl`) | error.tsx | 10 |
| **`not-found.tsx`** — same MD3 treatment as error.tsx | not-found.tsx | 10 |
| **`page.tsx`** (home) — replaced `btn-primary`/`btn-secondary` classes with inline MD3-styled buttons | page.tsx | 8 |

**Result**: All 3 packages build clean. Every route now renders with the unified MD3 design system — no more old `brand`/`ink`/`border` tokens in any page component.

### Groups Page UI + Functionality (2026-06-26)

Built a full Groups page (`/groups`) replicating the HTML mockup with MD3 design tokens and real backend data.

#### Schema Changes
- Added `GroupCategory` enum (`BIBLICAL_STUDIES`, `MODERN_FICTION`, `HISTORICAL`, `PHILOSOPHY`, `YOUNG_ADULT`)
- Added fields to `Group` model: `category` (nullable), `coverImageUrl` (nullable), `featured` (boolean, default false)

#### Backend (NestJS / GraphQL)
| Change | Details |
|---|---|
| **Group entity** | Registered `GroupCategory` enum, exposed new fields in GraphQL object |
| **Field resolver** | `memberCount` computed via `countActiveMembers()` — counts ACTIVE GroupMember records |
| **New query `myGroups`** | Returns groups the current user is an ACTIVE member of |
| **New query `discoverGroups(category?)`** | Returns public groups the user has NOT joined, filterable by category, sorted by featured first |
| **Join mutation** | `joinGroup(groupId)` — upserts GroupMember, sets ACTIVE if public, PENDING if private |
| **Service refactor** | Extracted `groupInclude()` and `mapGroup()` helpers for DRY query building |

#### Seed Data
- 7 groups with categories, cover images, and featured flags matching the HTML design
- 10 fake users created for realistic membership counts (7–8 members per group)
- Admin is OWNER of all groups, test user (Sarah) is MEMBER of 2 groups

#### Frontend
| Component | Location | Purpose |
|---|---|---|
| `GroupCard` | `components/ui/group-card.tsx` | Bento-grid card: cover image, name, member count, description, "Open Circle" |
| `CategoryChip` | `components/ui/category-chip.tsx` | Filter chip: icon + label, active/inactive states |
| `FeaturedGroupCard` | `components/ui/featured-group-card.tsx` | Large "Editor's Choice" card with image overlay badge |
| `CompactGroupCard` | `components/ui/compact-group-card.tsx` | Side discovery card with colored icon, name, subtitle |
| `groups-client.tsx` | `app/groups/groups-client.tsx` | Full page: hero, active groups grid, discover section with category filters |
| `[slug]/page.tsx` | `app/groups/[slug]/page.tsx` | Group detail stub |

#### CSS Utilities Added
- `.no-scrollbar` — hide scrollbar in category chip row
- `.bento-grid` — auto-fill grid with 300px min columns

### Books Page UI (2026-06-26)

Built the full Books Library page (`/books`) matching the provided HTML mockup with MD3 tokens, real GraphQL data, and responsive layout.

#### Frontend
| Component | Location | Purpose |
|---|---|---|
| `BookCard` | `components/ui/book-card.tsx` | Grid card: 2/3 cover, Community/Premium badge, genre label, title, author, price/FREE, Read/Buy action |
| `BookCardSkeleton` | `components/ui/book-card.tsx` | Loading placeholder for the browse grid |
| `ReadingProgressCard` | `components/ui/reading-progress-card.tsx` | Horizontal-scroll "Currently Reading" card with cover, %, page progress bar, Continue CTA |
| `books-client.tsx` | `app/books/books-client.tsx` | Full page: hero reading list, browse filters/sort, bento grid, empty state, mobile bottom nav + FAB |

#### Data Flow
- `BOOKS_QUERY` calls the `books` GraphQL query returning all `Book` fields (`id`, `title`, `author`, `coverUrl`, `price`, `currency`, `accessLevel`, `status`, `totalPages`, `createdAt`, etc.).
- Browse grid filters by `accessLevel` (All / Community = FREE / Premium = RESTRICTED) and sorts by newest, title A-Z, or price.
- "Currently Reading" uses two hardcoded mock cards from the HTML mockup (`The Architect of Thought`, `Quiet Echoes`) for MVP; real `readProgress` integration can replace this later.

#### Interactions
- **Free books**: "Read" outline button (opens reader toast: "Reader opening soon.").
- **Premium/paid books**: "Buy" filled button shows toast "Paid books coming soon." per MEMORY.md decision that paid books are Coming Soon only in MVP.
- **FAB** (+ icon): triggers the same reader toast for quick progress tracking.
- **Load more**: no pagination yet; shows "No more books to load." info toast.

#### Responsive Layout
- Uses `AuthenticatedLayout` → `AppShell` for topbar + sidebar consistency (matches Groups page).
- Mobile adds a fixed bottom nav and FAB inside the page, matching the HTML mockup.
- Browse grid: `grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5` with `gap-4 md:gap-6`.

### Books Seed Data (2026-06-26)

Added seed data for the MOVE Discipleship Program book series to `apps/api/prisma/seed.ts`:

| Book | Subtitle | Access | Status | Pages |
|---|---|---|---|---|
| Book 1: Usbong | Salvation | FREE | PUBLISHED | 120 |
| Book 2: Usad | Spiritual Disciplines | FREE | PUBLISHED | 140 |
| Book 3: Unlad | Servant-Leadership | FREE | PUBLISHED | 160 |
| Book 4: Ugnay | Systematic Theology | FREE | PUBLISHED | 280 |

**Field mapping to current schema:**
- `name` → `Book.title`
- `description` + `content` + `subtitle` → `Book.description`
- `author_id` ignored; `createdById` set to seeded admin user
- `order` ignored (current schema has no order field; books seed in sequence)
- `logo_name` / `cover_name` → not stored; placeholder Unsplash `coverUrl` used for seed UI
- `accessLevel: FREE`, `status: PUBLISHED`

Run seed with: `pnpm exec prisma db seed` (from `apps/api/`).

## 🔮 Future: Microservice Extraction

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

## ❓ Open Questions

- Notification delivery: in-app only, or email push as well? (defer — in-app only for MVP)
- Group chat: default all-members conversation or opt-in channels? (defer — one per group for MVP)
- Admin dashboard: separate SPA or integrated into main web app? (defer — integrated for MVP)
- Bible API refresh frequency: daily at midnight UTC or on-demand with 24h cache? (**Resolved: cache-first, fetch from `beta.ourmanna.com` on cache miss, no API key needed**)
- Book catalog: admin-upload only, or import metadata from Google Books/Open Library APIs? (admin upload for MVP)
