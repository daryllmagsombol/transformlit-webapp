# Testing Strategy Design

**Date:** 2026-06-29  
**Status:** Approved  
**Project:** Transformlit Webapp (Monorepo)

---

## Overview

This document defines the testing strategy for the Transformlit monorepo, covering the NestJS GraphQL API, Next.js frontend, shared packages, and end-to-end user flows. The goal is to provide a comprehensive safety net that enables confident shipping and fast feedback during development.

## Goals

- **Confidence to ship:** Changes should not break existing functionality
- **Fast feedback:** Unit tests run in seconds during development
- **Realistic validation:** Integration and E2E tests verify real database queries and user flows
- **Maintainability:** Tests are isolated, well-organized, and easy to update
- **CI/CD integration:** All tests run automatically on every PR

## Approach: Testing Pyramid

| Layer | Percentage | Speed | Purpose |
|-------|-----------|-------|---------|
| **Unit Tests** | 70% | Fast (~30s) | Isolated logic, mocked dependencies |
| **Integration Tests** | 20% | Medium (~2min) | Real database, full request cycles |
| **E2E Tests** | 10% | Slow (~3min) | Critical user journeys in a real browser |

---

## Tooling & Architecture

### Test Frameworks

| Layer | Tool | Purpose |
|-------|------|---------|
| **API Unit/Integration** | Jest + `@nestjs/testing` | Test resolvers, services, guards |
| **API Integration DB** | `@testcontainers/postgresql` | Spin up real Postgres for integration tests |
| **Web Unit** | Jest + `@testing-library/react` + `@testing-library/jest-dom` | Test components, hooks, stores |
| **Shared** | Jest | Test Zod schemas, enum constants |
| **E2E** | Playwright | Test critical user flows in a real browser |
| **Coverage** | Istanbul (built into Jest) | Track and enforce coverage thresholds |

### File Conventions

- **Unit tests:** `*.spec.ts` co-located with source files (e.g., `auth.service.spec.ts` next to `auth.service.ts`)
- **Integration tests:** `*.integration.spec.ts` in a `__tests__/` folder within each module
- **E2E tests:** `apps/web/e2e/*.spec.ts` in a dedicated `e2e/` directory

### Turbo Pipeline

| Command | Purpose |
|---------|---------|
| `pnpm test` | Run unit tests across all packages |
| `pnpm test:integration` | Run integration tests (API only) |
| `pnpm test:e2e` | Run Playwright E2E tests |
| `pnpm test:coverage` | Run unit tests with coverage report |

---

## API Testing Strategy

### Unit Tests (mocked Prisma, fast)

#### Auth Module

- **`auth.service.spec.ts`**
  - Register: hash password, create user + identity, handle duplicate email
  - Login: verify credentials, issue JWT + refresh token, handle invalid credentials
  - Refresh token: rotate tokens, revoke expired tokens, prevent token reuse
  - Logout: revoke all refresh tokens for user

- **`auth.resolver.spec.ts`**
  - Mutation handlers delegate to service correctly
  - Return correct GraphQL types (AuthPayload, User)

- **`guards/jwt-auth.guard.spec.ts`**
  - Block unauthenticated requests
  - Allow `@Public()` decorated routes
  - Extract user from valid JWT

- **`guards/roles.guard.spec.ts`**
  - Block requests with insufficient roles
  - Allow requests with valid roles (ADMIN, MODERATOR, MEMBER)

- **`strategies/jwt.strategy.spec.ts`**
  - Extract user from valid token
  - Reject expired tokens
  - Reject malformed tokens

#### Users Module

- **`users.service.spec.ts`**
  - Find user by ID, email
  - Update profile (display name, avatar)
  - Change user role (ADMIN, MODERATOR, MEMBER)
  - Soft delete user

- **`users.resolver.spec.ts`**
  - Query delegation to service
  - Mutation delegation to service

#### Groups Module

