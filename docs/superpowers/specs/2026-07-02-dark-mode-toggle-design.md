# Dark Mode Toggle — Design Spec

## Summary
Add a light/dark mode toggle button (sun/moon icons) to the sidebar's bottom section, using `next-themes` to control the theme class on `<html>`.

## Approach
**Approach 2: Dedicated `ThemeToggle` component.** A small, standalone client component that encapsulates the toggle logic. Placed into the sidebar's bottom nav alongside Settings and Help.

## Changes

### 1. New: `apps/web/src/components/ui/theme-toggle.tsx`
- Client component (`'use client'`)
- Uses `useTheme` from `next-themes`
- Shows a sun icon (`light_mode` material symbol) when in dark mode, moon icon (`dark_mode`) when in light mode
- On click, toggles between `'light'` and `'dark'`
- Accepts optional `className` for styling flexibility
- Styled consistently with the sidebar's Settings/Help links (same padding, text style, hover effects)

### 2. `apps/web/src/components/layout/sidebar.tsx`
- Import `ThemeToggle` from `../ui/theme-toggle`
- Replace or augment the bottom nav section: add `ThemeToggle` alongside Settings and Help links

### 3. No other files changed
- `next-themes` is already wired in `layout.tsx` with `attribute="class"`
- Global CSS already has `.dark` overrides
- Components already use `dark:` variants
- Zustand store's `theme` state is left untouched (not currently synced with next-themes)

## Acceptance Criteria
1. Clicking the toggle in the sidebar switches the app between light and dark mode
2. Sun icon visible in dark mode, moon icon visible in light mode
3. Style matches the existing Settings/Help links in the sidebar bottom section
4. The component is reusable and could be placed elsewhere
5. `next-themes` handles persistence via localStorage
