# Foundation + Shared Package Tests — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Set up the complete test infrastructure across the monorepo and write all shared package tests, so every package can run tests and the shared Zod schemas + enums are validated.

**Architecture:** Jest is the unified test runner across all packages. The shared package (ESM) uses ts-jest ESM mode. The web app gets Jest + jsdom + Testing Library. The API gets a second Jest config for integration tests. Turbo orchestrates all test commands. Shared test data factories and a React render helper establish reusable patterns for later plans.

**Tech Stack:** Jest 29, ts-jest, @testing-library/react, @testing-library/jest-dom, @testing-library/user-event, identity-obj-proxy, jest-environment-jsdom, @playwright/test, testcontainers, @testcontainers/postgresql

## Global Constraints

- Use Jest (not Vitest) for all unit/integration tests — user preference for consistency with API
- Shared package is ESM (`"type": "module"`) — Jest config must handle `.js` import extensions via `moduleNameMapper`
- API uses `module: NodeNext` with decorators — existing Jest config must not be broken
- Web app uses Next.js 16 App Router — CSS/Tailwind must be mocked in tests (identity-obj-proxy)
- All test files use `*.spec.ts` / `*.spec.tsx` naming convention
- Unit tests co-located with source; integration tests in `test/` directory
- Coverage thresholds enforced: shared schemas 95%, shared enums 95%
- pnpm is the package manager (v10.4.1)

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `packages/shared/jest.config.ts` | Jest config for shared package (ESM mode) |
| `packages/shared/src/__tests__/schemas.spec.ts` | Zod schema validation tests (14 schemas) |
| `packages/shared/src/__tests__/enums.spec.ts` | Enum values + constants tests |
| `apps/web/jest.config.ts` | Jest config for web app (jsdom) |
| `apps/web/jest.setup.ts` | Testing Library matchers + global test setup |
| `apps/web/test/helpers/render-with-providers.tsx` | Wraps components in Apollo MockedProvider + ThemeProvider |
| `apps/api/jest.integration.config.ts` | Jest config for API integration tests (real DB) |
| `apps/api/test/helpers/create-mock-user.ts` | Factory for mock User objects matching Prisma schema |
| `apps/api/test/helpers/create-mock-group.ts` | Factory for mock Group objects matching Prisma schema |

### Modified Files

| File | Change |
|------|--------|
| `packages/shared/package.json` | Add test script + devDependencies (jest, ts-jest, @types/jest) |
| `apps/web/package.json` | Add test script + devDependencies (testing-library, jest, jsdom, identity-obj-proxy) |
| `apps/api/package.json` | Add `test:integration` script + devDependencies (testcontainers) |
| `turbo.json` | Add `test:integration`, `test:e2e`, `test:coverage` tasks |
| `package.json` (root) | Add `test:integration`, `test:e2e`, `test:coverage` scripts |

---

### Task 1: Install All Test Dependencies

**Files:**
- Modify: `packages/shared/package.json`
- Modify: `apps/web/package.json`
- Modify: `apps/api/package.json`

- [ ] **Step 1: Add test dependencies to shared package**

Add to `packages/shared/package.json`:

```json
{
  "scripts": {
    "build": "tsc",
    "clean": "rm -rf dist",
    "lint": "tsc --noEmit",
    "test": "NODE_OPTIONS='--experimental-vm-modules' jest"
  },
  "devDependencies": {
    "typescript": "^6.0.0",
    "jest": "^29.7.0",
    "ts-jest": "^29.2.0",
    "@types/jest": "^29.5.0"
  }
}
```

- [ ] **Step 2: Add test dependencies to web app**

Add to `apps/web/package.json`:

```json
{
  "scripts": {
    "dev": "next dev --port 3000",
    "build": "next build",
    "start": "next start --port 3000",
    "lint": "next lint",
    "clean": "rm -rf .next",
    "test": "jest",
    "test:watch": "jest --watch",
    "test:cov": "jest --coverage"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4.0.0",
    "@testing-library/react": "^16.0.0",
    "@testing-library/jest-dom": "^6.0.0",
    "@testing-library/user-event": "^14.0.0",
    "@types/jest": "^29.5.0",
    "@types/node": "^26.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "identity-obj-proxy": "^3.0.0",
    "jest": "^29.7.0",
    "jest-environment-jsdom": "^29.7.0",
    "tailwindcss": "^4.0.0",
    "ts-jest": "^29.2.0",
    "typescript": "^6.0.0"
  }
}
```

- [ ] **Step 3: Add test dependencies to API**

Add `test:integration` script and testcontainers devDependencies to `apps/api/package.json`:

```json
{
  "scripts": {
    "build": "nest build",
    "dev": "nest start --watch",
    "start": "nest start",
    "start:prod": "node dist/main",
    "lint": "eslint \"src/**/*.ts\"",
    "test": "jest",
    "test:watch": "jest --watch",
    "test:cov": "jest --coverage",
    "test:integration": "jest --config jest.integration.config.ts",
    "clean": "rm -rf dist",
    "db:generate": "prisma generate --schema=prisma/schema.prisma",
    "db:migrate": "prisma migrate dev",
    "db:migrate:deploy": "prisma migrate deploy",
    "db:seed": "prisma db seed",
    "db:studio": "prisma studio",
    "graphql:schema": "tsx src/generate-schema.ts"
  },
  "devDependencies": {
    "@nestjs/cli": "^11.0.0",
    "@nestjs/schematics": "^11.0.0",
    "@nestjs/testing": "^11.0.0",
    "@swc/cli": "^0.8.1",
    "@swc/core": "^1.15.43",
    "@testcontainers/postgresql": "^10.0.0",
    "@types/jest": "^29.5.0",
    "@types/node": "^26.0.0",
    "@types/passport-google-oauth20": "^2.0.16",
    "@types/passport-jwt": "^4.0.1",
    "@types/pg": "^8.11.0",
    "@types/ws": "^8.5.0",
    "eslint": "^10.0.0",
    "jest": "^29.7.0",
    "prisma": "^7.8.0",
    "supertest": "^7.0.0",
    "testcontainers": "^10.0.0",
    "ts-jest": "^29.2.0",
    "tsconfig-paths": "^4.2.0",
    "tsx": "^4.19.0",
    "typescript": "^6.0.0"
  }
}
```

