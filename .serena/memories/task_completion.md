# Task Completion

## Verification Checklist

Before considering any coding task complete, run these in order:

### 1. Type Check

```bash
pnpm build          # turbo builds all apps; catches TS errors
```

If only one app changed, scope it:

```bash
pnpm --filter @transformlit/api build    # API only
pnpm --filter @transformlit/web build    # Web only
```

### 2. Lint

```bash
pnpm lint
```

### 3. Unit Tests

```bash
pnpm test
```

Scope to affected app if only one changed.

### 4. Integration Tests (if DB schema or API logic changed)

```bash
# Ensure source .env is loaded for DATABASE_URL
set -a; source apps/api/.env; set +a
pnpm test:integration
```

### 5. E2E Tests (if web UI flows changed)

```bash
pnpm test:e2e
```

### 6. Formatting

```bash
pnpm format
```

### 7. GraphQL Codegen (if GraphQL types or queries changed)

```bash
pnpm graphql:codegen
```

### 8. Prisma (if schema changed)

```bash
# Regenerate client
set -a; source apps/api/.env; set +a
pnpm --filter @transformlit/api db:generate

# If new migration needed (dev):
pnpm --filter @transformlit/api db:migrate

# Verify migration status
pnpm --filter @transformlit/api db:migrate:deploy  # dry-run-safe; shows pending count
```

## Failure Modes

- **Prisma generate must run before tests** if schema changed — tests import `@prisma/client` which needs the generated code.
- **Seeding requires `db:generate` first** — `tsx prisma/seed.ts` imports the generated client.
- **Integration tests create their own DB** via Testcontainers — no need to seed or migrate the test DB.
- **Web e2e tests require API to be running** — Playwright hits the live server.