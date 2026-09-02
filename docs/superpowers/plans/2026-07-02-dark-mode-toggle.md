# Dark Mode Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan.

**Goal:** Add a light/dark mode toggle button (sun/moon icons) to the sidebar's bottom section using `next-themes`.

**Architecture:** A small, standalone `ThemeToggle` client component that uses `useTheme` from `next-themes` to toggle between `'light'` and `'dark'`. Placed in the sidebar's bottom nav alongside Settings and Help.

**Tech Stack:** Next.js, Tailwind CSS v4, next-themes, Material Symbols (icon font), Jest + React Testing Library

## Global Constraints

- All new components must be `'use client'` since they use hooks
- Use Material Symbols icon font (already used throughout the app) — `light_mode` for sun, `dark_mode` for moon
- Match existing sidebar bottom nav styling: same padding, text size, hover effects as Settings/Help links
- Toggle must not interfere with `ThemeProvider` attribute="class" setup already in layout.tsx

---

### Task 1: Create ThemeToggle component

**Files:**
- Create: `apps/web/src/components/ui/theme-toggle.tsx`
- Test: `apps/web/src/components/ui/theme-toggle.spec.tsx`

**Interfaces:**
- Produces: `ThemeToggle` — a component accepting `{ className?: string }`

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeToggle } from './theme-toggle';

// Mock next-themes useTheme
const mockSetTheme = jest.fn();
let mockTheme = 'light';

jest.mock('next-themes', () => ({
  useTheme: () => ({
    theme: mockTheme,
    setTheme: mockSetTheme,
    resolvedTheme: mockTheme,
  }),
}));

