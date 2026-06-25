# 🎨 Transformlit Design System

Date: 2026-06-25 (revised — added dark mode tokens + mobile-first notes)

## 🧭 Brand Direction

Transformlit is warm, literary, and modern. The visual identity is anchored in the orange-and-ink logo, with a single secondary accent for depth. The UI should feel like a clean reading room: bright, warm paper tones in light mode, and a cozy ink-dark reading environment in dark mode. **Mobile-first** — all components designed for touch and small viewports first, then scaled up.

## 🎯 Color Tokens

### Light Mode

| Token | Hex | Usage |
|---|---|---|
| Brand Orange | `#F4A11C` | Primary CTAs, active states, highlights |
| Brand Orange Dark | `#D88710` | Hover/pressed states |
| Ink Black | `#111111` | Primary text, headings |
| Ink Soft | `#2A2A2A` | Secondary text, muted UI |
| Paper | `#FFF6E8` | Page backgrounds |
| Paper Warm | `#FFE8C7` | Card backgrounds, elevated surfaces |
| Accent Teal | `#1F7A6D` | Secondary emphasis, links, stats, tabs |
| Accent Teal Dark | `#165E55` | Hover/pressed accent states |

### Dark Mode

| Token | Hex | Usage |
|---|---|---|
| Surface Dark | `#1A1A1A` | Page background |
| Surface Raised | `#2C2C2C` | Cards, modals, elevated surfaces |
| Surface High | `#3E3E3E` | Input backgrounds, tooltips |
| Brand Orange | `#F4A11C` | Primary CTAs (same, pops on dark) |
| Brand Orange Dark | `#D88710` | Hover/pressed states |
| Ink White | `#F5F5F5` | Primary text in dark mode |
| Ink Dim | `#B0B0B0` | Secondary text in dark mode |
| Accent Teal | `#1F7A6D` | Links, emphasis |
| Accent Teal Light | `#3AAD99` | Brighter teal for dark backgrounds |

### Neutrals

| Token | Light | Dark |
|---|---|---|
| Gray 900 | `#1A1A1A` | `#F5F5F5` |
| Gray 800 | `#2C2C2C` | `#EAEAEA` |
| Gray 700 | `#3E3E3E` | `#D1D1D1` |
| Gray 600 | `#555555` | `#B0B0B0` |
| Gray 500 | `#6B6B6B` | `#8A8A8A` |
| Gray 400 | `#8A8A8A` | `#6B6B6B` |
| Gray 300 | `#B0B0B0` | `#555555` |
| Gray 200 | `#D1D1D1` | `#3E3E3E` |
| Gray 100 | `#EAEAEA` | `#2C2C2C` |
| Gray 050 | `#F5F5F5` | `#1A1A1A` |

### Feedback (same in both modes)

| Token | Hex | Usage |
|---|---|---|
| Success | `#1F7A6D` | Confirmations, completions |
| Warning | `#D88710` | Alerts, pending states |
| Error | `#B9382D` | Destructive actions, validation failures |
| Info | `#2E6FAD` | Informational banners |

## ✍️ Typography

Two-font system: a sharp, modern grotesk for UI and a readable serif for content blocks.

- **UI Sans**: "Space Grotesk", "Manrope", "Segoe UI", sans-serif
- **Reading Serif**: "Newsreader", "Literata", "Georgia", serif
- **Mono** (dev/admin): "JetBrains Mono", "SF Mono", monospace

### Type Scale

| Token | Size (px) | Line Height | Weight |
|---|---|---|---|
| Display | 40 | 1.1 | 700 |
| H1 | 32 | 1.2 | 700 |
| H2 | 26 | 1.3 | 600 |
| H3 | 22 | 1.3 | 600 |
| H4 | 18 | 1.4 | 600 |
| Body | 16 | 1.5 | 400 |
| Small | 14 | 1.5 | 400 |
| Micro | 12 | 1.4 | 400 |

**Mobile**: Body scales down to 15px on viewports < 375px via `clamp()`. Display reduces to 32px.

## 📏 Spacing Scale

`4, 8, 12, 16, 20, 24, 32, 40, 48, 64`

Mobile-first spacing: base spacing on 4px grid. Touch targets minimum 44×44px.

## ⭕ Radii

| Token | Value | Usage |
|---|---|---|
| Sm | 8px | Buttons, inputs, chips |
| Md | 12px | Cards, modals |
| Lg | 16px | Sheets, drawers |
| Xl | 20px | Full-screen overlays |

## 👥 Shadows

### Light Mode

