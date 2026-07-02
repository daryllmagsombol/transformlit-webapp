# Web Unit Tests — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write comprehensive unit tests for the Next.js web app — UI components, layout components, Zustand stores, utilities, and page-level tests — to achieve 70% component coverage, 80% store coverage, and 90% utility coverage.

**Architecture:** All tests use Jest with jsdom environment and @testing-library/react. Components are tested with `renderWithProviders()` helper (wraps in Apollo MockedProvider + ThemeProvider). Stores are tested directly. Utilities are tested as pure functions. Pages are tested with mocked Apollo queries/mutations.

**Tech Stack:** Jest 29, ts-jest, @testing-library/react, @testing-library/jest-dom, @testing-library/user-event, jest-environment-jsdom

## Global Constraints

- Use Jest (not Vitest) for all tests
- All test files use `*.spec.ts` / `*.spec.tsx` naming convention
- Unit tests co-located with source files in `src/`
- jsdom environment for all web tests
- CSS/Tailwind mocked with identity-obj-proxy
- Coverage thresholds: components 70%, stores 80%, utilities 90%
- Use `renderWithProviders()` from `test/helpers/render-with-providers.tsx` for component tests
- Mock Next.js navigation (`next/navigation`) in page tests
- Mock Apollo Client for GraphQL queries/mutations

---

## File Structure

### New Test Files

| File | Responsibility |
|------|---------------|
| `src/components/ui/button.spec.tsx` | Button: variants, loading, disabled, click |
| `src/components/ui/input.spec.tsx` | Input: label, error, aria attributes |
| `src/components/ui/text-input.spec.tsx` | TextInput: label, error, hint, icon, rightElement |
| `src/components/ui/card.spec.tsx` | Card: renders children, className |
| `src/components/ui/modal.spec.tsx` | Modal: open/close, backdrop, escape, title |
| `src/components/ui/toast.spec.tsx` | Toast: addToast, auto-dismiss, types |
| `src/components/ui/nav-item.spec.tsx` | NavItem: label, href, icon, active, variants |
| `src/components/ui/user-avatar.spec.tsx` | UserAvatar: image, fallback initials, sizes |
| `src/components/ui/skeleton-card.spec.tsx` | SkeletonCard: renders skeleton structure |
| `src/components/ui/group-card.spec.tsx` | GroupCard: data display, click navigation |
| `src/components/ui/featured-group-card.spec.tsx` | FeaturedGroupCard: featured badge, data display |
| `src/components/ui/compact-group-card.spec.tsx` | CompactGroupCard: compact layout, data display |
| `src/components/ui/book-card.spec.tsx` | BookCard: book info, progress, access badge |
| `src/components/ui/reading-progress-card.spec.tsx` | ReadingProgressCard: progress percentage |
| `src/components/ui/category-chip.spec.tsx` | CategoryChip: label, active, click |
| `src/components/ui/icons.spec.tsx` | Icons: each icon renders SVG |
| `src/components/layout/app-shell.spec.tsx` | AppShell: sidebar + topbar + children |
| `src/components/layout/authenticated-layout.spec.tsx` | AuthenticatedLayout: auth check, redirect |
| `src/components/layout/sidebar.spec.tsx` | Sidebar: nav items, active, collapse |
| `src/components/layout/topbar.spec.tsx` | Topbar: user avatar, theme toggle |
| `src/components/layout/footer.spec.tsx` | Footer: links, copyright |
| `src/store/auth.spec.ts` | Auth store: login, logout, persistence |
| `src/store/ui.spec.ts` | UI store: theme, sidebar |
| `src/lib/auth.spec.ts` | Token storage, JWT decode, expiry check |
| `src/lib/time-ago.spec.ts` | Relative time formatting |
| `src/lib/constants.spec.ts` | Nav items, category config |
| `src/app/login/login.spec.tsx` | Login page: form, validation, submit |
| `src/app/register/register.spec.tsx` | Register page: form, validation, submit |
| `src/app/feed/feed.spec.tsx` | Feed page: announcements, verse of day |
| `src/app/friends/friends.spec.tsx` | Friends page: list, requests, actions |
| `src/app/groups/groups.spec.tsx` | Groups page: cards, filters, featured |
| `src/app/groups/[slug]/page.spec.tsx` | Group detail: info, members, join/leave |
| `src/app/books/books.spec.tsx` | Books page: cards, progress, access |
| `src/app/chat/chat.spec.tsx` | Chat page: conversations, messages, send |

