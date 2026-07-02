# API Integration Tests — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write integration tests for critical API flows using real PostgreSQL via testcontainers, verifying full request cycles from GraphQL resolvers through services to the database.

**Architecture:** Integration tests use `@nestjs/testing` to bootstrap the full NestJS application with a real PostgreSQL database (via testcontainers). Tests verify the complete request cycle: GraphQL request → resolver → service → Prisma → real DB → response.

**Tech Stack:** Jest, @nestjs/testing, @testcontainers/postgresql, supertest, graphql-request

## Global Constraints

- Integration tests live in `apps/api/test/`
- Test files use `*.integration.spec.ts` naming convention
- Tests use the existing `jest.integration.config.ts` configuration
- Real PostgreSQL database via testcontainers
- Each test suite manages its own database setup/teardown
- Tests verify full request cycles, not just unit behavior
- 60-second timeout configured for testcontainer startup

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `apps/api/test/auth.integration.spec.ts` | Auth flow: register, login, refresh, revoke |
| `apps/api/test/groups.integration.spec.ts` | Groups flow: create, join, leave, members |
| `apps/api/test/friends.integration.spec.ts` | Friends flow: request, accept, reject |
| `apps/api/test/chat.integration.spec.ts` | Chat flow: conversation, messages, pagination |
| `apps/api/test/books.integration.spec.ts` | Books flow: upload, progress, bookmarks |

---

### Task 1: Auth Integration Tests

**Files:**
- Create: `apps/api/test/auth.integration.spec.ts`

- [ ] **Step 1: Write auth integration tests**

