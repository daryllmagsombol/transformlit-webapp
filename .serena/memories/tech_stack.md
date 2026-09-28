# Tech Stack

## Core

- **Runtime**: Node.js v24.20.0 (`engines: >=22.13`)
- **Package manager**: pnpm 11.24.0 (`packageManager` pinned with hash; workspace protocol)
- **Monorepo**: Turborepo 2.10.2 (`turbo.json`)
- **Language**: TypeScript 6.0.3 (`tsconfig.base.json`: ES2022, strict, ESNext, `isolatedModules`)

## Backend (`apps/api`)

- **Framework**: NestJS 11 (`@nestjs/core` ^11.2.1), Express 5
- **GraphQL**: Apollo Server 5 (`@apollo/server` ^5.5.1) via `@nestjs/apollo` + `@nestjs/graphql` (code-first, `autoSchemaFile`)
- **ORM**: Prisma 7.9.1 with driver adapter (`@prisma/adapter-pg` + `pg`)
- **Database**: PostgreSQL (local `postgres:postgres@localhost:5432/transformlit`)
- **Auth**: Passport (JWT, Google, Facebook, Microsoft) + `@nestjs/jwt` + argon2
- **Realtime**: GraphQL-WS + Postgres LISTEN/NOTIFY (`pg.Pool`, separate from Prisma)
- **Storage**: Azure Blob (`@azure/storage-blob`); **Email**: Azure Communication Services
- **Module resolution**: `NodeNext` — imports MUST include `.js`
- **Testing**: Jest 30 + Testcontainers (`postgres:15-alpine`)
- **Build**: `nest-cli.json` uses the **swc** builder

## Frontend (`apps/web`)

- **Framework**: Next.js ^16.3.1 (App Router, `src/app/`), React ^19.2.8
- **Styling**: Tailwind CSS v4 (`@tailwindcss/postcss`) — CSS-first, no `tailwind.config.js`
- **State**: Zustand 5 (`persist` middleware)
- **Forms**: React Hook Form 7 + Zod 4
- **GraphQL client**: Apollo Client 4 (`@apollo/client` ^4.2.12) + `graphql-ws`
- **Animations**: Motion 13 (`motion/react`)
- **Module resolution**: `ESNext` / `bundler` — no `.js` extension
- **Testing**: Jest 30 + React Testing Library + Playwright

## Packages

- `packages/shared` — enums, schemas, types. **Must be built** (`dist/` gitignored): `mem:build/startup`
- `packages/graphql` — GraphQL codegen config; `__generated__/` is gitignored

## Notable `pnpm-workspace.yaml` config

- `packages` excludes tests: `"!**/test/**"`
- `allowBuilds` (postinstall scripts permitted): `@apollo/protobufjs`, `@prisma/engines`,
  `@swc/core`, `argon2`, `cpu-features`, `esbuild`, `prisma`, `protobufjs`, `ssh2`, `unrs-resolver`
- `overrides`: `lodash >=4.18.0`, `ws >=8.21.0`, `multer >=2.2.0`, `@hono/node-server >=1.19.13`,
  `js-yaml >=5.3.0`, `postcss >=8.5.26`, `fast-xml-parser 5.11.0`, `deepmerge-ts 8.0.1`,
  `brace-expansion@1/2/5` pinned, plus pinned `fast-uri 3.1.5` and `protobufjs 7.6.5`

## Related

- Startup/build traps: `mem:build/startup`
- Commands (some broken): `mem:suggested_commands`
