# Web Motion & Native Feel

## Single sources of truth

- **CSS tokens**: `styles/globals.css` inside `@theme` — `--duration-{instant,fast,normal,slow}`
  and `--ease-out-quint` / `--ease-spring-soft`, plus `--animate-fade-in` + `@keyframes fade-in`.
- **JS tokens/variants**: `lib/motion.ts` — `DURATION`, `EASE`, `springSoft`, `springSnappy`,
  `tweenOut`, and variants `fadeIn`, `slideUp`, `scaleIn`, `backdrop`, `sheetFrom(side)`,
  `toastVariants`, `pageEnter`, `staggerContainer`, `staggerItem`.
- Keep the two in sync when adding a duration/easing. Import from `'motion/react'` (motion v13).

## Hard constraints (violating these breaks the app)

- **Never put `transform` (or `will-change: transform`) on an ancestor of fixed-position
  content.** A transformed ancestor becomes the containing block for `position: fixed`
  descendants; several pages render fixed FABs (`fixed bottom-24 right-6` in feed/books).
  Route transitions are therefore **opacity-only** (`app/(app)/template.tsx`).
- **Avoid `will-change: opacity` on the route wrapper** — it permanently creates a stacking
  context, which would trap `z-[80]` overlays beneath the `z-50` topbar/nav. Animated
  `opacity` alone only creates one while below 1.
- Do not break the sticky `top-16` offsets used by page toolbars (`bible-reader-client`,
  `friends-client`).

## Where motion is applied

- Route enter: `app/(app)/template.tsx` (`template.tsx` remounts per navigation, unlike `layout`).
- Overlays: `components/ui/modal.tsx`, `sheet.tsx`, `toast.tsx` (all `AnimatePresence` + variants).
- Nav: `components/ui/nav-item.tsx` — active indicator uses `motion` `layoutId` so it slides
  between destinations (`bottom-nav-indicator` / `sidebar-nav-indicator`).
- Lists/grids: `components/ui/stagger.tsx` (`<Stagger>` + `<StaggerItem>`).
- Marketing/home: `components/home/{motion-reveal,move-system,hero,home-nav}.tsx`.

## Reduced motion

Every animated element must degrade via `useReducedMotion()`. `globals.css` also has a
`prefers-reduced-motion` rule forcing durations to 0.01ms. Never animate under reduced motion
without the guard.

## Testing animated code

`AnimatePresence` keeps exiting nodes mounted — assertions after a close/dismiss must
`await waitFor(...)`, and motion's exit is driven by rAF so jest fake timers never
complete it. Details + proven probes: `mem:testing-motion-in-jsdom`.

## Related

- Overlay semantics/stacking: `mem:web/overlays`
- Verifying motion visually: `mem:verification/browser-and-blindspots`