---

### Task 1: UI Components — Button, Input, TextInput, Card

**Files:**
- Test: `apps/web/src/components/ui/button.spec.tsx`
- Test: `apps/web/src/components/ui/input.spec.tsx`
- Test: `apps/web/src/components/ui/text-input.spec.tsx`
- Test: `apps/web/src/components/ui/card.spec.tsx`

- [ ] **Step 1: Write Button tests**

Test: variants (primary, secondary, ghost, destructive), loading state (spinner + disabled), disabled state, click handler, forwardRef

- [ ] **Step 2: Write Input tests**

Test: label rendering, error message with role="alert", aria-invalid, aria-describedby, forwardRef

- [ ] **Step 3: Write TextInput tests**

Test: label, error (hides hint), hint, icon (left padding), rightElement (right padding), aria attributes

- [ ] **Step 4: Write Card tests**

Test: renders children, applies className, forwardRef

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @transformlit/web test -- button.spec input.spec text-input.spec card.spec`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/ui/button.spec.tsx apps/web/src/components/ui/input.spec.tsx apps/web/src/components/ui/text-input.spec.tsx apps/web/src/components/ui/card.spec.tsx
git commit -m "test: add Button, Input, TextInput, Card unit tests"
```

---

### Task 2: UI Components — Modal, Toast

**Files:**
- Test: `apps/web/src/components/ui/modal.spec.tsx`
- Test: `apps/web/src/components/ui/toast.spec.tsx`

- [ ] **Step 1: Write Modal tests**

Test: renders null when closed, renders dialog when open, backdrop click calls onClose, Escape key calls onClose, title rendering, close button, aria-modal, body overflow hidden

- [ ] **Step 2: Write Toast tests**

Test: ToastProvider renders children, useToast hook works, addToast creates toast, auto-dismiss after 4000ms, dismiss button, toast types (success, error, info) with correct colors

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @transformlit/web test -- modal.spec toast.spec`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/ui/modal.spec.tsx apps/web/src/components/ui/toast.spec.tsx
git commit -m "test: add Modal and Toast unit tests"
```

---

### Task 3: UI Components — NavItem, UserAvatar, SkeletonCard

**Files:**
- Test: `apps/web/src/components/ui/nav-item.spec.tsx`
- Test: `apps/web/src/components/ui/user-avatar.spec.tsx`
- Test: `apps/web/src/components/ui/skeleton-card.spec.tsx`

- [ ] **Step 1: Write NavItem tests**

Test: label, href (Next.js Link), icon (Material Symbols), active state (filled icon, border-left), sidebar variant, bottom variant

- [ ] **Step 2: Write UserAvatar tests**

Test: image rendering when avatarUrl provided, fallback to first character of displayName, fallback to 'U' when no displayName, sm size, md size

- [ ] **Step 3: Write SkeletonCard tests**

Test: renders skeleton structure with animate-pulse

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @transformlit/web test -- nav-item.spec user-avatar.spec skeleton-card.spec`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ui/nav-item.spec.tsx apps/web/src/components/ui/user-avatar.spec.tsx apps/web/src/components/ui/skeleton-card.spec.tsx
git commit -m "test: add NavItem, UserAvatar, SkeletonCard unit tests"
```

---

### Task 4: UI Components — GroupCard, FeaturedGroupCard, CompactGroupCard

**Files:**
- Test: `apps/web/src/components/ui/group-card.spec.tsx`
- Test: `apps/web/src/components/ui/featured-group-card.spec.tsx`
- Test: `apps/web/src/components/ui/compact-group-card.spec.tsx`

- [ ] **Step 1: Write GroupCard tests**

Test: name, description, member count, visibility badge, category, click navigation (Link)

- [ ] **Step 2: Write FeaturedGroupCard tests**

Test: featured badge, name, description, member count, cover image, click navigation

- [ ] **Step 3: Write CompactGroupCard tests**

Test: name, member count, compact layout, click navigation

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @transformlit/web test -- group-card.spec featured-group-card.spec compact-group-card.spec`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ui/group-card.spec.tsx apps/web/src/components/ui/featured-group-card.spec.tsx apps/web/src/components/ui/compact-group-card.spec.tsx
git commit -m "test: add GroupCard, FeaturedGroupCard, CompactGroupCard unit tests"
```

