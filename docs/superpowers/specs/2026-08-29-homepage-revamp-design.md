# Transform Lit Homepage Revamp — Design Spec

Date: 2026-08-29
Status: Draft for review

## 1. Context

Transform Lit is a non-stock, non-profit Christian discipleship organization. Its
purpose: reach and prepare the next generation through servant-leadership trainings,
moral-recovery-centered literature publication, and mental-health empowerment through
life coaching and community groups. It partners with churches, church leaders, and
para-church organizations to mold "transformed followers who raise transformed
followers" through self-published books, curriculums, and systems. Donations support
operational and self-publication funds.

### Current state

- `apps/web` is a **Next.js 16 (App Router) + React 19 + Tailwind v4** app. Design
  tokens live in `apps/web/src/styles/globals.css` (`@theme`), mirroring the
  Transform Lit design system used in Stitch (warm paper palette, Space
  Grotesk / Newsreader / Manrope / JetBrains Mono, brand orange `#F4A11C`).
- The current `apps/web/src/app/page.tsx` is a minimal placeholder: an
  `AuthRedirect`-wrapped screen with "Get Started" / "Login" buttons. There is no
  real homepage.
- The old static `transformlit.com` is informational: nav (Home, About Us, Our
  Books, Partners, Contact), a "MOVE DISCIPLESHIP SYSTEM" hero, the 4-book journey
  (Usbong, Usad, Unlad, Ugnay), an announcements image, and a footer with contact
  details. No CTAs beyond navigation.
- The Stitch project "TransformLit Community Hub" contains the app screens
  (Feed, Login, Register, Friends, Groups, Books, Messages, etc.) and a design
  system matching the web tokens.

### Goals

1. Replace the placeholder homepage with a full marketing homepage that tells the
   Transform Lit story and communicates the MOVE Discipleship System.
2. Primary audience: **churches and church leaders** — the hero and primary CTA
   drive partnership ("Partner With Us").
3. Secondary audience: individuals — a "Join the Community" gateway into the
   Transform Lit Community Hub app (register/login).
4. Match the existing Transform Lit design system (warm editorial direction).

### Non-goals

- No new backend functionality. The homepage is static marketing content.
- No new pages beyond the homepage (About, Books, Partner pages are links/anchors
  for future work; partner/contact forms are not built here).
- No donation/payment integration.
- No CMS — announcements and partners are static placeholders wired for later.

## 2. Design decisions (agreed in brainstorm)

- **Role:** Marketing site + community gateway.
- **Primary audience:** churches & leaders (partner CTA primary); individuals via
  community gateway (secondary).
- **Visual direction:** warm editorial, existing design system. No new tokens.
- **Sections (all approved):** partnership section, MOVE + 4-book journey, mission
  & vision story, community hub gateway, announcements, partners list.

## 3. Page architecture

One page, composed of sections. Content is static (typed data arrays in
components), server-rendered.

### Section order (top → bottom)

1. **Nav** — Logo (wordmark), links: About, MOVE System, Books, Partners, Contact;
   right-aligned **Partner With Us** button. Sticky, paper background, subtle bottom
   border. Mobile: hamburger → slide-over/sheet (reuse existing drawer pattern if
   present; otherwise a simple disclosure).
2. **Hero** — Paper gradient (`--color-paper` → `--color-paper-warm`) + radial
   orange accent wash. Eyebrow (tagline): **"Turning Pages, Turning Hearts"**
   (Manrope uppercase). Headline: *"Raising transformed followers who raise
   transformed followers."* Sub-copy covering the three pillars. CTAs:
   **Partner With Us** (primary orange) + **Explore the MOVE System** (secondary
   outline, anchors to the MOVE section). Optional right-side warm-toned open-book /
   small-group illustration (SVG, brand palette; static asset, not a photo).
3. **Who We Are** — H2 + short mission paragraph. Three pillar cards:
   (a) Servant-Leadership Trainings; (b) Moral-Recovery Literature;
   (c) Mental Health Empowerment. Each: icon in orange circle, title, one line.