- **`groups.service.spec.ts`**
  - CRUD operations (create, read, update, delete)
  - Membership management (add/remove members, role assignment)
  - Visibility checks (PUBLIC vs PRIVATE groups)
  - Category filtering (BIBLE_STUDY, FELLOWSHIP, etc.)
  - Featured groups query
  - Prevent unauthorized access to private groups

- **`groups.resolver.spec.ts`**
  - Query/mutation delegation
  - Pagination handling

#### Friends Module

- **`friends.service.spec.ts`**
  - Send friend request
  - Accept friend request
  - Reject friend request
  - Block user
  - Prevent duplicate friend requests
  - Prevent self-friend requests
  - Query friend list with pagination

- **`friends.resolver.spec.ts`**
  - Mutation delegation
  - Query delegation

#### Chat Module

- **`chat.service.spec.ts`**
  - Create conversation (DIRECT vs GROUP)
  - Send message with content
  - Cursor-based pagination for messages
  - Access control: only members can read messages
  - Prevent unauthorized message sending

- **`chat.resolver.spec.ts`**
  - Subscription setup (GraphQL subscriptions)
  - Mutation delegation

#### Books Module

- **`books.service.spec.ts`**
  - CRUD operations for books
  - PDF upload to Azure Blob Storage (mocked)
  - PDF streaming from Azure Blob Storage (mocked)
  - Reading progress tracking (page number, scrollY position)
  - Bookmark creation and retrieval
  - Highlight creation and retrieval
  - Access control: FREE vs RESTRICTED books

- **`books.resolver.spec.ts`**
  - Query/mutation delegation
  - File upload handling

#### Feed Module

- **`feed.service.spec.ts`**
  - Announcements CRUD (DRAFT, PUBLISHED, ARCHIVED status)
  - Category filtering (EVENT, UPDATE, GENERAL)
  - Verse of the Day: fetch from API, cache for 24 hours, return cached version
  - Pagination for announcements

- **`feed.resolver.spec.ts`**
  - Query delegation
  - Admin-only mutations (create/update announcements)

#### Notifications Module

- **`notifications.service.spec.ts`**
  - Create notification by type (FRIEND_REQUEST, FRIEND_ACCEPTED, GROUP_INVITE, etc.)
  - Mark notification as read
  - Mark all notifications as read
  - Paginate notifications (read vs unread)
  - Type-specific creation logic (e.g., auto-create notification on friend request)

- **`notifications.resolver.spec.ts`**
  - Query/mutation delegation

### Integration Tests (real Postgres via testcontainers)

These tests verify the full request cycle: GraphQL request → resolver → service → Prisma → real database.

- **`auth.integration.spec.ts`**
  - Full register → login → refresh → revoke cycle
  - Verify JWT tokens are valid and can be decoded
  - Verify refresh token rotation in database

- **`groups.integration.spec.ts`**
  - Create group → add members → query with filters → remove member
  - Verify membership roles (OWNER, MEMBER)
  - Verify visibility enforcement (PRIVATE groups)

- **`friends.integration.spec.ts`**
  - Send request → accept → verify friendship exists in database
  - Send request → reject → verify friendship is removed
  - Block user → verify no further requests can be sent

- **`chat.integration.spec.ts`**
  - Create conversation → send messages → paginate → verify order
  - Verify cursor-based pagination returns correct results
  - Verify access control (non-members cannot read messages)

- **`books.integration.spec.ts`**
  - Create book → track progress → bookmark → query with filters
  - Verify reading progress is saved and retrieved correctly
  - Verify bookmarks and highlights are associated with correct book/user

---

## Web (Frontend) Testing Strategy

### Unit Tests — UI Components (17 primitives)

Test rendering, props, interactions, and accessibility basics using `@testing-library/react`.

