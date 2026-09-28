# Web Components

## Where things live (`apps/web/src/`)

- `components/ui/` — the design-system + primitives. Barrel: `components/ui/index.ts` (import from `'../ui'`, not deep paths, unless a file isn't exported).
- `components/<feature>/` — feature-local components: `bible/`, `chat/`, `friends/`, `groups/`, `home/`, `layout/`, `notifications/`, `providers/`, `reader/`.
- `lib/` — non-React logic + hooks (`lib/bible/`, `lib/reader/`, `lib/hooks/`).
- `store/` — Zustand stores. `styles/globals.css` — the ONLY stylesheet (Tailwind v4 `@theme`, no `tailwind.config.js`).

## `components/ui/` inventory (what exists before you write anything)

Primitives: `button`, `input`, `text-input`, `card`, `modal`, `sheet`, `confirm-dialog`, `toast` (`ToastProvider`/`useToast`), `nav-item`, `stagger`, `loading-spinner`, `skeleton-card`, `user-avatar`, `user-menu`, `icons`.
Domain cards: `book-card` (+`BookCardSkeleton`), `friend-card`, `friend-request-item`, `suggested-friend-card`, `group-card`, `compact-group-card`, `featured-group-card`, `category-chip`, `reading-progress-card`, `notification-item`, `bell-icon`, `user-search-input`, `theme-toggle`.

## Overlay conventions (important)

- `Modal` — `{ open, onClose, title?, children }`. Native `<dialog>`; returns null when closed. Escape/backdrop/scroll-lock come from `mem:web/overlays` behaviour (`useOverlayDismiss`).
- `Sheet` — side drawer (`side: 'bottom' | 'right'`), same overlay semantics, used by the Bible study panel.
- `ConfirmDialog` — built ON `Modal`; use it for destructive/social-commitment confirms instead of hand-rolling.
- Overlay stack rules (Escape closes topmost only, scroll lock held until last closes) live in `lib/hooks/use-overlay-dismiss.ts`.

## Native `<dialog>` invariant — do not remove `open`

A native `<dialog>` without the `open` attribute computes to `display:none` and silently hides the whole overlay. SonarQube-driven refactors have already caused this regression once. jsdom does NOT apply UA dialog styles, so unit tests cannot catch it — guard it with an explicit `toHaveAttribute('open')` assertion. Full incident + guard: `mem:bible-strongs-popup-dialog-pitfall`.

## List/grid entrance animation

- Use `components/ui/stagger.tsx` (`<Stagger>` + `<StaggerItem>`) for list/grid entrances; it handles reduced-motion and tag selection (`as="ul"|"li"|"section"`).
- Positional classes (`col-span-*`) belong on `StaggerItem`, not the inner element, or grid placement breaks.
- Motion tokens/variants: `mem:web/motion`.

## Related

- Route → component mapping: `mem:web/routes`
- Data fetching (Apollo vs REST vs fetch): `mem:web/data-fetching`