| Token | Value |
|---|---|
| Soft | `0 2px 12px rgba(17, 17, 17, 0.08)` |
| Lift | `0 10px 30px rgba(17, 17, 17, 0.12)` |

### Dark Mode

| Token | Value |
|---|---|
| Soft | `0 2px 12px rgba(0, 0, 0, 0.4)` |
| Lift | `0 10px 30px rgba(0, 0, 0, 0.5)` |

## 🌈 Gradients & Backgrounds

### Light Mode

- **Paper Gradient**: `linear-gradient(180deg, #FFF6E8 0%, #FFE8C7 100%)`
- **Accent Wash**: `radial-gradient(60% 60% at 10% 10%, rgba(244, 161, 28, 0.18), rgba(244, 161, 28, 0) 60%)`

### Dark Mode

- **Surface Gradient**: `linear-gradient(180deg, #1A1A1A 0%, #2C2C2C 100%)`
- **Accent Wash**: `radial-gradient(60% 60% at 10% 10%, rgba(244, 161, 28, 0.12), rgba(244, 161, 28, 0) 60%)`

## 📐 Layout

### Mobile First

- **Public home**: Full-bleed hero with logo, CTA for login/register, warm gradient background. Stack vertically — image/illustration, headline, CTAs. No sidebar on mobile.
- **Authenticated shell**:
  - **Mobile (< 768px)**: Top bar with hamburger/horizontal nav. Sidebar becomes a bottom sheet / swipeable drawer.
  - **Tablet/Desktop (≥ 768px)**: Persistent left sidebar (240px fixed) + top bar beyond. Content area fills remaining width.
- **Left sidebar items**: Feed, Friends, Groups, Books.
- **Max content width**: 1200px for main feed/content area.

### Responsive Breakpoints (Tailwind v4 defaults)

| Breakpoint | Width | Typical layout |
|---|---|---|
| Default | < 640px | Single column, full-width |
| sm | ≥ 640px | Single column, padded |
| md | ≥ 768px | Sidebar visible (collapsed or expanded) |
| lg | ≥ 1024px | Sidebar expanded, two-column content |
| xl | ≥ 1280px | Max-width constrained |

## 🧩 Components (MVP)

### Button

- **Primary**: Orange fill (`brand`), black text in light / white text in dark, 2px solid ink border. 44px min height on mobile.
- **Secondary**: Transparent with orange border and orange text. Hover: orange fill.
- **Tertiary**: Text-only with underline on hover.
- **Destructive**: Error red background with white text. Confirm dialog before destructive actions.
- **Disabled**: Gray 200 background, Gray 400 text. No pointer events.

### Card

- **Light**: Paper background, ink border (`border ink/10`), soft shadow.
- **Dark**: Surface Raised background, border `rgba(255,255,255,0.06)`, soft shadow.
- Announcement card supports publish badge and expiry label.
- Book card shows cover image, title, author, genre, status badge.

### Inputs

- **Light**: White background, ink border, orange focus ring (`ring-2 ring-brand`), placeholder Gray 400.
- **Dark**: Surface High background, border `rgba(255,255,255,0.1)`, orange focus ring, placeholder Gray 500.
- **Error**: Border becomes Error color + subtle background tint.
- **Textarea**: Same tokens, resizable vertical.
- **Select**: Custom dropdown with paper/raised background.

### Top Bar

- **Light**: Ink text on paper background.
- **Dark**: Ink White text on Surface Dark background.
- Right area: user avatar, dropdown menu (profile, settings, logout).
- Mobile: hamburger icon left, logo center, user avatar right.

### Sidebar

- **Light**: Paper background with ink dividers (`border-ink/5`).
- **Dark**: Surface Raised with subtle dividers (`border-white/5`).
- Active item: orange highlight background + left accent bar (3px).
- Icons: 20px, Grayscale default, color on active.
- Items: 44px height for touch targets.

### Modal / Sheet

- Backdrop: `rgba(0, 0, 0, 0.5)` in light, `rgba(0, 0, 0, 0.7)` in dark.
- Content: Card styling (paper / surface raised).
- Close button: top-right corner, 44px touch target.
- Mobile: full-width bottom sheet with pull-to-dismiss indicator.

### Toast / Snackbar

- Fixed bottom-right on desktop, bottom-center on mobile.
- Auto-dismiss after 4s. Swipe to dismiss on mobile.
- Colors mapped to Feedback tokens.

## 🎬 Motion