- **`Button.spec.tsx`** — variants (primary, secondary, ghost, danger), sizes (sm, md, lg), disabled state, loading spinner, click handler
- **`Input.spec.tsx`** / **`TextInput.spec.tsx`** — value binding, error states, labels, disabled state
- **`Card.spec.tsx`** — renders children, applies className, padding variants
- **`Modal.spec.tsx`** — opens/closes, backdrop click to close, escape key to close, portal rendering
- **`Toast.spec.tsx`** — shows message, auto-dismiss after timeout, manual dismiss, toast types (success, error, info, warning)
- **`NavItem.spec.tsx`** — active state styling, link rendering, icon display
- **`UserAvatar.spec.tsx`** — image rendering, fallback to initials, size variants
- **`SkeletonCard.spec.tsx`** — renders skeleton structure with correct dimensions
- **`GroupCard.spec.tsx`** / **`FeaturedGroupCard.spec.tsx`** / **`CompactGroupCard.spec.tsx`** — data display, click navigation, member count
- **`BookCard.spec.tsx`** — book info display, progress bar, cover image, access badge (FREE/RESTRICTED)
- **`ReadingProgressCard.spec.tsx`** — progress percentage calculation, book info display
- **`CategoryChip.spec.tsx`** — label rendering, active state, click handler
- **`Icons.spec.tsx`** — each icon renders correct SVG path

### Unit Tests — Layout Components

- **`AppShell.spec.tsx`** — renders sidebar + topbar + children, responsive behavior (mobile vs desktop)
- **`AuthenticatedLayout.spec.tsx`** — redirects to `/login` when unauthenticated, renders children when authenticated
- **`Sidebar.spec.tsx`** — nav items render correctly, active item is highlighted, collapse/expand on mobile
- **`Topbar.spec.tsx`** — user avatar display, theme toggle (light/dark), mobile menu button
- **`Footer.spec.tsx`** — renders links and copyright text

### Unit Tests — Stores (Zustand)

- **`auth.store.spec.ts`**
  - Login action: set user and token
  - Logout action: clear user and token
  - Token persistence to localStorage
  - Hydration from localStorage on app load

- **`ui.store.spec.ts`**
  - Theme toggle (light/dark)
  - Sidebar open/close state
  - Persistence to localStorage

### Unit Tests — Utilities

- **`auth.spec.ts`**
  - Token storage helpers (set, get, remove)
  - JWT decode (extract user ID, email, roles)
  - Expiry check (expired vs valid tokens)

- **`time-ago.spec.ts`**
  - Relative time formatting: seconds, minutes, hours, days, weeks, months, years ago
  - Edge cases: future dates, invalid dates

- **`constants.spec.ts`**
  - Nav items structure (label, href, icon)
  - Category config integrity (all categories have label and color)

### Page-Level Tests (mocked Apollo, testing full page components)

- **`login.spec.tsx`**
  - Form renders with email and password fields
  - Validation errors display (empty fields, invalid email)
  - Successful submit calls GraphQL mutation
  - Redirects to `/feed` on success
  - Displays error message on failed login

- **`register.spec.tsx`**
  - Form renders with all fields (name, email, password, confirm password)
  - Validation: password match, password strength, email format
  - Successful submit calls GraphQL mutation
  - Redirects to `/feed` on success
  - Displays error message on failed registration (e.g., email already exists)

- **`feed.spec.tsx`**
  - Renders announcements list with category badges
  - Renders Verse of the Day section
  - Category filtering works (click chip → filter list)
  - Loading skeleton displays while fetching
  - Empty state displays when no announcements

- **`friends.spec.tsx`**
  - Renders friends list with avatars and names
  - Renders pending friend requests section
  - Send friend request action calls mutation
  - Accept/reject friend request actions call mutations
  - Empty state displays when no friends

- **`groups.spec.tsx`**
  - Renders group cards with name, description, member count
  - Category filters work (click chip → filter groups)
  - Featured groups section renders
  - Create group button navigates to create page
  - Loading skeleton displays while fetching

- **`groups/[slug].spec.tsx`**
  - Renders group detail (name, description, cover image)
  - Renders member list with roles (OWNER, MEMBER)
  - Join group action calls mutation (for PUBLIC groups)
  - Leave group action calls mutation
  - Request to join action calls mutation (for PRIVATE groups)
  - Admin actions visible only to OWNER