- [ ] **Step 4: Run pnpm install**

Run: `pnpm install`
Expected: All dependencies installed without errors.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/package.json apps/web/package.json apps/api/package.json pnpm-lock.yaml
git commit -m "chore: add test dependencies to all packages"
```

---

### Task 2: Shared Package Jest Config

**Files:**
- Create: `packages/shared/jest.config.ts`

**Context:** The shared package uses `"type": "module"` (ESM). Source files use `.js` extensions in imports (e.g., `from './enums.js'`). Jest must use ESM mode via `--experimental-vm-modules` and `ts-jest` ESM preset. The `moduleNameMapper` strips `.js` extensions so Jest resolves `.ts` source files.

- [ ] **Step 1: Create Jest config**

Create `packages/shared/jest.config.ts`:

```typescript
export default {
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        useESM: true,
      },
    ],
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  testRegex: '.*\\.spec\\.ts$',
  collectCoverageFrom: ['src/**/*.ts'],
  coverageDirectory: 'coverage',
  coverageThreshold: {
    global: {
      lines: 95,
      branches: 90,
      functions: 95,
      statements: 95,
    },
  },
};
```

- [ ] **Step 2: Verify config loads**

Run: `pnpm --filter @transformlit/shared test --passWithNoTests`
Expected: Jest runs with no tests found, exits 0 (passWithNoTests).

- [ ] **Step 3: Commit**

```bash
git add packages/shared/jest.config.ts
git commit -m "chore: add Jest config for shared package (ESM mode)"
```

---

### Task 3: Web App Jest Config

**Files:**
- Create: `apps/web/jest.config.ts`
- Create: `apps/web/jest.setup.ts`

**Context:** The web app uses Next.js 16 with App Router, React 19, Tailwind CSS v4, Apollo Client, Zustand, and next-themes. Jest runs in jsdom environment. CSS/Tailwind imports are mocked with `identity-obj-proxy`. The `@/` path alias maps to `src/`.

- [ ] **Step 1: Create Jest config**

Create `apps/web/jest.config.ts`:

```typescript
export default {
  testEnvironment: 'jest-environment-jsdom',
  setupFilesAfterEnv: ['./jest.setup.ts'],
  transform: {
    '^.+\\.(ts|tsx)$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.json',
      },
    ],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
    '\\.(jpg|jpeg|png|gif|webp|svg)$': '<rootDir>/test/__mocks__/fileMock.ts',
  },
  testRegex: '.*\\.spec\\.(ts|tsx)$',
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/app/**/page.tsx',
    '!src/app/**/layout.tsx',
  ],
  coverageDirectory: 'coverage',
  coverageThreshold: {
    global: {
      lines: 70,
      branches: 60,
      functions: 70,
      statements: 70,
    },
  },
};
```

- [ ] **Step 2: Create setup file**

Create `apps/web/jest.setup.ts`:

```typescript
import '@testing-library/jest-dom';
```

- [ ] **Step 3: Create file mock**

Create `apps/web/test/__mocks__/fileMock.ts`:

```typescript
export default 'test-file-stub';
```

- [ ] **Step 4: Verify config loads**

Run: `pnpm --filter @transformlit/web test --passWithNoTests`
Expected: Jest runs with no tests found, exits 0.

- [ ] **Step 5: Commit**

```bash
git add apps/web/jest.config.ts apps/web/jest.setup.ts apps/web/test/__mocks__/fileMock.ts
git commit -m "chore: add Jest config for web app (jsdom + testing-library)"
```

---

### Task 4: API Integration Test Config

**Files:**
- Create: `apps/api/jest.integration.config.ts`

**Context:** The API already has `jest.config.ts` for unit tests (rootDir: `src`, testRegex: `*.spec.ts`). Integration tests live in `apps/api/test/` and use `*.integration.spec.ts` naming. The integration config points rootDir to `test/` and maps `@/` to `../src/`.

- [ ] **Step 1: Create integration Jest config**

Create `apps/api/jest.integration.config.ts`:

```typescript
import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'test',
  testRegex: '.*\\.integration\\.spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/../src/$1',
  },
  testTimeout: 60000,
};

export default config;
```

- [ ] **Step 2: Verify config loads**

Run: `pnpm --filter @transformlit/api test:integration --passWithNoTests`
Expected: Jest runs with no tests found, exits 0.

- [ ] **Step 3: Commit**

```bash
git add apps/api/jest.integration.config.ts
git commit -m "chore: add Jest integration config for API (testcontainers)"
```

---

### Task 5: Update Turbo Pipeline + Root Scripts

**Files:**
- Modify: `turbo.json`
- Modify: `package.json` (root)

- [ ] **Step 1: Update turbo.json**

Replace `turbo.json` with:

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**", "build/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {
      "dependsOn": ["^lint"]
    },
    "test": {
      "dependsOn": ["^test"]
    },
    "test:integration": {
      "dependsOn": ["build"]
    },
    "test:e2e": {
      "dependsOn": ["build"],
      "cache": false
    },
    "test:coverage": {
      "dependsOn": ["^test:coverage"]
    },
    "clean": {
      "cache": false
    },
    "graphql:codegen": {
      "cache": false,
      "outputs": ["__generated__/**"]
    },
    "db:generate": {
      "cache": false,
      "outputs": ["node_modules/.prisma/**"]
    },
    "db:migrate": {
      "cache": false
    }
  }
}
```

- [ ] **Step 2: Update root package.json scripts**

Update the `scripts` section in root `package.json`:

