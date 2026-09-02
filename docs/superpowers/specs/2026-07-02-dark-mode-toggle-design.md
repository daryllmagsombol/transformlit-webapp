# Dark Mode Toggle — Design Spec

## Summary
Add a light/dark mode toggle button (sun/moon icons) to the sidebar's bottom section, using `next-themes` to control the theme class on `<html>`. Includes sidebar toggle on desktop via hamburger, layout consistency fixes, and dark mode CSS polish.

## Changes

### 1. New: `apps/web/src/components/ui/theme-toggle.tsx`
- Client component (`'use client'`)
- Uses `useTheme` from `next-themes`
- Shows a sun icon (`light_mode`) when in dark mode, moon icon (`dark_mode`) when in light mode
- On click, toggles between `'light'` and `'dark'`
- Handles system theme preference via `resolvedTheme`
- Hydration-safe mounting pattern

### 2. `apps/web/src/components/layout/sidebar.tsx`
- Imported `ThemeToggle`, added to bottom nav after Help
- Removed `md:translate-x-0` so sidebar responds to `sidebarOpen` on all screen sizes (desktop toggle)

### 3. `apps/web/src/components/layout/topbar.tsx`
- Removed `md:hidden` from hamburger button so it's always visible
- Changed `border-b` to `shadow-sm`, `md:px-6` to `md:px-5` for consistency with feed page

### 4. `apps/web/src/components/layout/app-shell.tsx`
- Main content `md:pl-[240px]` is now conditional on `sidebarOpen` (slides with sidebar)
- Added `transition-all duration-200 ease-out` for smooth animation
- Updated padding to `pt-20` and `md:px-5` to match feed page

### 5. `apps/web/src/app/feed/feed-client.tsx`
- Replaced inline sidebar duplicate (46 lines) with shared `<Sidebar />` component
- Added `useUIStore` for `sidebarOpen`/`toggleSidebar`
- Made hamburger a proper `<button>` with `onClick`
- Main content padding animates with sidebar

### 6. `apps/web/src/styles/globals.css`
- `.paper-texture`: changed hardcoded `#fff8f4` to `var(--color-background)`, added dark variant with appropriate texture
- Added missing dark mode overrides for `--color-surface-variant`, `--color-on-background`, `--color-outline`

## Acceptance Criteria
1. Clicking the toggle in the sidebar switches the app between light and dark mode
2. Sun icon visible in dark mode, moon icon visible in light mode
3. Hamburger button toggles sidebar on all screen sizes with smooth animation
4. All pages use consistent padding: `pt-20`, `px-4 md:px-5`
5. Dark mode has no light-colored holdouts — paper texture, surface variant, outlines, and background text all adapt