- **`books.spec.tsx`**
  - Renders book cards with title, author, cover
  - Displays reading progress bar
  - Access badge displays (FREE vs RESTRICTED)
  - Click book card navigates to book detail
  - Loading skeleton displays while fetching

- **`chat.spec.tsx`**
  - Renders conversations list with last message preview
  - Click conversation loads message thread
  - Send message action calls mutation
  - Message thread displays in chronological order
  - Loading skeleton displays while fetching

---

## Shared Package Tests

### Zod Schema Validation Tests

- **`schemas/index.spec.ts`**
  - **Auth schemas:** valid/invalid email formats, password strength rules (min length, complexity), input sanitization
  - **User schemas:** required fields (email, displayName), display name length limits (min/max)
  - **Group schemas:** name required, slug format (lowercase, hyphens), visibility enum (PUBLIC/PRIVATE), category enum values
  - **Friend schemas:** valid user IDs (UUID format), status transitions (PENDING → ACCEPTED/REJECTED)
  - **Chat schemas:** message content length (min/max), conversation types (DIRECT/GROUP)
  - **Book schemas:** title required, page count (positive integer), access type enum (FREE/RESTRICTED)
  - **Feed schemas:** announcement status transitions (DRAFT → PUBLISHED → ARCHIVED), category enum (EVENT/UPDATE/GENERAL)
  - **Pagination schemas:** cursor format (base64 string), limit bounds (min 1, max 100)

### Enum and Constants Tests

- **`enums.spec.ts`**
  - Enum values are correct and complete
  - Constants have expected values:
    - JWT expiry times (access token: 15min, refresh token: 7 days)
    - Rate limits (requests per minute)
    - File size limits (PDF upload max size)

---

## E2E Tests (Playwright — Critical Paths Only)

### Test Flows

| Test File | Flow |
|-----------|------|
| **`auth.spec.ts`** | Register new user → verify redirect to `/feed` → logout → login with same credentials → verify redirect to `/feed` |
| **`groups.spec.ts`** | Login → navigate to `/groups` → create a new group → verify it appears in the list → navigate to group detail page |
| **`feed.spec.ts`** | Login → navigate to `/feed` → verify announcements render → verify Verse of the Day displays |

### E2E Setup

- **Playwright config:** `baseURL` pointing to local dev server (`http://localhost:3000`)
- **Global setup script:** Seeds the test database using existing `seed.ts` (creates test users, groups, announcements)
- **Test environment:** Full stack running locally:
  - Next.js frontend (`apps/web`)
  - NestJS API (`apps/api`)
  - Real PostgreSQL database (via Docker or testcontainers)

### E2E Test Conventions

- Use `page.locator()` with semantic selectors (role, text, test-id)
- Add `data-testid` attributes to critical UI elements for reliable selectors
- Each test is independent (no shared state between tests)
- Use `beforeEach` to reset database state or login fresh

---

## CI/CD Integration (GitHub Actions)

### Workflow: `test.yml`

**Triggers:** Every PR opened or updated (push to PR branch)

**Jobs:**

1. **Lint** — Run ESLint across all packages
2. **Unit Tests** — Run `pnpm test` (all packages, ~30s)
3. **Integration Tests** — Run `pnpm test:integration` (API only, ~2min)
4. **E2E Tests** — Start API + Web in Docker, run `pnpm test:e2e` (~3min)
5. **Coverage Report** — Upload coverage report as artifact, post summary as PR comment

**Pipeline:**

```
PR opened/updated
  ↓
Lint (parallel)
  ↓
Unit Tests (parallel with lint)
  ↓
Integration Tests (after unit tests pass)
  ↓
E2E Tests (after integration tests pass)
  ↓
Coverage Report (after all tests pass)
```

**Failure behavior:** Any test failure blocks the PR from merging.

---

## Coverage Thresholds