```json
{
  "scripts": {
    "dev": "turbo run dev",
    "build": "turbo run build",
    "lint": "turbo run lint",
    "test": "turbo run test",
    "test:integration": "turbo run test:integration",
    "test:e2e": "turbo run test:e2e",
    "test:coverage": "turbo run test:coverage",
    "clean": "turbo run clean",
    "format": "prettier --write \"**/*.{ts,tsx,json,md}\"",
    "graphql:codegen": "turbo run graphql:codegen"
  }
}
```

- [ ] **Step 3: Verify turbo recognizes new tasks**

Run: `pnpm turbo run test --dry`
Expected: Turbo shows the task graph for `test` across all packages.

Run: `pnpm turbo run test:integration --dry`
Expected: Turbo shows `test:integration` task for `@transformlit/api` only.

- [ ] **Step 4: Commit**

```bash
git add turbo.json package.json
git commit -m "chore: add test:integration, test:e2e, test:coverage to turbo pipeline"
```

---

### Task 6: API Test Helpers (Mock Factories)

**Files:**
- Create: `apps/api/test/helpers/create-mock-user.ts`
- Create: `apps/api/test/helpers/create-mock-group.ts`

**Interfaces:**
- Produces: `createMockUser(overrides?)` → returns object matching Prisma `User` model shape
- Produces: `createMockGroup(overrides?)` → returns object matching Prisma `Group` model shape
- These factories are consumed by Tasks in Plan 2 (API Tests)

- [ ] **Step 1: Create mock user factory**

Create `apps/api/test/helpers/create-mock-user.ts`:

```typescript
import { randomUUID } from 'crypto';

export interface MockUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  role: 'ADMIN' | 'MODERATOR' | 'MEMBER';
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

let userCounter = 0;

export function createMockUser(overrides: Partial<MockUser> = {}): MockUser {
  userCounter++;
  return {
    id: randomUUID(),
    email: `user${userCounter}@example.com`,
    displayName: `Test User ${userCounter}`,
    avatarUrl: null,
    bio: null,
    role: 'MEMBER',
    lastLoginAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}
```

- [ ] **Step 2: Create mock group factory**

Create `apps/api/test/helpers/create-mock-group.ts`:

```typescript
import { randomUUID } from 'crypto';
import { createMockUser, MockUser } from './create-mock-user';

export interface MockGroupMember {
  id: string;
  userId: string;
  user: MockUser;
  role: 'OWNER' | 'MEMBER';
  status: 'ACTIVE' | 'PENDING' | 'BANNED';
  joinedAt: Date;
}

export interface MockGroup {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  visibility: 'PUBLIC' | 'PRIVATE';
  category: string | null;
  coverImageUrl: string | null;
  featured: boolean;
  createdBy: MockUser;
  createdById: string;
  members: MockGroupMember[];
  createdAt: Date;
  updatedAt: Date;
}

let groupCounter = 0;

export function createMockGroup(
  overrides: Partial<MockGroup> = {},
): MockGroup {
  groupCounter++;
  const creator = overrides.createdBy ?? createMockUser();
  return {
    id: randomUUID(),
    name: `Test Group ${groupCounter}`,
    slug: `test-group-${groupCounter}`,
    description: `Description for test group ${groupCounter}`,
    visibility: 'PUBLIC',
    category: null,
    coverImageUrl: null,
    featured: false,
    createdBy: creator,
    createdById: creator.id,
    members: [
      {
        id: randomUUID(),
        userId: creator.id,
        user: creator,
        role: 'OWNER',
        status: 'ACTIVE',
        joinedAt: new Date('2026-01-01'),
      },
    ],
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd apps/api && npx tsc --noEmit test/helpers/create-mock-user.ts test/helpers/create-mock-group.ts --esModuleInterop --moduleResolution node --module commonjs --target es2022 --skipLibCheck`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add apps/api/test/helpers/
git commit -m "chore: add mock user and group factories for API tests"
```

---

### Task 7: Web Test Helper (Render with Providers)

**Files:**
- Create: `apps/web/test/helpers/render-with-providers.tsx`

**Interfaces:**
- Consumes: `@apollo/client/testing` (MockedProvider), `next-themes` (ThemeProvider)
- Produces: `renderWithProviders(ui, options?)` → returns Testing Library render result
- Produces: `createMockApolloClient(mocks?)` → returns MockApolloClient for tests
- This helper is consumed by Tasks in Plan 3 (Web Tests)

- [ ] **Step 1: Create render helper**

Create `apps/web/test/helpers/render-with-providers.tsx`:

```typescript
import { ReactElement, ReactNode } from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { MockedProvider, MockedResponse } from '@apollo/client/testing';
import { ThemeProvider } from 'next-themes';

interface WrapperOptions {
  mocks?: MockedResponse[];
}

function createWrapper({ mocks = [] }: WrapperOptions = {}) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MockedProvider mocks={mocks} addTypename={false}>
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem={false}
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </MockedProvider>
    );
  };
}

export function renderWithProviders(
  ui: ReactElement,
  options?: RenderOptions & WrapperOptions,
) {
  const { mocks, ...renderOptions } = options ?? {};
  return render(ui, {
    wrapper: createWrapper({ mocks }),
    ...renderOptions,
  });
}

export { createWrapper };
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd apps/web && npx tsc --noEmit test/helpers/render-with-providers.tsx --jsx react-jsx --esModuleInterop --moduleResolution bundler --module esnext --target es2022 --skipLibCheck`
Expected: No errors (or only errors about missing type declarations that are resolved at project level).

- [ ] **Step 3: Commit**

```bash
git add apps/web/test/helpers/
git commit -m "chore: add render-with-providers helper for web tests"
```

---

### Task 8: Shared Package — Schema Validation Tests

**Files:**
- Test: `packages/shared/src/__tests__/schemas.spec.ts`

**Interfaces:**
- Consumes: All 14 Zod schemas from `../schemas/index.js`
- Tests: Valid inputs pass, invalid inputs fail with correct error paths

- [ ] **Step 1: Write the schema tests**

Create `packages/shared/src/__tests__/schemas.spec.ts`:

```typescript
import {
  registerLocalSchema,
  loginLocalSchema,
  refreshTokenSchema,
  updateProfileSchema,
  createGroupSchema,
  updateGroupSchema,
  friendRequestSchema,
  sendMessageSchema,
  messagesQuerySchema,
  uploadBookSchema,
  updateBookSchema,
  saveProgressSchema,
  addBookmarkSchema,
  addHighlightSchema,
  publishAnnouncementSchema,
  updateAnnouncementSchema,
  cursorPaginationSchema,
} from '../schemas/index.js';

