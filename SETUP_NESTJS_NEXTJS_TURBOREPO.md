# Setup Guide: NestJS + Next.js with Turborepo

This document explains how this project is set up as a Turborepo monorepo with:

- `apps/api` (NestJS backend)
- `apps/web` (Next.js frontend)
- `packages/shared` (shared types/DTOs)

## 1) Prerequisites

- Node.js 20+
- npm 10+
- PostgreSQL 15+

Check versions:

```bash
node -v
npm -v
psql --version
```

## 2) Monorepo Structure

The root `package.json` uses npm workspaces:

- `apps/*`
- `packages/*`

Root scripts:

- `npm run dev` -> runs all app `dev` scripts via Turbo
- `npm run build` -> runs all app `build` scripts via Turbo
- `npm run lint` -> runs all app `lint` scripts via Turbo
- `npm run test` -> runs all app `test` scripts via Turbo

`turbo.json` config highlights:

- `dev` is `persistent` and `cache: false`
- `build` outputs include `dist/**` and `.next/**`
- `build`, `lint`, and `test` depend on upstream workspace tasks

## 3) App Setup

### API app (`apps/api`)

- Framework: NestJS
- Dev script: `nest start --watch`
- Build script: `nest build`
- DB tooling: Prisma

Useful scripts:

```bash
npm run dev -w apps/api
npm run db:generate -w apps/api
npm run db:migrate -w apps/api
npm run db:seed -w apps/api
```

### Web app (`apps/web`)

- Framework: Next.js (App Router)
- Dev script: `next dev`
- Build script: `next build`

Useful scripts:

```bash
npm run dev -w apps/web
npm run build -w apps/web
```

## 4) Environment Configuration

Create env files:

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
```

Minimum API env values:

```dotenv
DATABASE_URL=postgresql://transformlit:transformlit@localhost:5432/transformlit?schema=public
JWT_SECRET=replace-with-a-long-random-secret
PORT=3005
```

## 5) Database Initialization

Run Prisma setup from repo root:

```bash
npm run db:generate -w apps/api
npm run db:migrate -w apps/api
npm run db:seed -w apps/api
```

If migration fails with Prisma shadow database permission errors (`P3014`), either:

- grant your DB user `CREATEDB`, or
- use a privileged `SHADOW_DATABASE_URL` for migrations.

## 6) Run the Full Stack

From repo root:

```bash
npm install
npm run dev
```

This starts both apps through Turborepo.

## 7) How to Recreate This Setup From Scratch

If you want to rebuild the same style of repo from zero:

1. Create a monorepo with npm workspaces (`apps/*`, `packages/*`).
2. Add Turborepo and create `turbo.json` pipelines for `dev/build/lint/test`.
3. Scaffold NestJS inside `apps/api`.
4. Scaffold Next.js inside `apps/web`.
5. Add shared package(s) in `packages/*` (for DTOs/types).
6. Wire root scripts to `turbo run <task>`.
7. Add API and Web env templates.
8. Add Prisma to API, create schema/migrations/seeds.

## 8) Notes and Good Practices

- Keep dependency versions aligned across root and workspace packages (especially Prisma).
- Use workspace-scoped scripts (`-w apps/api`, `-w apps/web`) for targeted runs.
- Keep shared contracts in `packages/shared` to prevent drift between frontend and backend.