| Level | Target | Rationale |
|-------|--------|-----------|
| **API services** | 80% line coverage | Core business logic must be well-tested |
| **API resolvers** | 70% line coverage | Delegation layer, less critical |
| **API guards/strategies** | 90% line coverage | Security-critical code |
| **Web components** | 70% line coverage | Visual components, hard to test 100% |
| **Web stores** | 80% line coverage | State logic should be well-tested |
| **Web utilities** | 90% line coverage | Pure functions, easy to test thoroughly |
| **Shared schemas** | 95% line coverage | Validation is critical, small surface area |

**Enforcement:** Jest's `coverageThreshold` config fails CI if coverage drops below these targets.

---

## Test Conventions

### Naming

```typescript
describe('AuthService', () => {
  describe('register', () => {
    it('should hash password before saving user', () => { ... });
    it('should throw error if email already exists', () => { ... });
  });
});
```

### Setup

- Each test file has its own `beforeEach` to reset mocks and state
- Use `jest.clearAllMocks()` in `beforeEach` to prevent test interdependencies
- Integration tests use `beforeAll` to start testcontainers and `afterAll` to stop them

### Fixtures and Test Data

- Shared test data factories in `test/helpers/` per app:
  - `apps/api/test/helpers/create-mock-user.ts`
  - `apps/api/test/helpers/create-mock-group.ts`
  - `apps/web/test/helpers/render-with-providers.tsx` (wraps components in Apollo + Theme providers)

### Independence

- No shared mutable state between tests
- Each test sets up its own data and cleans up after itself
- Integration tests use database transactions that roll back after each test

### Mocking Strategy

- **Unit tests:** Mock all external dependencies (Prisma, Azure services, external APIs)
- **Integration tests:** Use real database, mock only external services (Azure Blob, Email)
- **E2E tests:** No mocks, use real services (seeded database)

---

## Dependencies to Install

### API (`apps/api/package.json`)

```json
{
  "devDependencies": {
    "@testcontainers/postgresql": "^10.0.0",
    "testcontainers": "^10.0.0"
  }
}
```

### Web (`apps/web/package.json`)

```json
{
  "devDependencies": {
    "@testing-library/react": "^16.0.0",
    "@testing-library/jest-dom": "^6.0.0",
    "@testing-library/user-event": "^14.0.0",
    "jest-environment-jsdom": "^29.7.0",
    "identity-obj-proxy": "^3.0.0"
  }
}
```

### Shared (`packages/shared/package.json`)

```json
{
  "devDependencies": {
    "jest": "^29.7.0",
    "ts-jest": "^29.2.0",
    "@types/jest": "^29.5.0"
  }
}
```

### E2E (`apps/web/package.json`)

```json
{
  "devDependencies": {
    "@playwright/test": "^1.45.0"
  }
}
```

---

## Success Criteria

- All unit tests pass in under 30 seconds
- All integration tests pass in under 2 minutes
- All E2E tests pass in under 3 minutes
- Coverage thresholds are met and enforced in CI
- CI pipeline blocks PRs with failing tests
- Developers can run tests locally with `pnpm test`, `pnpm test:integration`, `pnpm test:e2e`
- Test failures provide clear, actionable error messages

---

## Future Enhancements (Out of Scope for Now)

- **Visual regression testing:** Use Playwright screenshots to detect UI changes
- **Performance testing:** Load testing for GraphQL API (e.g., k6, Artillery)
- **Accessibility testing:** Automated a11y checks with `@axe-core/playwright`
- **Contract testing:** Verify API schema matches frontend expectations (e.g., Pact)
- **Mutation testing:** Verify test quality by introducing bugs and checking if tests catch them

---

## Conclusion

This testing strategy provides a comprehensive safety net for the Transformlit webapp, enabling confident shipping and fast feedback during development. The testing pyramid approach balances speed and realism, with unit tests for fast iteration, integration tests for database validation, and E2E tests for critical user journeys. CI/CD integration ensures tests run automatically on every PR, blocking merges when tests fail or coverage drops below thresholds.