// ── Auth ───────────────────────────────────────────────────────────────────

describe('registerLocalSchema', () => {
  it('should accept valid input', () => {
    const result = registerLocalSchema.safeParse({
      email: 'test@example.com',
      password: 'password123',
      displayName: 'Test User',
    });
    expect(result.success).toBe(true);
  });

  it('should reject invalid email', () => {
    const result = registerLocalSchema.safeParse({
      email: 'not-an-email',
      password: 'password123',
      displayName: 'Test User',
    });
    expect(result.success).toBe(false);
  });

  it('should reject password shorter than 8 characters', () => {
    const result = registerLocalSchema.safeParse({
      email: 'test@example.com',
      password: 'short',
      displayName: 'Test User',
    });
    expect(result.success).toBe(false);
  });

  it('should reject password longer than 128 characters', () => {
    const result = registerLocalSchema.safeParse({
      email: 'test@example.com',
      password: 'a'.repeat(129),
      displayName: 'Test User',
    });
    expect(result.success).toBe(false);
  });

  it('should reject empty displayName', () => {
    const result = registerLocalSchema.safeParse({
      email: 'test@example.com',
      password: 'password123',
      displayName: '',
    });
    expect(result.success).toBe(false);
  });

  it('should reject displayName longer than 100 characters', () => {
    const result = registerLocalSchema.safeParse({
      email: 'test@example.com',
      password: 'password123',
      displayName: 'a'.repeat(101),
    });
    expect(result.success).toBe(false);
  });

  it('should reject missing fields', () => {
    const result = registerLocalSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('loginLocalSchema', () => {
  it('should accept valid input', () => {
    const result = loginLocalSchema.safeParse({
      email: 'test@example.com',
      password: 'password123',
    });
    expect(result.success).toBe(true);
  });

  it('should reject invalid email', () => {
    const result = loginLocalSchema.safeParse({
      email: 'not-an-email',
      password: 'password123',
    });
    expect(result.success).toBe(false);
  });

  it('should reject empty password', () => {
    const result = loginLocalSchema.safeParse({
      email: 'test@example.com',
      password: '',
    });
    expect(result.success).toBe(false);
  });

  it('should reject missing fields', () => {
    const result = loginLocalSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('refreshTokenSchema', () => {
  it('should accept valid token', () => {
    const result = refreshTokenSchema.safeParse({
      refreshToken: 'some-valid-token',
    });
    expect(result.success).toBe(true);
  });

  it('should reject empty token', () => {
    const result = refreshTokenSchema.safeParse({ refreshToken: '' });
    expect(result.success).toBe(false);
  });

  it('should reject missing field', () => {
    const result = refreshTokenSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

// ── User ───────────────────────────────────────────────────────────────────

describe('updateProfileSchema', () => {
  it('should accept all valid fields', () => {
    const result = updateProfileSchema.safeParse({
      displayName: 'New Name',
      bio: 'A short bio',
      avatarUrl: 'https://example.com/avatar.jpg',
    });
    expect(result.success).toBe(true);
  });

  it('should accept empty object (all fields optional)', () => {
    const result = updateProfileSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('should reject empty displayName', () => {
    const result = updateProfileSchema.safeParse({ displayName: '' });
    expect(result.success).toBe(false);
  });

  it('should reject displayName longer than 100 characters', () => {
    const result = updateProfileSchema.safeParse({
      displayName: 'a'.repeat(101),
    });
    expect(result.success).toBe(false);
  });

  it('should reject bio longer than 500 characters', () => {
    const result = updateProfileSchema.safeParse({ bio: 'a'.repeat(501) });
    expect(result.success).toBe(false);
  });

  it('should reject invalid avatarUrl', () => {
    const result = updateProfileSchema.safeParse({
      avatarUrl: 'not-a-url',
    });
    expect(result.success).toBe(false);
  });

  it('should accept valid avatarUrl', () => {
    const result = updateProfileSchema.safeParse({
      avatarUrl: 'https://example.com/photo.png',
    });
    expect(result.success).toBe(true);
  });
});

// ── Group ──────────────────────────────────────────────────────────────────

describe('createGroupSchema', () => {
  it('should accept valid input with defaults', () => {
    const result = createGroupSchema.safeParse({ name: 'Book Club' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.visibility).toBe('PUBLIC');
    }
  });

  it('should accept valid input with all fields', () => {
    const result = createGroupSchema.safeParse({
      name: 'Book Club',
      description: 'A group for reading',
      visibility: 'PRIVATE',
    });
    expect(result.success).toBe(true);
  });

  it('should reject empty name', () => {
    const result = createGroupSchema.safeParse({ name: '' });
    expect(result.success).toBe(false);
  });

  it('should reject name longer than 100 characters', () => {
    const result = createGroupSchema.safeParse({ name: 'a'.repeat(101) });
    expect(result.success).toBe(false);
  });

  it('should reject description longer than 1000 characters', () => {
    const result = createGroupSchema.safeParse({
      name: 'Book Club',
      description: 'a'.repeat(1001),
    });
    expect(result.success).toBe(false);
  });

  it('should reject invalid visibility', () => {
    const result = createGroupSchema.safeParse({
      name: 'Book Club',
      visibility: 'INVALID',
    });
    expect(result.success).toBe(false);
  });

  it('should default visibility to PUBLIC', () => {
    const result = createGroupSchema.safeParse({ name: 'Book Club' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.visibility).toBe('PUBLIC');
    }
  });
});

describe('updateGroupSchema', () => {
  it('should accept empty object (all fields optional)', () => {
    const result = updateGroupSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('should accept partial update', () => {
    const result = updateGroupSchema.safeParse({ name: 'New Name' });
    expect(result.success).toBe(true);
  });

  it('should reject empty name', () => {
    const result = updateGroupSchema.safeParse({ name: '' });
    expect(result.success).toBe(false);
  });

  it('should reject invalid visibility', () => {
    const result = updateGroupSchema.safeParse({ visibility: 'SECRET' });
    expect(result.success).toBe(false);
  });
});

// ── Friend ─────────────────────────────────────────────────────────────────

describe('friendRequestSchema', () => {
  it('should accept valid UUID', () => {
    const result = friendRequestSchema.safeParse({
      addresseeId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBe(true);
  });

  it('should reject invalid UUID', () => {
    const result = friendRequestSchema.safeParse({
      addresseeId: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });

  it('should reject missing field', () => {
    const result = friendRequestSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

// ── Chat ───────────────────────────────────────────────────────────────────

describe('sendMessageSchema', () => {
  it('should accept valid input', () => {
    const result = sendMessageSchema.safeParse({
      conversationId: '550e8400-e29b-41d4-a716-446655440000',
      body: 'Hello world',
    });
    expect(result.success).toBe(true);
  });

  it('should reject invalid conversationId', () => {
    const result = sendMessageSchema.safeParse({
      conversationId: 'not-a-uuid',
      body: 'Hello',
    });
    expect(result.success).toBe(false);
  });

  it('should reject empty body', () => {
    const result = sendMessageSchema.safeParse({
      conversationId: '550e8400-e29b-41d4-a716-446655440000',
      body: '',
    });
    expect(result.success).toBe(false);
  });

  it('should reject body longer than 5000 characters', () => {
    const result = sendMessageSchema.safeParse({
      conversationId: '550e8400-e29b-41d4-a716-446655440000',
      body: 'a'.repeat(5001),
    });
    expect(result.success).toBe(false);
  });
});

describe('messagesQuerySchema', () => {
  it('should accept valid input with defaults', () => {
    const result = messagesQuerySchema.safeParse({
      conversationId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(25);
    }
  });

  it('should accept custom limit', () => {
    const result = messagesQuerySchema.safeParse({
      conversationId: '550e8400-e29b-41d4-a716-446655440000',
      limit: 10,
    });
    expect(result.success).toBe(true);
  });

  it('should reject limit below 1', () => {
    const result = messagesQuerySchema.safeParse({
      conversationId: '550e8400-e29b-41d4-a716-446655440000',
      limit: 0,
    });
    expect(result.success).toBe(false);
  });

  it('should reject limit above 50', () => {
    const result = messagesQuerySchema.safeParse({
      conversationId: '550e8400-e29b-41d4-a716-446655440000',
      limit: 51,
    });
    expect(result.success).toBe(false);
  });

  it('should accept optional cursor', () => {
    const result = messagesQuerySchema.safeParse({
      conversationId: '550e8400-e29b-41d4-a716-446655440000',
      cursor: 'some-cursor-value',
    });
    expect(result.success).toBe(true);
  });

  it('should default limit to 25', () => {
    const result = messagesQuerySchema.safeParse({
      conversationId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(25);
    }
  });
});

// ── Book ───────────────────────────────────────────────────────────────────

describe('uploadBookSchema', () => {
  it('should accept valid input with defaults', () => {
    const result = uploadBookSchema.safeParse({ title: 'My Book' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.accessLevel).toBe('FREE');
      expect(result.data.currency).toBe('USD');
    }
  });

  it('should accept valid input with all fields', () => {
    const result = uploadBookSchema.safeParse({
      title: 'My Book',
      author: 'Author Name',
      description: 'A great book',
      accessLevel: 'RESTRICTED',
      price: 9.99,
      currency: 'EUR',
    });
    expect(result.success).toBe(true);
  });

  it('should reject empty title', () => {
    const result = uploadBookSchema.safeParse({ title: '' });
    expect(result.success).toBe(false);
  });

  it('should reject title longer than 200 characters', () => {
    const result = uploadBookSchema.safeParse({ title: 'a'.repeat(201) });
    expect(result.success).toBe(false);
  });

  it('should reject negative price', () => {
    const result = uploadBookSchema.safeParse({
      title: 'My Book',
      price: -1,
    });
    expect(result.success).toBe(false);
  });

  it('should reject invalid accessLevel', () => {
    const result = uploadBookSchema.safeParse({
      title: 'My Book',
      accessLevel: 'PAID',
    });
    expect(result.success).toBe(false);
  });

  it('should default accessLevel to FREE and currency to USD', () => {
    const result = uploadBookSchema.safeParse({ title: 'My Book' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.accessLevel).toBe('FREE');
      expect(result.data.currency).toBe('USD');
    }
  });
});

describe('updateBookSchema', () => {
  it('should accept empty object (all fields optional)', () => {
    const result = updateBookSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('should accept partial update', () => {
    const result = updateBookSchema.safeParse({
      title: 'Updated Title',
      status: 'PUBLISHED',
    });
    expect(result.success).toBe(true);
  });

  it('should reject invalid status', () => {
    const result = updateBookSchema.safeParse({ status: 'DELETED' });
    expect(result.success).toBe(false);
  });

  it('should reject empty title', () => {
    const result = updateBookSchema.safeParse({ title: '' });
    expect(result.success).toBe(false);
  });

  it('should reject negative price', () => {
    const result = updateBookSchema.safeParse({ price: -5 });
    expect(result.success).toBe(false);
  });
});

describe('saveProgressSchema', () => {
  it('should accept valid input', () => {
    const result = saveProgressSchema.safeParse({
      bookId: '550e8400-e29b-41d4-a716-446655440000',
      currentPage: 42,
    });
    expect(result.success).toBe(true);
  });

  it('should accept input with scrollY', () => {
    const result = saveProgressSchema.safeParse({
      bookId: '550e8400-e29b-41d4-a716-446655440000',
      currentPage: 10,
      scrollY: 250.5,
    });
    expect(result.success).toBe(true);
  });

  it('should reject invalid bookId', () => {
    const result = saveProgressSchema.safeParse({
      bookId: 'not-a-uuid',
      currentPage: 1,
    });
    expect(result.success).toBe(false);
  });

  it('should reject page below 1', () => {
    const result = saveProgressSchema.safeParse({
      bookId: '550e8400-e29b-41d4-a716-446655440000',
      currentPage: 0,
    });
    expect(result.success).toBe(false);
  });

  it('should reject negative scrollY', () => {
    const result = saveProgressSchema.safeParse({
      bookId: '550e8400-e29b-41d4-a716-446655440000',
      currentPage: 1,
      scrollY: -1,
    });
    expect(result.success).toBe(false);
  });

  it('should reject non-integer currentPage', () => {
    const result = saveProgressSchema.safeParse({
      bookId: '550e8400-e29b-41d4-a716-446655440000',
      currentPage: 1.5,
    });
    expect(result.success).toBe(false);
  });
});

describe('addBookmarkSchema', () => {
  it('should accept valid input', () => {
    const result = addBookmarkSchema.safeParse({
      bookId: '550e8400-e29b-41d4-a716-446655440000',
      page: 42,
    });
    expect(result.success).toBe(true);
  });

  it('should accept input with optional fields', () => {
    const result = addBookmarkSchema.safeParse({
      bookId: '550e8400-e29b-41d4-a716-446655440000',
      page: 42,
      label: 'Important section',
      color: '#ff0000',
    });
    expect(result.success).toBe(true);
  });

  it('should reject invalid bookId', () => {
    const result = addBookmarkSchema.safeParse({
      bookId: 'not-a-uuid',
      page: 1,
    });
    expect(result.success).toBe(false);
  });

  it('should reject page below 1', () => {
    const result = addBookmarkSchema.safeParse({
      bookId: '550e8400-e29b-41d4-a716-446655440000',
      page: 0,
    });
    expect(result.success).toBe(false);
  });

  it('should reject label longer than 200 characters', () => {
    const result = addBookmarkSchema.safeParse({
      bookId: '550e8400-e29b-41d4-a716-446655440000',
      page: 1,
      label: 'a'.repeat(201),
    });
    expect(result.success).toBe(false);
  });
});

describe('addHighlightSchema', () => {
  it('should accept valid input', () => {
    const result = addHighlightSchema.safeParse({
      bookId: '550e8400-e29b-41d4-a716-446655440000',
      page: 42,
      text: 'Highlighted text passage',
    });
    expect(result.success).toBe(true);
  });

  it('should accept input with optional fields', () => {
    const result = addHighlightSchema.safeParse({
      bookId: '550e8400-e29b-41d4-a716-446655440000',
      page: 42,
      text: 'Highlighted text',
      note: 'My note about this',
      color: '#ffff00',
    });
    expect(result.success).toBe(true);
  });

  it('should reject empty text', () => {
    const result = addHighlightSchema.safeParse({
      bookId: '550e8400-e29b-41d4-a716-446655440000',
      page: 1,
      text: '',
    });
    expect(result.success).toBe(false);
  });

  it('should reject text longer than 10000 characters', () => {
    const result = addHighlightSchema.safeParse({
      bookId: '550e8400-e29b-41d4-a716-446655440000',
      page: 1,
      text: 'a'.repeat(10001),
    });
    expect(result.success).toBe(false);
  });

  it('should reject note longer than 5000 characters', () => {
    const result = addHighlightSchema.safeParse({
      bookId: '550e8400-e29b-41d4-a716-446655440000',
      page: 1,
      text: 'Some text',
      note: 'a'.repeat(5001),
    });
    expect(result.success).toBe(false);
  });

  it('should reject invalid bookId', () => {
    const result = addHighlightSchema.safeParse({
      bookId: 'not-a-uuid',
      page: 1,
      text: 'Some text',
    });
    expect(result.success).toBe(false);
  });

  it('should reject page below 1', () => {
    const result = addHighlightSchema.safeParse({
      bookId: '550e8400-e29b-41d4-a716-446655440000',
      page: 0,
      text: 'Some text',
    });
    expect(result.success).toBe(false);
  });
});

// ── Feed ───────────────────────────────────────────────────────────────────

describe('publishAnnouncementSchema', () => {
  it('should accept valid input with defaults', () => {
    const result = publishAnnouncementSchema.safeParse({
      title: 'New Event',
      body: 'Join us for an exciting event',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.category).toBe('GENERAL');
    }
  });

  it('should accept valid input with all fields', () => {
    const result = publishAnnouncementSchema.safeParse({
      title: 'New Event',
      body: 'Join us for an exciting event',
      category: 'EVENT',
      publishAt: '2026-07-01T10:00:00Z',
      expiresAt: '2026-07-31T23:59:59Z',
    });
    expect(result.success).toBe(true);
  });

  it('should reject empty title', () => {
    const result = publishAnnouncementSchema.safeParse({
      title: '',
      body: 'Some body',
    });
    expect(result.success).toBe(false);
  });

  it('should reject title longer than 200 characters', () => {
    const result = publishAnnouncementSchema.safeParse({
      title: 'a'.repeat(201),
      body: 'Some body',
    });
    expect(result.success).toBe(false);
  });

  it('should reject empty body', () => {
    const result = publishAnnouncementSchema.safeParse({
      title: 'Title',
      body: '',
    });
    expect(result.success).toBe(false);
  });

  it('should reject body longer than 10000 characters', () => {
    const result = publishAnnouncementSchema.safeParse({
      title: 'Title',
      body: 'a'.repeat(10001),
    });
    expect(result.success).toBe(false);
  });

  it('should reject invalid category', () => {
    const result = publishAnnouncementSchema.safeParse({
      title: 'Title',
      body: 'Body',
      category: 'NEWS',
    });
    expect(result.success).toBe(false);
  });

  it('should reject invalid datetime format for publishAt', () => {
    const result = publishAnnouncementSchema.safeParse({
      title: 'Title',
      body: 'Body',
      publishAt: 'not-a-date',
    });
    expect(result.success).toBe(false);
  });

  it('should default category to GENERAL', () => {
    const result = publishAnnouncementSchema.safeParse({
      title: 'Title',
      body: 'Body',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.category).toBe('GENERAL');
    }
  });
});

describe('updateAnnouncementSchema', () => {
  it('should accept empty object (all fields optional)', () => {
    const result = updateAnnouncementSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('should accept partial update', () => {
    const result = updateAnnouncementSchema.safeParse({
      title: 'Updated Title',
      status: 'ARCHIVED',
    });
    expect(result.success).toBe(true);
  });

  it('should reject invalid status', () => {
    const result = updateAnnouncementSchema.safeParse({
      status: 'DELETED',
    });
    expect(result.success).toBe(false);
  });

  it('should reject invalid category', () => {
    const result = updateAnnouncementSchema.safeParse({
      category: 'NEWS',
    });
    expect(result.success).toBe(false);
  });

  it('should reject empty title', () => {
    const result = updateAnnouncementSchema.safeParse({ title: '' });
    expect(result.success).toBe(false);
  });

  it('should accept valid status transitions', () => {
    for (const status of ['DRAFT', 'PUBLISHED', 'ARCHIVED']) {
      const result = updateAnnouncementSchema.safeParse({ status });
      expect(result.success).toBe(true);
    }
  });
});

// ── Pagination ─────────────────────────────────────────────────────────────

describe('cursorPaginationSchema', () => {
  it('should accept empty object with defaults', () => {
    const result = cursorPaginationSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(25);
      expect(result.data.cursor).toBeUndefined();
    }
  });

  it('should accept valid cursor and limit', () => {
    const result = cursorPaginationSchema.safeParse({
      cursor: 'abc123',
      limit: 10,
    });
    expect(result.success).toBe(true);
  });

  it('should reject limit below 1', () => {
    const result = cursorPaginationSchema.safeParse({ limit: 0 });
    expect(result.success).toBe(false);
  });

  it('should reject limit above 100', () => {
    const result = cursorPaginationSchema.safeParse({ limit: 101 });
    expect(result.success).toBe(false);
  });

  it('should reject non-integer limit', () => {
    const result = cursorPaginationSchema.safeParse({ limit: 10.5 });
    expect(result.success).toBe(false);
  });

  it('should default limit to 25', () => {
    const result = cursorPaginationSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(25);
    }
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `pnpm --filter @transformlit/shared test`
Expected: All tests PASS (approximately 80+ test cases across 17 describe blocks).

- [ ] **Step 3: Run with coverage**

Run: `pnpm --filter @transformlit/shared test --coverage`
Expected: Coverage meets or exceeds 95% threshold for lines, branches, functions, statements.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/__tests__/schemas.spec.ts
git commit -m "test: add Zod schema validation tests for all 14 shared schemas"
```

---

### Task 9: Shared Package — Enum + Constants Tests

**Files:**
- Test: `packages/shared/src/__tests__/enums.spec.ts`

**Interfaces:**
- Consumes: All enums and constants from `../enums.js`
- Tests: Enum member counts, specific values, constant values

- [ ] **Step 1: Write the enum and constants tests**

Create `packages/shared/src/__tests__/enums.spec.ts`:

```typescript
import {
  UserRole,
  GroupVisibility,
  GroupMemberRole,
  GroupMemberStatus,
  FriendshipStatus,
  ConversationType,
  BookAccessLevel,
  BookStatus,
  AnnouncementStatus,
  AnnouncementCategory,
  GroupCategory,
  NotificationType,
  JWT_ACCESS_EXPIRY,
  JWT_REFRESH_EXPIRY_DAYS,
  VERSE_CACHE_TTL_HOURS,
  MAX_FILE_SIZE_BYTES,
  ALLOWED_UPLOAD_MIMETYPES,
  RATE_LIMIT_AUTH_WINDOW_MS,
  RATE_LIMIT_AUTH_MAX,
} from '../enums.js';

// ── Enums ──────────────────────────────────────────────────────────────────

describe('UserRole', () => {
  it('should have exactly 3 members', () => {
    expect(Object.keys(UserRole)).toHaveLength(3);
  });

  it('should have correct values', () => {
    expect(UserRole.ADMIN).toBe('ADMIN');
    expect(UserRole.MODERATOR).toBe('MODERATOR');
    expect(UserRole.MEMBER).toBe('MEMBER');
  });
});

describe('GroupVisibility', () => {
  it('should have exactly 2 members', () => {
    expect(Object.keys(GroupVisibility)).toHaveLength(2);
  });

  it('should have correct values', () => {
    expect(GroupVisibility.PUBLIC).toBe('PUBLIC');
    expect(GroupVisibility.PRIVATE).toBe('PRIVATE');
  });
});

describe('GroupMemberRole', () => {
  it('should have exactly 2 members', () => {
    expect(Object.keys(GroupMemberRole)).toHaveLength(2);
  });

  it('should have correct values', () => {
    expect(GroupMemberRole.OWNER).toBe('OWNER');
    expect(GroupMemberRole.MEMBER).toBe('MEMBER');
  });
});

describe('GroupMemberStatus', () => {
  it('should have exactly 3 members', () => {
    expect(Object.keys(GroupMemberStatus)).toHaveLength(3);
  });

  it('should have correct values', () => {
    expect(GroupMemberStatus.ACTIVE).toBe('ACTIVE');
    expect(GroupMemberStatus.PENDING).toBe('PENDING');
    expect(GroupMemberStatus.BANNED).toBe('BANNED');
  });
});

describe('FriendshipStatus', () => {
  it('should have exactly 4 members', () => {
    expect(Object.keys(FriendshipStatus)).toHaveLength(4);
  });

  it('should have correct values', () => {
    expect(FriendshipStatus.PENDING).toBe('PENDING');
    expect(FriendshipStatus.ACCEPTED).toBe('ACCEPTED');
    expect(FriendshipStatus.REJECTED).toBe('REJECTED');
    expect(FriendshipStatus.BLOCKED).toBe('BLOCKED');
  });
});

describe('ConversationType', () => {
  it('should have exactly 2 members', () => {
    expect(Object.keys(ConversationType)).toHaveLength(2);
  });

  it('should have correct values', () => {
    expect(ConversationType.DIRECT).toBe('DIRECT');
    expect(ConversationType.GROUP).toBe('GROUP');
  });
});

describe('BookAccessLevel', () => {
  it('should have exactly 2 members', () => {
    expect(Object.keys(BookAccessLevel)).toHaveLength(2);
  });

  it('should have correct values', () => {
    expect(BookAccessLevel.FREE).toBe('FREE');
    expect(BookAccessLevel.RESTRICTED).toBe('RESTRICTED');
  });
});

describe('BookStatus', () => {
  it('should have exactly 3 members', () => {
    expect(Object.keys(BookStatus)).toHaveLength(3);
  });

  it('should have correct values', () => {
    expect(BookStatus.DRAFT).toBe('DRAFT');
    expect(BookStatus.PUBLISHED).toBe('PUBLISHED');
    expect(BookStatus.COMING_SOON).toBe('COMING_SOON');
  });
});

describe('AnnouncementStatus', () => {
  it('should have exactly 3 members', () => {
    expect(Object.keys(AnnouncementStatus)).toHaveLength(3);
  });

  it('should have correct values', () => {
    expect(AnnouncementStatus.DRAFT).toBe('DRAFT');
    expect(AnnouncementStatus.PUBLISHED).toBe('PUBLISHED');
    expect(AnnouncementStatus.ARCHIVED).toBe('ARCHIVED');
  });
});

describe('AnnouncementCategory', () => {
  it('should have exactly 3 members', () => {
    expect(Object.keys(AnnouncementCategory)).toHaveLength(3);
  });

  it('should have correct values', () => {
    expect(AnnouncementCategory.EVENT).toBe('EVENT');
    expect(AnnouncementCategory.UPDATE).toBe('UPDATE');
    expect(AnnouncementCategory.GENERAL).toBe('GENERAL');
  });
});

describe('GroupCategory', () => {
  it('should have exactly 5 members', () => {
    expect(Object.keys(GroupCategory)).toHaveLength(5);
  });

  it('should have correct values', () => {
    expect(GroupCategory.BIBLICAL_STUDIES).toBe('BIBLICAL_STUDIES');
    expect(GroupCategory.MODERN_FICTION).toBe('MODERN_FICTION');
    expect(GroupCategory.HISTORICAL).toBe('HISTORICAL');
    expect(GroupCategory.PHILOSOPHY).toBe('PHILOSOPHY');
    expect(GroupCategory.YOUNG_ADULT).toBe('YOUNG_ADULT');
  });
});

describe('NotificationType', () => {
  it('should have exactly 6 members', () => {
    expect(Object.keys(NotificationType)).toHaveLength(6);
  });

  it('should have correct values', () => {
    expect(NotificationType.FRIEND_REQUEST).toBe('FRIEND_REQUEST');
    expect(NotificationType.FRIEND_ACCEPTED).toBe('FRIEND_ACCEPTED');
    expect(NotificationType.GROUP_INVITE).toBe('GROUP_INVITE');
    expect(NotificationType.GROUP_UPDATE).toBe('GROUP_UPDATE');
    expect(NotificationType.ANNOUNCEMENT).toBe('ANNOUNCEMENT');
    expect(NotificationType.SYSTEM).toBe('SYSTEM');
  });
});

// ── Constants ──────────────────────────────────────────────────────────────

describe('Constants', () => {
  it('JWT_ACCESS_EXPIRY should be 15m', () => {
    expect(JWT_ACCESS_EXPIRY).toBe('15m');
  });

  it('JWT_REFRESH_EXPIRY_DAYS should be 7', () => {
    expect(JWT_REFRESH_EXPIRY_DAYS).toBe(7);
  });

  it('VERSE_CACHE_TTL_HOURS should be 24', () => {
    expect(VERSE_CACHE_TTL_HOURS).toBe(24);
  });

  it('MAX_FILE_SIZE_BYTES should be 50 MB', () => {
    expect(MAX_FILE_SIZE_BYTES).toBe(50 * 1024 * 1024);
  });

  it('ALLOWED_UPLOAD_MIMETYPES should contain only application/pdf', () => {
    expect(ALLOWED_UPLOAD_MIMETYPES).toEqual(['application/pdf']);
  });

  it('RATE_LIMIT_AUTH_WINDOW_MS should be 15 minutes', () => {
    expect(RATE_LIMIT_AUTH_WINDOW_MS).toBe(15 * 60 * 1000);
  });

  it('RATE_LIMIT_AUTH_MAX should be 10', () => {
    expect(RATE_LIMIT_AUTH_MAX).toBe(10);
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `pnpm --filter @transformlit/shared test`
Expected: All tests PASS (approximately 30+ test cases across 13 describe blocks).

- [ ] **Step 3: Run with coverage to verify thresholds**

Run: `pnpm --filter @transformlit/shared test --coverage`
Expected: Coverage report shows >= 95% for lines, branches, functions, statements. Threshold check passes.

- [ ] **Step 4: Run full monorepo tests to verify nothing is broken**

Run: `pnpm test`
Expected: Turbo runs `test` across all packages. Shared package tests pass. API and web pass with no tests (passWithNoTests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/__tests__/enums.spec.ts
git commit -m "test: add enum values and constants validation tests for shared package"
```