4. **MOVE Discipleship System** — H2 "The MOVE Discipleship System" + sub-line
   "A 2-year journey of transformation". Horizontal 4-step path (numbered cards
   with connector arrows): **Usbong** (Salvation), **Usad** (Spiritual
   Disciplines), **Unlad** (Servant-Leadership), **Ugnay** (Systematic Theology —
   Theologets Series). Book-cover art (SVG typographic covers, consistent flat
   illustrated style). Each card gets a small orange **Buy on Shopee** pill
   (books are sold in the TransformLit Shopee store). Below: resource note —
   leaders' guide, presentations, video supplements for online or face-to-face
   small groups.
5. **Partner With Us** — Alternate warm surface. Copy on partnership (churches,
   leaders, para-church orgs; books/curriculums/systems; donations fund operations
   & self-publication). Right: CTA card — "Start a partnership conversation" +
   **Partner With Us** button + contact (phone 0927-412-2292, email).
6. **Beyond the Books** (Community Hub gateway) — H2 + one line. Three spotlight
   cards: **Tahanan Campus Community Group** (real program), **Community Groups**,
   **Books & Library**. Below: **light warm (paper-warm) banner card** with dark
   headline "Join the TransformLit Community" + orange **Join the Community**
   button → `/register` + secondary dark-outline **Get the App** button → Google
   Play (TransformLit App).
7. **Announcements** — H2 "Announcements". Two cards (date label, title, excerpt)
   from a static data array, using real content: **Tahanan Registration — Open**
   and **Book 4: Ugnay Now Available**.
8. **Partners strip** — quiet row of sponsor/church placeholder marks (low-opacity
   SVG shapes).
9. **Footer** — brand + tagline "Turning Pages, Turning Hearts.", social row
   (Facebook → facebook.com/transformlit, Instagram, Google Play, Shopee), link
   columns (About / Books / Partners), contact (phone, email), "© 2026 Transform
   Lit. All rights reserved."

### Behavior

- **Auth:** keep `AuthRedirect` wrapping the page — authenticated users are
  redirected to `/feed`; visitors see the marketing homepage. No change to auth
  flow.
- **Metadata:** update `layout.tsx` title/description to the organization, not the
  app placeholder ("Transform Lit — A community for transformed disciples" style).
  Page-level metadata on `page.tsx` if needed.
- **Routing:** nav anchors scroll to sections; "Join the Community" → `/register`;
  auth buttons → `/login` / `/register`; Book/About/Partner links point to
  `#` anchors or future routes (kept as inert links, no 404-generating routes).
- **Dark mode:** components must use semantic tokens so `next-themes` dark mode
  keeps working (tokens already defined in `globals.css`). Verify both modes.

## 4. Component structure (implementation target)

```
apps/web/src/app/page.tsx                    # server component, composes sections
apps/web/src/components/home/
  home-nav.tsx                               # sticky nav + mobile menu
  hero.tsx
  who-we-are.tsx                             # pillar cards
  move-system.tsx                            # 4-book journey
  partner-cta.tsx
  community-gateway.tsx                      # 3 spotlight cards + dark banner
  announcements.tsx
  partners-strip.tsx
  home-footer.tsx
apps/web/src/components/home/content.ts      # typed static data (books, pillars, etc.)
```

- Pure presentational components; `page.tsx` owns composition and auth wrapper.
- Reuse existing UI primitives from `src/components/ui` (Button, Card, etc.) where
  they exist; otherwise local Tailwind classes matching the design system.

## 5. Copy (source content)

All copy derives from the approved org definition:

- **Tagline:** Turning Pages, Turning Hearts. (hero eyebrow + footer tagline;
  sourced from linktr.ee/transformlit)
- **Mission line:** reach and prepare the next generation through servant-leadership
  trainings, moral-recovery-centered literature, and mental-health empowerment
  through life coaching and community groups.
- **Vision line:** partner with churches, church leaders, and para-church
  organizations in molding transformed followers who raise transformed followers
  through self-published books, curriculums, and systems.
- **Funding line:** donations and contributions support operational and
  self-publication funds.

## 6. Accessibility & responsive

- Touch targets ≥ 44px (design system).
- Semantic landmarks (`header`, `main`, `nav`, `footer`), heading order
  (`h1` in hero, `h2` per section, `h3` cards).
