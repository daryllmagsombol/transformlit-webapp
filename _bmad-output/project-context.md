---
project_name: 'Transformlit Web App'
user_name: 'daryll'
date: '2026-06-09'
sections_completed: ['technology_stack', 'language_specific_rules', 'framework_specific_rules', 'testing_rules', 'code_quality_rules', 'development_workflow_rules', 'critical_rules']
status: 'complete'
rule_count: 32
optimized_for_llm: true
existing_patterns_found: 3
---

# Project Context for AI Agents

_This file contains critical rules and patterns that AI agents must follow when implementing code in this project. Focus on unobvious details that agents might otherwise miss._

---

## Technology Stack & Versions

### Core Stack

| Technology | Version | Notes |
|---|---|---|
| Monorepo | Turborepo ^2.1.0 | npm 11.6.2 workspaces |
| Backend | NestJS ^11.0.1 | Modular architecture |
| Frontend | Next.js 16.2.6 | App Router — **BREAKING CHANGES exist** |
| React | 19.2.4 | Latest stable |
| Prisma ORM | ^5.22.0 | **v5 dropped `findOne` alias; relation API changed** |
| Prisma Client | ^7.8.0 | Verify `previewFeatures` alignment in schema.prisma |
| PostgreSQL | — | Via Prisma (Docker on dev, Azure PG in prod) |
| TypeScript (API) | ^5.7.3 | `nodenext` module resolution, `noImplicitAny: false` |
| TypeScript (Web) | ^5 | Standard resolution |

### Framework Versions & Breaking Changes

- **Next.js 16 is NOT the Next.js you know** — read `apps/web/AGENTS.md` first, then consult `node_modules/next/dist/docs/` before writing any route handler, middleware, or data-fetching pattern. Known pitfalls: `generateStaticParams` API changed, `pages/` routing removed, App Router patterns differ from v15.
- **Jest ^30.0.0** — very fresh. Turborepo cache conflicts with `jest --watch` (use `--no-cache`). Root ts-jest ESM config may trip on `nodenext` module resolution.
- **prisma ^5.22.0** — v5 API changes: no `findOne`, relation queries use different syntax.

### TypeScript Configuration