---

### Task 5: UI Components — BookCard, ReadingProgressCard, CategoryChip, Icons

**Files:**
- Test: `apps/web/src/components/ui/book-card.spec.tsx`
- Test: `apps/web/src/components/ui/reading-progress-card.spec.tsx`
- Test: `apps/web/src/components/ui/category-chip.spec.tsx`
- Test: `apps/web/src/components/ui/icons.spec.tsx`

- [ ] **Step 1: Write BookCard tests**

Test: title, author, cover image, progress bar (if progress provided), access badge (FREE/RESTRICTED), click navigation

- [ ] **Step 2: Write ReadingProgressCard tests**

Test: book title, progress percentage calculation, current page display

- [ ] **Step 3: Write CategoryChip tests**

Test: label rendering, active state styling, click handler

- [ ] **Step 4: Write Icons tests**

Test: each icon renders SVG with correct path

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @transformlit/web test -- book-card.spec reading-progress-card.spec category-chip.spec icons.spec`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/ui/book-card.spec.tsx apps/web/src/components/ui/reading-progress-card.spec.tsx apps/web/src/components/ui/category-chip.spec.tsx apps/web/src/components/ui/icons.spec.tsx
git commit -m "test: add BookCard, ReadingProgressCard, CategoryChip, Icons unit tests"
```

---

### Task 6: Layout Components

**Files:**
- Test: `apps/web/src/components/layout/app-shell.spec.tsx`
- Test: `apps/web/src/components/layout/authenticated-layout.spec.tsx`
- Test: `apps/web/src/components/layout/sidebar.spec.tsx`
- Test: `apps/web/src/components/layout/topbar.spec.tsx`
- Test: `apps/web/src/components/layout/footer.spec.tsx`

- [ ] **Step 1: Write AppShell tests**

Test: renders Sidebar + Topbar + children, responsive layout

- [ ] **Step 2: Write AuthenticatedLayout tests**

Test: redirects to /login when unauthenticated, renders children when authenticated

- [ ] **Step 3: Write Sidebar tests**

Test: nav items render, active item highlighted, collapse/expand on mobile

- [ ] **Step 4: Write Topbar tests**

Test: user avatar display, theme toggle button, mobile menu button

- [ ] **Step 5: Write Footer tests**

Test: renders links and copyright text

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @transformlit/web test -- app-shell.spec authenticated-layout.spec sidebar.spec topbar.spec footer.spec`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/layout/*.spec.tsx
git commit -m "test: add layout component unit tests"
```

---

### Task 7: Zustand Stores

**Files:**
- Test: `apps/web/src/store/auth.spec.ts`
- Test: `apps/web/src/store/ui.spec.ts`

- [ ] **Step 1: Write auth store tests**

Test: initial state, login action (set user + token), logout action (clear user + token), token persistence to localStorage, hydration from localStorage

- [ ] **Step 2: Write ui store tests**

Test: initial state, theme toggle (light/dark), sidebar open/close, persistence to localStorage

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @transformlit/web test -- store/auth.spec store/ui.spec`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/store/auth.spec.ts apps/web/src/store/ui.spec.ts
git commit -m "test: add Zustand store unit tests"
```

---

### Task 8: Utilities

**Files:**
- Test: `apps/web/src/lib/auth.spec.ts`
- Test: `apps/web/src/lib/time-ago.spec.ts`
- Test: `apps/web/src/lib/constants.spec.ts`

- [ ] **Step 1: Write auth utility tests**

Test: setToken/getToken/removeToken (localStorage), decodeJWT (extract user ID, email, roles), isTokenExpired (expired vs valid tokens)

- [ ] **Step 2: Write time-ago tests**

Test: seconds ago, minutes ago, hours ago, days ago, weeks ago, months ago, years ago, edge cases (future dates, invalid dates)

- [ ] **Step 3: Write constants tests**

Test: nav items structure (label, href, icon), category config integrity (all categories have label and color)

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @transformlit/web test -- lib/auth.spec lib/time-ago.spec lib/constants.spec`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/auth.spec.ts apps/web/src/lib/time-ago.spec.ts apps/web/src/lib/constants.spec.ts
git commit -m "test: add utility function unit tests"
```