- Respect `prefers-reduced-motion` (no animation beyond existing conventions).
- Mobile-first: single column stacking; hero image hidden or below content on
  small screens; nav collapses to hamburger.
- Contrast per design-system tokens (ink on paper is AA).

## 7. Testing

Follow existing conventions in `apps/web` (jest + @testing-library/react, specs
co-located like `feed.spec.tsx`):

- Component render tests per section (renders heading, CTAs, expected copy).
- `page.spec.tsx` for homepage composition (all sections present, auth redirect
  preserved).
- Optional Playwright e2e: homepage loads, nav anchors work, Join → /register.
- Manual verification: `pnpm --filter @transformlit/web test`, `next build`,
  and a browser check of light + dark mode against the Stitch screen.

## 8. Verification against the Stitch design

The Stitch screen ("Transform Lit Homepage") is the visual source of truth.
Implementation must be compared against it: section spacing, type scale,
button styling, card radii/shadows. Any divergence is a defect to fix before
approval.

## 9. Out of scope / future

- About / Our Staff / Author pages, Books catalog page, Partner/Contact form.
- CMS or API-driven announcements/partners.
- Donations/payment.
- These become separate specs after this homepage ships.

## 10. Refinements from Linktree content (2026-08-29)

Approved refinements sourced from https://linktr.ee/transformlit and the
TransformLit Google Play listing (app `com.transformlit.app`, "Tracking tool for
bible studies"). All six were approved for the Stitch design and the plan:

1. **Tagline** "Turning Pages, Turning Hearts" → hero eyebrow + footer tagline.
2. **Shopee storefront** → each MOVE book card gets a "Buy on Shopee" action;
   books sold via shopee.ph/transformlit.
3. **Expanded footer socials** → Facebook, Instagram, Google Play, Shopee.
4. **App gateway** → dark Join banner gains a secondary "Get the App" CTA to
   Google Play, alongside "Join the Community" → `/register`.
5. **Feature Tahanan** → Tahanan Campus Community Group replaces the generic
   "Friends" spotlight card in Beyond the Books.
6. **Real announcements** → "Tahanan Registration — Open" (Jul 2026) and
   "Book 4: Ugnay Now Available" (Aug 2026).

## 11. Motion & animation (approved 2026-08-29)

**Library:** `motion@^13.1.1` (motion.dev; `framer-motion` is deprecated).
Import from `"motion/react"`. Officially supports React 19 + Next.js 16 App
Router; no config changes. Adds ~34–44 KB gzip; acceptable for the marketing
homepage. Every motion component lives in a `"use client"` file; keep client
boundaries small — **never put Motion providers/LazyMotion in `layout.tsx`**
(known Next 16 edge case with `_global-error` prerender).

**Motion language (respects `prefers-reduced-motion` via `useReducedMotion()`;**
**all durations/easings follow the design-system motion table):**

1. **Hero entrance (mount, NOT whileInView):** eyebrow → headline → body → CTAs
   stagger up on mount (`initial`/`animate`, 220ms ease-out, 40ms stagger).
   *Never use `whileInView` opacity-0 on above-the-fold content — it flashes or
   stays hidden until JS hydrates.* Illustration gets a slow ambient float
   (repeat, 6s ease-in-out, ±10px).
2. **Section reveals:** heading + content fade-up 12–24px on scroll
   (`whileInView` + `viewport={{ once: true, margin: '-80px' }}`, 0.5s ease-out).
   One-shot — no re-trigger on scroll back up.
3. **MOVE path:** 4 book cards stagger in left→right via `variants` +
   `stagger()` (deprecated `staggerChildren` is not used); connector line draws
   across (scaleX) as cards enter.
4. **Micro-interactions (hover/tap):** book-card lift + cover tilt + shadow
   (`whileHover`), Shopee pill press (`whileTap` scale 0.97), nav-link underline
   slide-in.

**Interaction table (per design system):** page/section 220ms ease-out · stagger
40ms gaps · hover/active 120ms · float 6s ease-in-out. All disabled under
`prefers-reduced-motion`.