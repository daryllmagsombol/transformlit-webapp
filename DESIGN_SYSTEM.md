# Transformlit Design System (MVP)

Date: 2026-05-27

## Brand Direction

Transformlit is warm, literary, and modern. The visual identity is anchored in the orange-and-ink logo, with a single secondary accent for depth. The UI should feel like a clean reading room: bright, warm paper tones, strong black lines, and a subtle secondary hue for emphasis.

## Color Tokens

Primary colors are drawn from the logo. One secondary accent adds depth without overpowering the orange.

### Core Palette

- Brand Orange: #F4A11C
- Brand Orange Dark: #D88710
- Ink Black: #111111
- Ink Soft: #2A2A2A
- Paper: #FFF6E8
- Paper Warm: #FFE8C7
- Accent Teal: #1F7A6D
- Accent Teal Dark: #165E55

### Neutrals

- Gray 900: #1A1A1A
- Gray 800: #2C2C2C
- Gray 700: #3E3E3E
- Gray 600: #555555
- Gray 500: #6B6B6B
- Gray 400: #8A8A8A
- Gray 300: #B0B0B0
- Gray 200: #D1D1D1
- Gray 100: #EAEAEA
- Gray 050: #F5F5F5

### Feedback

- Success: #1F7A6D
- Warning: #D88710
- Error: #B9382D
- Info: #2E6FAD

## Typography

Two-font system: a sharp, modern grotesk for UI and a readable serif for content blocks.

- UI Sans: "Space Grotesk", "Manrope", "Segoe UI", sans-serif
- Reading Serif: "Newsreader", "Literata", "Georgia", serif
- Mono (dev/admin): "JetBrains Mono", "SF Mono", monospace

### Type Scale (px)

- Display: 40
- H1: 32
- H2: 26
- H3: 22
- H4: 18
- Body: 16
- Small: 14
- Micro: 12

## Spacing Scale (px)

4, 8, 12, 16, 20, 24, 32, 40, 48, 64

## Radii

- Sm: 8
- Md: 12
- Lg: 16
- Xl: 20

## Shadows

- Soft: 0 2px 12px rgba(17, 17, 17, 0.08)
- Lift: 0 10px 30px rgba(17, 17, 17, 0.12)

## Gradients and Backgrounds

Use warm paper gradients and subtle grid textures for depth.

- Paper Gradient: linear-gradient(180deg, #FFF6E8 0%, #FFE8C7 100%)
- Accent Wash: radial-gradient(60% 60% at 10% 10%, rgba(244, 161, 28, 0.18), rgba(244, 161, 28, 0) 60%)

## Layout

- Public home: full-bleed hero with logo, CTA for login/register, and warm gradient background.
- Logged-in home: announcements feed with a persistent left sidebar + top bar.
- Left sidebar items: Friends, Groups, Books (Documents).

## Components (MVP)

### Button

- Primary: orange fill, black text, 2px solid ink border.
- Secondary: transparent with orange border and orange text.
- Tertiary: text-only with underline on hover.

### Card

- Paper background, ink border, soft shadow.
- Announcement card supports publish badge and expiry label.

### Inputs

- White background, ink border, orange focus ring.
- Error state uses Error color + subtle background tint.

### Top Bar

- Ink text on paper background.
- Right area: user menu and notifications.

### Sidebar

- Paper background with ink dividers.
- Active item: orange highlight and left accent bar.

## Motion

- Page load: 220ms fade + 12px upward motion.
- List items: 120ms stagger, 40ms between items.
- Hover: 120ms color shift for buttons and nav items.

## Tailwind Token Mapping (starter)

```css
:root {
  --color-brand: #f4a11c;
  --color-brand-dark: #d88710;
  --color-ink: #111111;
  --color-ink-soft: #2a2a2a;
  --color-paper: #fff6e8;
  --color-paper-warm: #ffe8c7;
  --color-accent: #1f7a6d;
  --color-accent-dark: #165e55;
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
      },
      fontFamily: {
        sans: ["Space Grotesk", "Manrope", "Segoe UI", "sans-serif"],
        serif: ["Newsreader", "Literata", "Georgia", "serif"],
        mono: ["JetBrains Mono", "SF Mono", "monospace"],
      },
      boxShadow: {
        soft: "0 2px 12px rgba(17, 17, 17, 0.08)",
        lift: "0 10px 30px rgba(17, 17, 17, 0.12)",
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

## Usage Notes

- Prefer paper backgrounds over pure white to echo the reading theme.
- Use the teal accent sparingly for secondary emphasis (links, stats, tabs).
- Maintain strong contrast: ink text over paper, orange for primary actions.