---

### Task 9: Pages — Login, Register

**Files:**
- Test: `apps/web/src/app/login/login.spec.tsx`
- Test: `apps/web/src/app/register/register.spec.tsx`

- [ ] **Step 1: Write login page tests**

Test: form renders with email and password fields, validation errors (empty fields, invalid email), successful submit calls GraphQL mutation, redirects to /feed on success, displays error message on failed login

- [ ] **Step 2: Write register page tests**

Test: form renders with all fields, validation (password match, password strength, email format), successful submit calls mutation, redirects to /feed on success, displays error on failure

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @transformlit/web test -- login.spec register.spec`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/login/login.spec.tsx apps/web/src/app/register/register.spec.tsx
git commit -m "test: add login and register page unit tests"
```

---

### Task 10: Pages — Feed, Friends

**Files:**
- Test: `apps/web/src/app/feed/feed.spec.tsx`
- Test: `apps/web/src/app/friends/friends.spec.tsx`

- [ ] **Step 1: Write feed page tests**

Test: renders announcements list with category badges, renders Verse of the Day section, category filtering, loading skeleton, empty state

- [ ] **Step 2: Write friends page tests**

Test: renders friends list with avatars, renders pending requests section, send/accept/reject actions call mutations, empty state

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @transformlit/web test -- feed.spec friends.spec`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/feed/feed.spec.tsx apps/web/src/app/friends/friends.spec.tsx
git commit -m "test: add feed and friends page unit tests"
```

---

### Task 11: Pages — Groups, Group Detail

**Files:**
- Test: `apps/web/src/app/groups/groups.spec.tsx`
- Test: `apps/web/src/app/groups/[slug]/page.spec.tsx`

- [ ] **Step 1: Write groups page tests**

Test: renders group cards, category filters, featured groups section, create group button, loading skeleton

- [ ] **Step 2: Write group detail page tests**

Test: renders group info (name, description, cover), renders member list with roles, join/leave/request actions, admin actions visible only to OWNER

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @transformlit/web test -- groups.spec groups/\\[slug\\]/page.spec`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/groups/groups.spec.tsx "apps/web/src/app/groups/[slug]/page.spec.tsx"
git commit -m "test: add groups and group detail page unit tests"
```

---

### Task 12: Pages — Books, Chat

**Files:**
- Test: `apps/web/src/app/books/books.spec.tsx`
- Test: `apps/web/src/app/chat/chat.spec.tsx`

- [ ] **Step 1: Write books page tests**

Test: renders book cards with title/author/cover, displays reading progress bar, access badge (FREE/RESTRICTED), click navigation, loading skeleton

- [ ] **Step 2: Write chat page tests**

Test: renders conversations list, click conversation loads message thread, send message action, chronological order, loading skeleton

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @transformlit/web test -- books.spec chat.spec`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/books/books.spec.tsx apps/web/src/app/chat/chat.spec.tsx
git commit -m "test: add books and chat page unit tests"
```

---

### Task 13: Coverage Configuration + Final Verification

**Files:**
- Modify: `apps/web/jest.config.ts`

- [ ] **Step 1: Add coverage thresholds to jest.config.ts**

Update `apps/web/jest.config.ts` to add coverage thresholds:

```typescript
coverageThreshold: {
  global: {
    lines: 70,
    branches: 60,
    functions: 70,
    statements: 70,
  },
},
```

- [ ] **Step 2: Run full test suite with coverage**

Run: `pnpm --filter @transformlit/web test:cov`
Expected: All tests pass, coverage meets thresholds

- [ ] **Step 3: Run monorepo-wide tests**

Run: `pnpm test`
Expected: All packages pass (shared 127 tests, api 313 tests, web all tests)

- [ ] **Step 4: Commit**

```bash
git add apps/web/jest.config.ts
git commit -m "chore: add web coverage thresholds and verify all tests pass"
```

---

## Summary

This plan produces **34 test files** covering:
- 16 UI component test files
- 5 layout component test files
- 2 store test files
- 3 utility test files
- 8 page test files

Expected test count: **200-300 tests** across all files.

Coverage targets:
- Components: 70%+
- Stores: 80%+
- Utilities: 90%+