| Interaction | Duration | Easing | Notes |
|---|---|---|---|
| Page transition | 220ms | ease-out | Fade + 12px upward translate |
| List stagger | 120ms per item | ease-out | 40ms gap between items |
| Hover/active | 120ms | ease-in-out | Color and shadow shift only |
| Sheet/drawer open | 250ms | ease-out | Slide up from bottom |
| Modal open | 200ms | ease-out | Scale(0.95 → 1) + fade |
| Loading skeleton | Indefinite | linear | Pulse animation, 1.5s cycle |
| Theme toggle | 300ms | ease-in-out | Crossfade between themes |

**Respect `prefers-reduced-motion`**: all animations disabled when user preference is set.

## 🎨 Tailwind v4 Token Mapping

```css
/* globals.css */
@layer base {
  :root {
    /* Light tokens */
    --color-brand: #F4A11C;
    --color-brand-dark: #D88710;
    --color-ink: #111111;
    --color-ink-soft: #2A2A2A;
    --color-paper: #FFF6E8;
    --color-paper-warm: #FFE8C7;
    --color-accent: #1F7A6D;
    --color-accent-dark: #165E55;
    --color-surface: #FFFFFF;
    --color-surface-raised: #FFF6E8;
    --color-surface-high: #FFFFFF;
    --color-border: rgba(17, 17, 17, 0.1);
  }

  .dark {
    /* Dark tokens */
    --color-ink: #F5F5F5;
    --color-ink-soft: #B0B0B0;
    --color-paper: #1A1A1A;
    --color-paper-warm: #2C2C2C;
    --color-accent: #1F7A6D;
    --color-accent-dark: #3AAD99;
    --color-surface: #1A1A1A;
    --color-surface-raised: #2C2C2C;
    --color-surface-high: #3E3E3E;
    --color-border: rgba(255, 255, 255, 0.08);
  }
}
```

```ts
// tailwind.config.ts (theme excerpt)
export default {
  theme: {
    extend: {
      colors: {
        brand: "var(--color-brand)",
        "brand-dark": "var(--color-brand-dark)",
        ink: "var(--color-ink)",
        "ink-soft": "var(--color-ink-soft)",
        paper: "var(--color-paper)",
        "paper-warm": "var(--color-paper-warm)",
        accent: "var(--color-accent)",
        "accent-dark": "var(--color-accent-dark)",
        surface: "var(--color-surface)",
        "surface-raised": "var(--color-surface-raised)",
        "surface-high": "var(--color-surface-high)",
        border: "var(--color-border)",
      },
      fontFamily: {
        sans: ["Space Grotesk", "Manrope", "Segoe UI", "sans-serif"],
        serif: ["Newsreader", "Literata", "Georgia", "serif"],
        mono: ["JetBrains Mono", "SF Mono", "monospace"],
      },
      boxShadow: {
        soft: "0 2px 12px rgba(17, 17, 17, 0.08)",
        lift: "0 10px 30px rgba(17, 17, 17, 0.12)",
        "soft-dark": "0 2px 12px rgba(0, 0, 0, 0.4)",
        "lift-dark": "0 10px 30px rgba(0, 0, 0, 0.5)",
      },
      borderRadius: {
        sm: "8px",
        md: "12px",
        lg: "16px",
        xl: "20px",
      },
    },
  },
};
```

## 📝 Usage Notes

- **Mobile-first**: Design at 375px first. Use `sm:`, `md:`, `lg:` breakpoints to layer complexity.
- **Touch targets**: Minimum 44×44px for all interactive elements. Buttons, nav items, form controls.
- **Dark mode**: Toggle via `next-themes`. Use `dark:` prefix in Tailwind for overrides. Prefer CSS variable approach — most components just work.
- **Prefer surface backgrounds** over pure white (light) or pure black (dark) to echo the reading theme.
- **Use teal accent sparingly** for secondary emphasis (links, stats, tabs).
- **Maintain strong contrast**: ink text over paper/surface backgrounds. Orange for primary actions only — never for decorative elements.
- **Typography hierarchy**: Display/H1 only on public hero. H2–H4 in authenticated pages. Body for all paragraph content. Micro for timestamps and metadata.

## ♿ Accessibility

- All interactive elements must pass WCAG 2.1 AA contrast (4.5:1 for text, 3:1 for large text / UI components).
- Focus rings: 2px orange outline on `:focus-visible` for all interactive elements.
- Form labels always visible (no placeholder-only inputs).
- Error messages associated with inputs via `aria-describedby`.
- Modal traps focus; Escape closes; backdrop click closes (configurable).
- Color is never the only indicator — pair status badges/errors with icons and text.
