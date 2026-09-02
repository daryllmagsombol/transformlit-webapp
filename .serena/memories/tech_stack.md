# Tech Stack

## Core

- **Runtime**: Node.js v24.20.0
- **Package manager**: pnpm 11.24.0 (workspace protocol, `pnpm-workspace.yaml`)
- **Monorepo**: Turborepo 2.10.2 (`turbo.json` task definitions)
- **Language**: TypeScript 6.0.3 (root `tsconfig.base.json`: ES2022 target, strict mode, ESNext modules)

## Backend (`apps/api`)

- **Framework**: NestJS 11 (Express 5 under the hood)
- **GraphQL**: Apollo Server 5 via `@nestjs/apollo` + `@nestjs/graphql` (code-first, autoSchemaFile)
- **ORM**: Prisma 7.9.1 with driver adapter pattern (`@prisma/adapter-pg` + `pg` 8.23)
- **Database**: PostgreSQL (local `postgres:postgres@localhost:5432/transformlit`)
- **Auth**: Passport (JWT, Google, Facebook, Microsoft) + `@nestjs/jwt` + argon2 for password hashing
- **Realtime**: GraphQL-WS subscriptions + Postgres LISTEN/NOTIFY via `pg.Pool` (separate from Prisma)
- **Storage**: Azure Blob Storage (`@azure/storage-blob`)
- **Email**: Azure Communication Services (`@azure/communication-email`)
- **Module resolution**: `NodeNext` (imports must include `.js` extension)
- **Testing**: Jest 30 + Testcontainers (`@testcontainers/postgresql`)

## Frontend (`apps/web`)

- **Framework**: Next.js 16.3.1 (App Router, `src/app/`)
- **React**: 19.2.8
- **Styling**: Tailwind CSS v4 (PostCSS plugin via `@tailwindcss/postcss`)
- **State**: Zustand 5.0.15
- **Forms**: React Hook Form 7.85 + Zod 4.4 validation
- **GraphQL client**: Apollo Client 4.2.12 + `graphql-ws` for subscriptions
- **Animations**: Motion 13.1.1 (Framer Motion successor)
- **Module resolution**: `ESNext` / `bundler`
- **Testing**: Jest 30 + React Testing Library + Playwright (e2e)

## Packages

- `packages/shared` — cross-app utilities
- `packages/graphql` — shared GraphQL codegen types and operations

## Notable Version Constraints (`pnpm-workspace.yaml` overrides)

- lodash >=4.18.0, ws >=8.21.0, multer >=2.2.0
- fast-uri 3.1.5, protobufjs 7.6.5 (pinned)
- argon2, prisma, @swc/core require build permissions (`allowBuilds`)