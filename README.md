# Transformlit MVP

This repository contains the Transformlit MVP monorepo.

## Apps

- apps/web: Next.js web app
- apps/api: NestJS API
- packages/shared: shared DTOs and types

## Development

- Install dependencies: npm install
- Create environment files:
  - apps/api/.env from apps/api/.env.example
  - apps/web/.env from apps/web/.env.example
- Initialize the database (PostgreSQL required):
  - npm run db:migrate -w apps/api
  - npm run db:seed -w apps/api
- Run dev servers: npm run dev

## Notes

- See ARCHITECTURE.md, DB_DESIGN.md, and DESIGN_SYSTEM.md for design references.