describe('ThemeToggle', () => {
  beforeEach(() => {
    mockTheme = 'light';
    mockSetTheme.mockClear();
  });

  it('renders a toggle button', () => {
    render(<ThemeToggle />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('shows moon icon (dark_mode) when in light mode', () => {
    render(<ThemeToggle />);
    expect(screen.getByText('dark_mode')).toBeInTheDocument();
  });

  it('shows sun icon (light_mode) when in dark mode', () => {
    mockTheme = 'dark';
    render(<ThemeToggle />);
    expect(screen.getByText('light_mode')).toBeInTheDocument();
  });

  it('toggles to dark when clicked in light mode', () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole('button'));
    expect(mockSetTheme).toHaveBeenCalledWith('dark');
  });

  it('toggles to light when clicked in dark mode', () => {
    mockTheme = 'dark';
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole('button'));
    expect(mockSetTheme).toHaveBeenCalledWith('light');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest apps/web/src/components/ui/theme-toggle.spec.tsx --no-coverage`
Expected: FAIL — "Cannot find module './theme-toggle' or its corresponding type declarations"

- [ ] **Step 3: Write minimal implementation**

```tsx
'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

type ThemeToggleProps = {
  className?: string;
};

export function ThemeToggle({ className = '' }: ThemeToggleProps) {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Avoid hydration mismatch: only render after mount
  useEffect(() => { setMounted(true); }, []);

  if (!mounted) {
    // Render a placeholder with same dimensions to prevent layout shift
    return <div className={`flex items-center gap-3 px-4 py-2 ${className}`}><span className="material-symbols-outlined text-lg">dark_mode</span></div>;
  }

  const isDark = (theme === 'dark') || (theme === 'system' && resolvedTheme === 'dark');

  return (
    <button
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className={`flex items-center gap-3 px-4 py-2 text-on-surface-variant hover:bg-surface-container-highest transition-all text-micro uppercase tracking-wider w-full text-left ${className}`}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      <span className="material-symbols-outlined text-lg">
        {isDark ? 'light_mode' : 'dark_mode'}
      </span>
      {isDark ? 'Light Mode' : 'Dark Mode'}
    </button>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest apps/web/src/components/ui/theme-toggle.spec.tsx --no-coverage`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ui/theme-toggle.tsx apps/web/src/components/ui/theme-toggle.spec.tsx
git commit -m "feat: add ThemeToggle component for dark/light mode"
```

---

### Task 2: Add ThemeToggle to sidebar

**Files:**
- Modify: `apps/web/src/components/layout/sidebar.tsx`
- Modify: `apps/web/src/components/layout/sidebar.spec.tsx`

**Interfaces:**
- Consumes: `ThemeToggle` from `../ui/theme-toggle`
- Produces: Updated sidebar with toggle in bottom nav section

- [ ] **Step 1: Update sidebar.tsx to import and render ThemeToggle**

Add import at top of file:
```tsx
import { ThemeToggle } from '../ui/theme-toggle';
```

Add `<ThemeToggle />` in the bottom nav section, between Help link and the closing `</div>`:

```tsx
        {/* Bottom nav */}
        <div className="border-t border-outline-variant p-4 flex flex-col gap-1">
          <Link
            href="/settings"
            className="flex items-center gap-3 px-4 py-2 text-on-surface-variant hover:bg-surface-container-highest transition-all text-micro uppercase tracking-wider"
          >
            <span className="material-symbols-outlined text-lg">settings</span>
            Settings
          </Link>
          <Link
            href="/help"
            className="flex items-center gap-3 px-4 py-2 text-on-surface-variant hover:bg-surface-container-highest transition-all text-micro uppercase tracking-wider"
          >
            <span className="material-symbols-outlined text-lg">help</span>
            Help
          </Link>
          <ThemeToggle />
        </div>
```

- [ ] **Step 2: Update sidebar.spec.tsx to add toggle test**

Add this describe block to the "bottom nav" section in `sidebar.spec.tsx`:

```tsx
  it('renders theme toggle button', () => {
    render(<Sidebar />);
    expect(screen.getByRole('button', { name: /switch/i })).toBeInTheDocument();
  });
```

- [ ] **Step 3: Run tests to verify**

Run: `npx jest apps/web/src/components/layout/sidebar.spec.tsx apps/web/src/components/ui/theme-toggle.spec.tsx --no-coverage`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/layout/sidebar.tsx apps/web/src/components/layout/sidebar.spec.tsx
git commit -m "feat: add dark mode toggle to sidebar"
```

---

### Verification

- [ ] Run full test suite: `npx jest apps/web --no-coverage`
- [ ] Start dev server and verify: sun icon in dark mode, moon in light mode, toggle works

---

### Task 3: Refactor feed page to use shared Sidebar

**Files:**
- Modify: `apps/web/src/app/feed/feed-client.tsx`
- Modify: `apps/web/src/app/feed/feed.spec.tsx`

- [ ] Import `Sidebar` from `../../components/layout/sidebar` instead of inline sidebar code
- [ ] Remove duplicate sidebar markup (~46 lines) and replace with `<Sidebar />`
- [ ] Mock `Sidebar` component in `feed.spec.tsx`
- [ ] Remove unused `SIDEBAR_NAV_ITEMS` import
- [ ] Commit

---

### Task 4: Desktop hamburger sidebar toggle with animation

**Files:**
- Modify: `apps/web/src/components/layout/topbar.tsx`
- Modify: `apps/web/src/components/layout/sidebar.tsx`
- Modify: `apps/web/src/components/layout/app-shell.tsx`
- Modify: `apps/web/src/app/feed/feed-client.tsx`
- Modify: `apps/web/src/components/layout/app-shell.spec.tsx`

- [ ] **TopBar**: Remove `md:hidden` from hamburger, change `border-b` to `shadow-sm`, `md:px-6` to `md:px-5`
- [ ] **Sidebar**: Remove `md:translate-x-0`, use conditional classes based on `sidebarOpen`
- [ ] **AppShell**: Import `useUIStore`, make `md:pl-[240px]` conditional, add `transition-all duration-200`
- [ ] **Feed**: Add `useUIStore`, make hamburger a `<button>` with `onClick`, animate main content padding
- [ ] Update `app-shell.spec.tsx` to match new class values
- [ ] Add `useUIStore` mock to `feed.spec.tsx`
- [ ] Commit

---

### Task 5: Fix dark mode CSS issues

**Files:**
- Modify: `apps/web/src/styles/globals.css`

- [ ] Change `.paper-texture` hardcoded `#fff8f4` to `var(--color-background)`
- [ ] Add `.dark .paper-texture` with dark-appropriate texture URL
- [ ] Add `--color-surface-variant: #3E3E3E` to `.dark` overrides
- [ ] Add `--color-on-background: #f5f5f5` to `.dark` overrides
- [ ] Add `--color-outline: #a0907e` to `.dark` overrides
- [ ] Commit

---

### Verification (final)

- [ ] Run full test suite: 401/401 passing

---

## Code Organization Refactor (2026-07-02)

After the dark mode feature landed, applied DRY/separation-of-concerns review:

**Phase 1: Extract `LoadingSpinner`**
- Created `apps/web/src/components/ui/loading-spinner.tsx` (6 tests)
- Replaced 4 duplicate spinner JSX blocks (feed, books, groups, auth-redirect)

**Phase 2: Extract `useRequireAuth` hook**
- Created `apps/web/src/lib/hooks/use-require-auth.ts` (6 tests)
- Replaced 3 duplicate auth-guard blocks (feed, books, groups)
- Hook handles: hydration check, token check, redirect to /login
- Returns `{ isReady: boolean }` — component renders `<LoadingSpinner />` when false

**Phase 3: Replace inline feed topbar with shared `TopBar`**
- Removed 21-line inline `<header>` block in `feed/feed-client.tsx`
- Replaced with `<TopBar />` import (already in layout/index.ts)

**Phase 4: Dead code removal**
- Removed unreachable `if (!token) return null;` in books/groups (already covered by `!isReady` guard)
- Removed unused imports: `useRouter`, `useAuthStore`, `Link`, `UserAvatar`, `toggleSidebar`, `user`

**Test results:** 416/416 passing (up from 410)
- 6 new `LoadingSpinner` tests
- 6 new `useRequireAuth` tests
- Net: cleaner 3 client files (each shrunk ~15-20 lines)
- Single source of truth for spinner styling and auth-redirect logic