- **API (`apps/api/tsconfig.json`)**: `module: nodenext`, `moduleResolution: nodenext`, `emitDecoratorMetadata: true`, `experimentalDecorators: true`, `strictNullChecks: true`, **`noImplicitAny: false`** (agents must add explicit `unknown` or lint rules — `tsc` won't catch untyped params)
- **Web (`apps/web/tsconfig.json`)**: standard Next.js TS config

### State Management Convention

- **Server state → TanStack Query ^5.100.14** (API calls, caching, mutations)
- **Client/UI state → Redux Toolkit ^2.12.0** (filters, local preferences, layout state, auth state)
- **Forms → react-hook-form ^7.56.4 + yup ^1.4.0** validation (submit mutations via TanStack Query `useMutation`, not Redux)

### Package & Build

- `apps/api/`: NestJS CLI build, Prisma migrations/seed
- `apps/web/`: Next.js build, Tailwind CSS v4
- `packages/shared/`: Shared types/DTOs (`@transformlit/shared`)
- Inter-package imports: TS module resolution differs between API (`nodenext`) and web — cross-boundary imports may fail without explicit `paths` config

### Design System Tokens

- **Brand palette**: Orange (#F4A11C), Ink (#111111), Paper (#FFF6E8), Teal accent (#1F7A6D)
- **Typography**: Space Grotesk (UI sans), Newsreader (content serif), JetBrains Mono (code)
- **Spacing**: 4px base scale (4, 8, 12, 16, 20, 24, 32, 40, 48, 64)
- **Shadows**: Soft (0 2px 12px rgba(17,17,17,0.08)), Lift (0 10px 30px rgba(17,17,17,0.12))
- **Motion**: Fade 220ms + 12px up, stagger 120ms at 40ms intervals
- Agents must NOT default to generic blue links, white backgrounds, or Inter/system fonts — the brand identity is warm, literary, modern

### Language-Specific Rules

#### TypeScript Configuration Traps
- **`noImplicitAny: false` in API** — TypeScript won't flag untyped function params. Enforce `@typescript-eslint/no-explicit-any: error` at the lint level or use explicit `unknown` for ambiguous types.
- **Decorators require `emitDecoratorMetadata: true`** and `experimentalDecorators: true` in `tsconfig.json`. Do not remove — NestJS DI depends on this.
- **NestJS uses `nodenext` module resolution** — local relative imports MUST include the `.js` extension (e.g., `import { X } from './x.js'`), NOT `./x` or `./x.ts`.

#### DTO & Validation Patterns
- **DTOs must be `class`, not `interface`/`type`** — `class-validator` and `class-transformer` decorators require runtime reflection on class instances. Type-only constructs are invisible at runtime.
- Use `@IsEmail()`, `@IsString()`, `@MinLength()` from `class-validator` for API input validation.
- NestJS global `ValidationPipe({ whitelist: true, transform: true })` strips unknown fields and transforms payloads.

#### Import Conventions
- **API**: `@nestjs/*` for framework, `@prisma/client` for generated DB types (import enums like `UserRole`, `UserStatus` by name), `class-validator`/`class-transformer` for DTOs, `import type` for type-only imports.
- **Shared package**: `import type { X } from '@transformlit/shared'` for cross-app DTOs.
- **Web**: standard TS imports, Tanstack Query from `@tanstack/react-query`, Redux from `@reduxjs/toolkit` and `react-redux`.

#### Error Handling
- Reusable components exist for UI error states: `ErrorState.tsx`, `EmptyState.tsx`, `LoadingState.tsx`.
- NestJS `enableShutdownHooks()` for graceful container shutdown.
- Use NestJS exception filters for structured API error responses; avoid raw `throw Error`.

### Framework-Specific Rules

#### Next.js 16 (Web App)
- **⚠️ ALWAYS read `apps/web/AGENTS.md` and `node_modules/next/dist/docs/`** before implementing any route handler, middleware, layout, or data-fetching pattern. Next.js 16 has breaking changes from v15. Agents generating v15-compatible code will produce silent 404s or runtime errors.
- **App Router only** — `pages/` directory and `getServerSideProps`/`getStaticProps` are not used. Use `page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx` conventions.
- **Server components by default** — only add `'use client'` when you need browser APIs, event handlers, or hooks that depend on interactivity.
- **Route groups** — authenticated pages live under `(authed)/` route group.
- **Fonts** loaded via `next/font/google` in root layout (`Space_Grotesk` for UI, `Newsreader` for content) — do not add additional font loads.
- **CSS**: Tailwind CSS v4 via PostCSS (`postcss.config.mjs`). Use design tokens from `globals.css` CSS custom properties, not hardcoded hex values.

#### NestJS 11 (API)
- **Modular architecture** — each feature is a self-contained module (controller, service, module file, DTOs, guards if needed).
- **Auth pattern**: `JwtAuthGuard` (extends `CanActivate`) checks `Authorization: Bearer <token>` via `JwtService` + `ConfigService`. `@CurrentUser()` param decorator extracts `AuthUser` from the validated JWT payload.
- **Validation**: global `ValidationPipe({ whitelist: true, transform: true })` in `main.ts`. DTOs use `class-validator` decorators.
- **Config**: `ConfigModule.forRoot({ isGlobal: true })` reads from `.env` or environment.
- **Prisma**: always use the shared `PrismaService` (injected via `PrismaModule`) — never instantiate `PrismaClient` directly.
- **CORS**: configured in `main.ts` from `CORS_ORIGIN` or `FRONTEND_ORIGIN` env var, defaults to `http://localhost:3000`.

#### React 19
- **Server components preferred** — client components only when interactivity is required.
- **Forms**: use `react-hook-form` with `yup` schema validation. Submit mutations via TanStack Query's `useMutation`, not Redux.
- **State convention**: server data → TanStack Query; UI state → Redux Toolkit; form state → react-hook-form.
- **Reusable UI**: use existing components in `apps/web/src/components/` — `Modal`, `FormFields`, `StatusBadge`, `LoadingState`, `EmptyState`, `ErrorState` before creating new ones.

#### Prisma ORM
- **v5 API**: `findOne` is removed — use `findUnique` or `findFirst`. Relation queries use updated v5 syntax.
- **Migrations** tracked in version control under `apps/api/prisma/`. Run `prisma migrate dev` for development, seed with `prisma db seed`.
- **PrismaService** is the single DI provider — inject it in NestJS services via constructor.
- All queries should filter `deleted_at: null` for soft-delete tables unless explicitly querying deleted records.

### Testing Rules

#### Test Infrastructure
- **Jest ^30.0.0** with `ts-jest` transform — very fresh major version. Check for breaking changes in Jest 30 before writing custom matchers or reporters.
- **Turborepo cache conflict**: `jest --watch` does not work with Turborepo caching. Use `turbo run test --no-cache` or run jest directly from the package directory with `--no-cache`.
- **`nodenext` module resolution** may cause ESM transform issues with `ts-jest` — configure `tsconfig.test.json` or `transform` in jest config if imports fail.

#### API Tests (Jest + Supertest)
- **Unit tests**: use `@nestjs/testing` `Test.createTestingModule` with mock providers for each module's service/controller. File pattern: `*.spec.ts` alongside source.
- **E2E tests**: use `supertest` against the full NestJS app. Config in `test/jest-e2e.json`. Use a test database or mock Prisma — never hit production.
- **Test structure**: arrange → act → assert. Mock external services (Prisma, JWT) at the provider level.

#### Web Tests
- No test files found yet — this is an early project. When adding tests, use Jest with `@testing-library/react` for component tests.
- Test files should mirror source structure: `src/app/**/__tests__/*.test.tsx` or co-located `*.test.tsx`.

#### Coverage Expectations
- Coverage output to `{package}/coverage/`.
- Focus coverage on service layer and API controllers — UI component tests can be lighter for MVP.
- Prisma queries should be tested via integration tests with a test database, not unit-mocked.

### Code Quality & Style Rules

#### Naming Conventions
- **Components**: PascalCase (`Modal.tsx`, `EmptyState.tsx`, `FormFields.tsx`)
- **Utilities/lib**: kebab-case (`auth-storage.ts`, `format.ts`, `api.ts`)
- **NestJS modules**: `{feature}.controller.ts`, `{feature}.service.ts`, `{feature}.module.ts`, `{feature}.guard.ts`
- **DTOs**: `{entity}.dto.ts` or `{action}-{entity}.dto.ts` (e.g., `register.dto.ts`, `login.dto.ts`)
- **Test files**: `*.spec.ts` (unit), `*.e2e-spec.ts` (E2E) — co-located with source for unit, under `test/` for E2E

#### Linting & Formatting
- **No root Prettier config** — `apps/api/` has `.prettierrc`. Match existing style per package rather than introducing new formatting rules.
- **API ESLint**: uses `typescript-eslint` with `eslint-config-prettier`. Extend with `@typescript-eslint/no-explicit-any: warn` to compensate for `noImplicitAny: false`.
- **Web ESLint**: standard `eslint-config-next` — do not add custom rules without aligning with existing config.

#### CSS (Tailwind CSS v4)
- **Tailwind v4 uses CSS-based configuration**, not `tailwind.config.js`. Use `@import "tailwindcss"` in `globals.css`.
- **Do NOT use v3 syntax** (`@tailwind base`, `@apply`, etc.) — they don't work in v4.
- **Use CSS custom properties** from `globals.css` for brand colors (e.g., `var(--color-brand)`, `var(--color-paper)`) instead of hardcoding hex values.
- **4px spacing base**: use Tailwind spacing scale (`p-1` = 4px, `p-2` = 8px, etc.) — do not add arbitrary margins.

#### Code Organization
- **API**: feature-based modular structure — each feature is self-contained in its own directory under `src/`.
- **Web**: `app/` (pages/routes), `components/` (shared UI), `lib/` (utilities), `store/` (Redux).
- **Shared**: `src/` with barrel export (`index.ts`) for cross-app types and DTOs.
- Components already exist in `components/` — reuse before creating new ones.

### Development Workflow Rules

#### Git & CI/CD
- **Push to `main` triggers auto-deploy** via GitHub Actions SSH to Azure VM. Workflow reads secrets: `AZURE_VM_HOST`, `AZURE_VM_USER`, `AZURE_VM_SSH_KEY`, `DEPLOY_ROOT`.
- **Manual deploy** available via `workflow_dispatch`.
- **No branch naming convention enforced** yet — early project. Aim for descriptive feature branches.

#### Build & Run
- **Dev**: `turbo run dev` starts both API (port 3005) and Web (port 3000) in parallel.
- **Build**: `turbo run build` — API outputs to `apps/api/dist/`, Web outputs to `apps/web/.next/`, Shared to `packages/shared/dist/`.
- **Prisma**: run `db:generate` after schema changes, `db:migrate` for migrations, `db:seed` for seed data.
- **Containers**: `apps/api/Dockerfile` and `apps/web/Dockerfile` exist for production builds.

#### Deployment (Docker Compose on Azure VM)
- **nginx** reverse proxies for both apps on shared VM.
- **Cloudflare** handles DNS (Full/Strict HTTPS).
- **API binds** on `0.0.0.0` (container-friendly).
- **PostgreSQL** is a separate Docker container on the same VM — NOT inside the app container.
- **Environment variables** drive all config: origins, CORS, database URLs, JWT secrets. Never hardcode.

#### Database
- **Migrations** tracked in `apps/api/prisma/migrations/`. Run `prisma migrate dev` to create new migrations.
- **Seed scripts** in `apps/api/prisma/seed.js` — must be idempotent (safe for repeat runs).
- **Soft deletes**: all user-facing tables use `deleted_at` / `deleted_by`. Agents MUST add `deleted_at: null` filters to all queries unless explicitly querying deleted records.

### Critical Don't-Miss Rules

#### Next.js 16 — The #1 Trap
- **⚠️ This is NOT the Next.js you know.** Always read `apps/web/AGENTS.md` first, then `node_modules/next/dist/docs/` before writing any route handler, middleware, layout, or data-fetching code.
- Known breaking changes: App Router API differences from v15, `generateStaticParams` signature changed, `pages/` conventions removed.
- Never assume v15/docs patterns work. Always validate against the installed build.

#### TypeScript Traps
- **`noImplicitAny: false`** in `apps/api/tsconfig.json` — tsc won't flag untyped params. Self-enforce type annotations. Consider adding `@typescript-eslint/no-explicit-any: error` to API eslint config.
- **`nodenext` resolution** requires `.js` extension in local imports (e.g., `./auth.service.js`, not `./auth.service`). This applies to ALL source files under `apps/api/src/`.
- **`emitDecoratorMetadata: true`** is required for NestJS DI. Never remove or disable it.

#### Multi-Tenancy & Data Isolation
- **Every user-generated table includes `tenant_id`.** Every query MUST filter by `tenant_id`. Missing this filter = cross-tenant data leak — a critical security bug.
- Tenant isolation is enforced at the application layer (shared database, not separate databases).

#### Soft Deletes
- All user-facing tables use `deleted_at` (timestamptz) and `deleted_by` (uuid) for soft deletion.
- **Every read query MUST include `WHERE deleted_at IS NULL`** unless explicitly querying deleted records.
- Prisma queries: use `where: { deleted_at: null }` on all model queries.

#### Prisma ORM — v5 API Changes
- `findOne` is removed — use `findUnique` or `findFirst`.
- Relation queries use updated v5 syntax — check Prisma v5 docs if a relation query fails.
- Prisma v5 client + Prisma v7 generator output: verify `previewFeatures` alignment in `schema.prisma` to avoid CI drift.
- Always use the shared `PrismaService` via NestJS DI — never `new PrismaClient()`.

#### Design System Integrity
- **Never use generic colors** (blue links, white backgrounds, system fonts). Brand palette is orange (#F4A11C), paper (#FFF6E8), ink (#111111), accent teal (#1F7A6D).
- **Typography**: Space Grotesk (UI) + Newsreader (content) — no Inter, Roboto, or system fonts.
- **Spacing**: 4px base scale — use Tailwind spacing tokens, not arbitrary values.
- **Tailwind v4 is CSS-configured**, not JS. `@import "tailwindcss"` syntax in `globals.css`, NOT `@tailwind` directives. No `tailwind.config.js` file exists.

#### NestJS DI & Module Structure
- Do NOT remove `experimentalDecorators: true` or `emitDecoratorMetadata: true`.
- Never add `@nestjs/cli` schematics without verifying they match the project style.
- `ConfigModule.forRoot({ isGlobal: true })` — env config is global, do not re-import per module.
- CORS origin is env-driven — do not hardcode `http://localhost:3000` in feature code.

#### Testing
- Jest 30 + Turborepo: `jest --watch` breaks with default cache — run with `--no-cache` flag.
- `nodenext` resolution may break `ts-jest` transforms — test imports may need custom Jest module mapping.
- Always mock Prisma at the provider level in NestJS unit tests — do not hit the database.

#### Performance & Security
- **Auth**: JWT tokens in `Authorization: Bearer` header. Passwords hashed with argon2. Never store plaintext passwords or log JWT payloads.
- **Chat**: short polling (5-10s) for MVP — schema should be websocket-compatible for future upgrade. No realtime in v1.
- **PDFs**: stored in Azure Blob Storage, streamed via authorized API endpoint — never expose direct blob URLs.
- **Rate limiting** needed on auth and chat endpoints for MVP.
- **Audit logs** for group membership and document access changes.

---

## Usage Guidelines

**For AI Agents:**
- Read this file before implementing any code in Transformlit
- Follow ALL rules exactly as documented — especially the Next.js 16 and TS config traps
- When in doubt about a version-specific API, check the actual installed package (not your training data)
- Update this file if new patterns or constraints emerge during implementation

**For Humans:**
- Keep this file lean and focused on agent needs — remove rules that become obvious over time
- Update when technology stack or major patterns change
- Review quarterly for outdated rules or version bumps
- Coordinate with `ARCHITECTURE.md`, `DB_DESIGN.md`, and `DESIGN_SYSTEM.md` for broader context

Last Updated: 2026-06-09