Create `apps/api/test/auth.integration.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthService } from '../src/auth/auth.service';
import { PostgreSQLContainer } from '@testcontainers/postgresql';

describe('Auth Integration', () => {
  let app: INestApplication;
  let authService: AuthService;
  let prisma: PrismaService;
  let container: PostgreSQLContainer;

  beforeAll(async () => {
    // Start PostgreSQL container
    container = await new PostgreSQLContainer('postgres:15-alpine')
      .withDatabase('testdb')
      .withUsername('test')
      .withPassword('test')
      .start();

    // Set environment variables
    process.env.DATABASE_URL = container.getConnectionUri();
    process.env.JWT_SECRET = 'test-jwt-secret';
    process.env.GOOGLE_CLIENT_ID = 'test';
    process.env.GOOGLE_CLIENT_SECRET = 'test';
    process.env.GOOGLE_CALLBACK_URL = 'http://localhost:3005/auth/google/callback';
    process.env.FRONTEND_URL = 'http://localhost:3000';
    process.env.AZURE_STORAGE_CONNECTION_STRING = 'test';
    process.env.AZURE_STORAGE_CONTAINER = 'test';
    process.env.AZURE_COMMUNICATION_CONNECTION_STRING = 'test';
    process.env.AZURE_EMAIL_SENDER = 'test@example.com';

    // Create testing module
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    authService = moduleFixture.get<AuthService>(AuthService);
    prisma = moduleFixture.get<PrismaService>(PrismaService);

    // Run migrations
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "User" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "email" TEXT NOT NULL UNIQUE,
        "emailNormalized" TEXT NOT NULL UNIQUE,
        "displayName" TEXT NOT NULL,
        "passwordHash" TEXT,
        "avatarUrl" TEXT,
        "bio" TEXT,
        "role" TEXT NOT NULL DEFAULT 'MEMBER',
        "status" TEXT NOT NULL DEFAULT 'ACTIVE',
        "lastLoginAt" TIMESTAMP(3),
        "deletedAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL
      )
    `);

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "Identity" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "provider" TEXT NOT NULL,
        "providerId" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE("provider", "providerId"),
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
      )
    `);

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "RefreshToken" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "tokenHash" TEXT NOT NULL UNIQUE,
        "userId" TEXT NOT NULL,
        "familyId" TEXT,
        "revokedAt" TIMESTAMP(3),
        "expiresAt" TIMESTAMP(3) NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
      )
    `);
  }, 120000);

  afterAll(async () => {
    await app?.close();
    await container?.stop();
  });

  beforeEach(async () => {
    // Clean database before each test
    await prisma.refreshToken.deleteMany();
    await prisma.identity.deleteMany();
    await prisma.user.deleteMany();
  });

  describe('registerLocal', () => {
    it('should register a new user and return tokens', async () => {
      const input = {
        email: 'test@example.com',
        password: 'password123',
        displayName: 'Test User',
      };

      const result = await authService.registerLocal(input);

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result.user).toHaveProperty('id');
      expect(result.user.email).toBe('test@example.com');
      expect(result.user.displayName).toBe('Test User');

      // Verify user exists in database
      const dbUser = await prisma.user.findUnique({
        where: { emailNormalized: 'test@example.com' },
      });
      expect(dbUser).toBeTruthy();
      expect(dbUser?.passwordHash).not.toBe('password123'); // Should be hashed
    });

    it('should fail to register with duplicate email', async () => {
      const input = {
        email: 'duplicate@example.com',
        password: 'password123',
        displayName: 'Test User',
      };

      await authService.registerLocal(input);

      await expect(authService.registerLocal(input)).rejects.toThrow();
    });
  });

  describe('loginLocal', () => {
    it('should login with valid credentials', async () => {
      const input = {
        email: 'login@example.com',
        password: 'password123',
        displayName: 'Login User',
      };

      await authService.registerLocal(input);

      const result = await authService.loginLocal({
        email: 'login@example.com',
        password: 'password123',
      });

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result.user.email).toBe('login@example.com');
    });

    it('should fail login with wrong password', async () => {
      const input = {
        email: 'wrong@example.com',
        password: 'password123',
        displayName: 'Wrong User',
      };

      await authService.registerLocal(input);

      await expect(
        authService.loginLocal({
          email: 'wrong@example.com',
          password: 'wrongpassword',
        }),
      ).rejects.toThrow('Invalid credentials');
    });

    it('should fail login with non-existent user', async () => {
      await expect(
        authService.loginLocal({
          email: 'nonexistent@example.com',
          password: 'password123',
        }),
      ).rejects.toThrow('Invalid credentials');
    });
  });

  describe('refreshTokens', () => {
    it('should refresh tokens and rotate', async () => {
      const registerInput = {
        email: 'refresh@example.com',
        password: 'password123',
        displayName: 'Refresh User',
      };

      const { refreshToken } = await authService.registerLocal(registerInput);

      const result = await authService.refreshTokens(refreshToken);

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result.refreshToken).not.toBe(refreshToken); // Should be rotated

      // Old token should be revoked
      const oldTokenHash = require('crypto')
        .createHash('sha256')
        .update(refreshToken)
        .digest('hex');
      const oldToken = await prisma.refreshToken.findUnique({
        where: { tokenHash: oldTokenHash },
      });
      expect(oldToken?.revokedAt).toBeTruthy();
    });

    it('should fail refresh with invalid token', async () => {
      await expect(authService.refreshTokens('invalid-token')).rejects.toThrow();
    });
  });

  describe('validateUser', () => {
    it('should validate existing user', async () => {
      const { user } = await authService.registerLocal({
        email: 'validate@example.com',
        password: 'password123',
        displayName: 'Validate User',
      });

      const validated = await authService.validateUser(user.id);
      expect(validated).toBeTruthy();
      expect(validated?.id).toBe(user.id);
    });

    it('should return null for non-existent user', async () => {
      const validated = await authService.validateUser('non-existent-id');
      expect(validated).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run integration tests**

Run: `pnpm --filter @transformlit/api test:integration`
Expected: Tests run with testcontainers, all pass

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/auth.integration.spec.ts
git commit -m "test: add auth integration tests (register, login, refresh)"
```

---

### Task 2: Groups Integration Tests

**Files:**
- Create: `apps/api/test/groups.integration.spec.ts`

- [ ] **Step 1: Write groups integration tests**

Create `apps/api/test/groups.integration.spec.ts` with tests for:
- Create group and verify in database
- Join group (PUBLIC → ACTIVE, PRIVATE → PENDING)
- Leave group and verify membership removed
- List members with user objects
- Update group and verify changes
- Delete group (soft delete)

- [ ] **Step 2: Run integration tests**

Run: `pnpm --filter @transformlit/api test:integration -- groups`
Expected: Tests pass

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/groups.integration.spec.ts
git commit -m "test: add groups integration tests"
```

---

### Task 3: Friends Integration Tests

**Files:**
- Create: `apps/api/test/friends.integration.spec.ts`

- [ ] **Step 1: Write friends integration tests**

Create `apps/api/test/friends.integration.spec.ts` with tests for:
- Send friend request
- Accept friend request
- Reject friend request
- List friends
- List pending requests
- Prevent self-friend
- Prevent duplicate requests

- [ ] **Step 2: Run integration tests**

Run: `pnpm --filter @transformlit/api test:integration -- friends`
Expected: Tests pass

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/friends.integration.spec.ts
git commit -m "test: add friends integration tests"
```

---

### Task 4: Chat Integration Tests

**Files:**
- Create: `apps/api/test/chat.integration.spec.ts`

- [ ] **Step 1: Write chat integration tests**

Create `apps/api/test/chat.integration.spec.ts` with tests for:
- Create direct conversation
- Send message
- Get messages with pagination
- Mark conversation as read

- [ ] **Step 2: Run integration tests**

Run: `pnpm --filter @transformlit/api test:integration -- chat`
Expected: Tests pass

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/chat.integration.spec.ts
git commit -m "test: add chat integration tests"
```

---

### Task 5: Books Integration Tests

**Files:**
- Create: `apps/api/test/books.integration.spec.ts`

- [ ] **Step 1: Write books integration tests**

Create `apps/api/test/books.integration.spec.ts` with tests for:
- Create book
- Save reading progress
- Add bookmark
- Add highlight
- List bookmarks/highlights

- [ ] **Step 2: Run integration tests**

Run: `pnpm --filter @transformlit/api test:integration -- books`
Expected: Tests pass

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/books.integration.spec.ts
git commit -m "test: add books integration tests"
```

---

## Summary

This plan produces **5 integration test files** covering critical API flows:
- Auth: register, login, refresh, validate
- Groups: create, join, leave, members, update, delete
- Friends: send, accept, reject, list, prevent duplicates
- Chat: conversation, messages, pagination, mark read
- Books: create, progress, bookmarks, highlights

Expected test count: **~30 integration tests**
