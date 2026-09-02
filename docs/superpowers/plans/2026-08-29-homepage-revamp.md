# Transform Lit Homepage Revamp — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder `apps/web/src/app/page.tsx` with a full marketing homepage for transformlit.com — partner-focused hero, mission pillars, MOVE 4-book journey, partnership CTA, Community Hub gateway, announcements, partners strip, and footer — matching the approved Stitch design.

**Architecture:** Static, server-rendered section components under `apps/web/src/components/home/`, driven by a typed static-content module. `page.tsx` (server) composes sections inside the existing `AuthRedirect` wrapper so authenticated users keep redirecting to `/feed`. Styled entirely with the existing Tailwind v4 design tokens and `.btn-*`/`.card` component classes in `globals.css`. Animations via `motion` (motion.dev) in small `"use client"` wrappers/leaf components.

**Tech Stack:** Next.js 16 (App Router), React 19, Tailwind v4, TypeScript, jest + @testing-library/react (existing conventions, co-located `*.spec.tsx`), **`motion@^13.1.1`** (import from `"motion/react"`).

**Spec:** `docs/superpowers/specs/2026-08-29-homepage-revamp-design.md`

## Global Constraints

- Only ONE new dependency: `motion@^13.1.1` (install in Task 11 via `pnpm add motion`; import from `"motion/react"`). No other new dependencies. No new CSS tokens — use tokens/classes already in `apps/web/src/styles/globals.css` (`--color-*`, `text-display`, `text-headline-h2`, `font-display`, `font-body`, `text-body`, `text-small`, `text-micro`, `btn-primary`, `btn-secondary`, `card`, `material-symbols-outlined`).
- All copy must match the spec Section 5 (org definition wording).
- Touch targets ≥ 44px (already enforced globally by `globals.css`).
- Keep `AuthRedirect` wrapping the homepage — do not change auth behavior.
- Components use semantic tokens so `next-themes` dark mode keeps working.
- Nav anchor IDs: `#who-we-are`, `#move-system`, `#partner-with-us`, `#beyond-the-books`, `#announcements`, `#footer`.
- All tests run: `pnpm --filter @transformlit/web test -- <spec-path>` from repo root.
- Verify with `pnpm --filter @transformlit/web build` before completing.
- Motion rules (spec §11): hero animates on **mount** (`initial`/`animate`), never `whileInView` opacity-0 on above-the-fold content; scroll reveals use `whileInView` + `viewport={{ once: true, margin: '-80px' }}`; MOVE uses `variants` + `stagger()` (not deprecated `staggerChildren`); every motion component file has `"use client"`; NO Motion providers/LazyMotion in `layout.tsx`; `useReducedMotion()` guards all motion.

---

### Task 1: Static content module

**Files:**
- Create: `apps/web/src/components/home/content.ts`
- Test: `apps/web/src/components/home/content.spec.ts`

**Interfaces:**
- Produces: `NAV_LINKS`, `PILLARS`, `BOOKS`, `ANNOUNCEMENTS`, `PARTNERS` (typed exports used by all later tasks), plus types `NavLink`, `Pillar`, `Book`, `Announcement`, `Partner`.

- [ ] **Step 1: Write the failing test**

```ts
import { NAV_LINKS, PILLARS, BOOKS, ANNOUNCEMENTS, PARTNERS, TAGLINE, FOOTER_SOCIALS } from './content';

describe('homepage content', () => {
  it('nav has 5 links including the partner target', () => {
    expect(NAV_LINKS).toHaveLength(5);
    expect(NAV_LINKS.map((l) => l.href)).toContain('#partner-with-us');
  });

  it('exports the brand tagline', () => {
    expect(TAGLINE).toBe('Turning Pages, Turning Hearts.');
  });

  it('has 3 pillars each with icon, title, description', () => {
    expect(PILLARS).toHaveLength(3);
    for (const p of PILLARS) {
      expect(p.icon).toBeTruthy();
      expect(p.title).toBeTruthy();
      expect(p.description).toBeTruthy();
    }
  });

  it('has the 4 MOVE books in order Usbong, Usad, Unlad, Ugnay, each with a Shopee link', () => {
    expect(BOOKS.map((b) => b.title)).toEqual(['Usbong', 'Usad', 'Unlad', 'Ugnay']);
    expect(BOOKS.map((b) => b.step)).toEqual([1, 2, 3, 4]);
    for (const book of BOOKS) {
      expect(book.shopeeUrl).toMatch(/^https:\/\/shopee\.ph\//);
    }
  });

  it('has 4 footer socials including Google Play', () => {
    expect(FOOTER_SOCIALS).toHaveLength(4);
    expect(FOOTER_SOCIALS.map((s) => s.label)).toEqual(
      expect.arrayContaining(['Facebook', 'Instagram', 'Google Play', 'Shopee']),
    );
  });

  it('has real announcements and at least one partner', () => {
    expect(ANNOUNCEMENTS.map((a) => a.title)).toContain('Tahanan Registration — Open');
    expect(ANNOUNCEMENTS.map((a) => a.title)).toContain('Book 4: Ugnay Now Available');
    expect(PARTNERS.length).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @transformlit/web test -- src/components/home/content.spec.ts`
Expected: FAIL — cannot find module `./content`.

- [ ] **Step 3: Create `content.ts`**

```ts
export interface NavLink {
  label: string;
  href: string;
}

export interface Pillar {
  icon: string;
  title: string;
  description: string;
}

export interface Book {
  step: number;
  title: string;
  phase: string;
  description: string;
  coverClass: string;
  shopeeUrl: string;
}

export interface Announcement {
  date: string;
  title: string;
  excerpt: string;
}

export interface Partner {
  name: string;
}

export interface SocialLink {
  label: string;
  href: string;
  icon: string;
}

export const TAGLINE = 'Turning Pages, Turning Hearts.';

export const FOOTER_SOCIALS: SocialLink[] = [
  { label: 'Facebook', href: 'https://facebook.com/transformlit', icon: 'facebook' },
  { label: 'Instagram', href: 'https://instagram.com/transformlit', icon: 'photo_camera' },
  {
    label: 'Google Play',
    href: 'https://play.google.com/store/apps/details?id=com.transformlit.app',
    icon: 'smartphone',
  },
  { label: 'Shopee', href: 'https://shopee.ph/transformlit', icon: 'shopping_bag' },
];

export const NAV_LINKS: NavLink[] = [
  { label: 'About', href: '#who-we-are' },
  { label: 'MOVE System', href: '#move-system' },
  { label: 'Books', href: '#move-system' },
  { label: 'Partners', href: '#partner-with-us' },
  { label: 'Contact', href: '#footer' },
];

export const PILLARS: Pillar[] = [
  {
    icon: 'diversity_3',
    title: 'Servant-Leadership Trainings',
    description:
      'Preparing the next generation through biblical servant-leadership formation.',
  },
  {
    icon: 'auto_stories',
    title: 'Moral-Recovery Literature',
    description:
      'Self-published, Biblically-sound books and curriculums for churches and small groups.',
  },
  {
    icon: 'psychology',
    title: 'Mental Health Empowerment',
    description:
      'Life coaching and community groups that restore hope and wellbeing.',
  },
];

export const BOOKS: Book[] = [
  {
    step: 1,
    title: 'Usbong',
    phase: 'Salvation',
    description: 'The beginning of new life in Christ.',
    coverClass: 'bg-primary-container',
    shopeeUrl: 'https://shopee.ph/product/70500775/13258169131',
  },
  {
    step: 2,
    title: 'Usad',
    phase: 'Spiritual Disciplines',
    description: 'Growing daily through the means of grace.',
    coverClass: 'bg-secondary-container',
    shopeeUrl: 'https://shopee.ph/product/70500775/14513651211',
  },
  {
    step: 3,
    title: 'Unlad',
    phase: 'Servant-Leadership',
    description: 'Leading others the way Christ leads.',
    coverClass: 'bg-primary-fixed-dim',
    shopeeUrl: 'https://shopee.ph/product/70500775/14857337751',
  },
  {
    step: 4,
    title: 'Ugnay',
    phase: 'Systematic Theology',
    description: 'Knowing God deeply — the Theologets Series.',
    coverClass: 'bg-tertiary-container',
    shopeeUrl: 'https://shopee.ph/product/70500775/21237049435',
  },
];

export const ANNOUNCEMENTS: Announcement[] = [
  {
    date: 'July 2026',
    title: 'Tahanan Registration — Open',
    excerpt:
      'Campus community registration is open. Partner campuses and students, sign up and join the journey.',
  },
  {
    date: 'August 2026',
    title: 'Book 4: Ugnay Now Available',
    excerpt:
      'The Theologets Series continues. Order Ugnay — and the full MOVE set — from the TransformLit Shopee store.',
  },
];

export const PARTNERS: Partner[] = [
  { name: 'Partner Church' },
  { name: 'Para-Church Ministry' },
  { name: 'Seminary' },
  { name: 'Christian School' },
  { name: 'Community Group' },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @transformlit/web test -- src/components/home/content.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/home/content.ts apps/web/src/components/home/content.spec.ts
git commit -m "feat(web): homepage static content module"
```

---

### Task 2: Home nav

**Files:**
- Create: `apps/web/src/components/home/home-nav.tsx`
- Test: `apps/web/src/components/home/home-nav.spec.tsx`

**Interfaces:**
- Consumes: `NAV_LINKS` from `./content` (Task 1).
- Produces: `HomeNav` — sticky `header` with desktop links + `#partner-with-us` CTA, mobile hamburger disclosure.

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen, fireEvent } from '@testing-library/react';

jest.mock('next/link', () => {
  return function MockLink({ children, href, className, onClick }: Record<string, unknown>) {
    return (
      <a href={href as string} className={className as string} onClick={onClick}>
        {children}
      </a>
    );
  };
});

import { HomeNav } from './home-nav';

describe('HomeNav', () => {
  it('renders nav links and the Partner With Us CTA', () => {
    render(<HomeNav />);
    expect(screen.getByText('About')).toBeInTheDocument();
    expect(screen.getByText('MOVE System')).toBeInTheDocument();
    expect(screen.getByText('Partner With Us')).toBeInTheDocument();
  });

  it('opens the mobile menu on toggle', () => {
    render(<HomeNav />);
    const toggle = screen.getByRole('button', { name: /toggle menu/i });
    fireEvent.click(toggle);
    expect(screen.getAllByText('About').length).toBeGreaterThanOrEqual(1);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @transformlit/web test -- src/components/home/home-nav.spec.tsx`
Expected: FAIL — cannot find module `./home-nav`.

- [ ] **Step 3: Create `home-nav.tsx`**

```tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { NAV_LINKS } from './content';

export function HomeNav() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 bg-surface/95 backdrop-blur border-b border-outline-variant">
      <nav className="mx-auto max-w-[1200px] px-6 h-16 flex items-center justify-between gap-4">
        <Link href="#top" className="font-display text-headline-h3 font-bold text-ink-black inline-flex items-center gap-2">
          <span aria-hidden className="inline-block h-4 w-4 rounded-sm bg-brand" />
          Transform Lit
        </Link>

        <div className="hidden lg:flex items-center gap-8">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              className="font-small text-small text-on-surface-variant hover:text-ink-black transition-colors"
            >
              {link.label}
            </Link>
          ))}
        </div>

        <div className="hidden lg:block">
          <Link href="#partner-with-us" className="btn-primary">
            Partner With Us
          </Link>
        </div>

        <button
          type="button"
          aria-label="Toggle menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="lg:hidden btn-ghost"
        >
          <span className="material-symbols-outlined">{open ? 'close' : 'menu'}</span>
        </button>
      </nav>

      {open && (
        <div className="lg:hidden border-t border-outline-variant bg-surface px-6 py-4 flex flex-col gap-2">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              onClick={() => setOpen(false)}
              className="font-small text-small text-on-surface-variant py-2"
            >
              {link.label}
            </Link>
          ))}
          <Link
            href="#partner-with-us"
            onClick={() => setOpen(false)}
            className="btn-primary mt-2"
          >
            Partner With Us
          </Link>
        </div>
      )}
    </header>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @transformlit/web test -- src/components/home/home-nav.spec.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/home/home-nav.tsx apps/web/src/components/home/home-nav.spec.tsx
git commit -m "feat(web): homepage nav with mobile menu"
```

---

### Task 3: Hero

**Files:**
- Create: `apps/web/src/components/home/hero.tsx`
- Test: `apps/web/src/components/home/hero.spec.tsx`

**Interfaces:**
- Produces: `Hero` — paper-gradient hero with eyebrow, headline, sub-copy, two CTAs, inline decorative SVG.

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from '@testing-library/react';

jest.mock('next/link', () => {
  return function MockLink({ children, href, className }: Record<string, unknown>) {
    return <a href={href as string} className={className as string}>{children}</a>;
  };
});

import { Hero } from './hero';

describe('Hero', () => {
  it('renders headline, tagline eyebrow and sub-copy', () => {
    render(<Hero />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Raising transformed followers');
    expect(screen.getByText('Turning Pages, Turning Hearts.')).toBeInTheDocument();
  });

  it('renders both CTAs with correct anchors', () => {
    render(<Hero />);
    const partner = screen.getByText('Partner With Us');
    const move = screen.getByText('Explore the MOVE System');
    expect(partner).toHaveAttribute('href', '#partner-with-us');
    expect(move).toHaveAttribute('href', '#move-system');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @transformlit/web test -- src/components/home/hero.spec.tsx`
Expected: FAIL — cannot find module `./hero`.

- [ ] **Step 3: Create `hero.tsx`**

```tsx
import Link from 'next/link';

export function Hero() {
  return (
    <section className="relative bg-gradient-to-b from-paper to-paper-warm">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(60% 60% at 10% 10%, rgba(244,161,28,0.18), transparent 60%)',
        }}
      />
      <div className="relative mx-auto max-w-[1200px] px-6 py-20 lg:py-28 grid lg:grid-cols-[1.2fr_0.8fr] gap-12 items-center">
        <div className="space-y-6">
          <p className="font-micro text-micro uppercase tracking-[0.15em] text-brand-orange-dark">
            Turning Pages, Turning Hearts.
          </p>
          <h1 className="font-display text-display-mobile lg:text-display text-ink-black">
            Raising transformed followers who raise{' '}
            <span className="text-primary">transformed followers</span>.
          </h1>
          <p className="font-body text-body text-on-surface-variant max-w-xl">
            Transform Lit prepares the next generation through servant-leadership
            trainings, moral-recovery-centered literature, and mental-health
            empowerment through life coaching and community groups.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 pt-2">
            <Link href="#partner-with-us" className="btn-primary">
              Partner With Us
            </Link>
            <Link href="#move-system" className="btn-secondary">
              Explore the MOVE System
            </Link>
          </div>
        </div>

        <HeroArtwork />
      </div>
    </section>
  );
}

function HeroArtwork() {
  return (
    <div aria-hidden className="hidden lg:block" data-testid="hero-artwork">
      <svg viewBox="0 0 400 320" className="w-full max-w-[420px]">
        <rect x="40" y="80" width="320" height="200" rx="16" fill="#FFE8C7" stroke="#111111" strokeWidth="2" />
        <rect x="70" y="60" width="140" height="200" rx="12" fill="#F4A11C" stroke="#111111" strokeWidth="2" transform="rotate(-8 70 60)" />
        <rect x="190" y="60" width="140" height="200" rx="12" fill="#FFF6E8" stroke="#111111" strokeWidth="2" transform="rotate(8 190 60)" />
        <circle cx="320" cy="200" r="36" fill="#1F7A6D" />
        <circle cx="120" cy="220" r="24" fill="#2ABFFF" />
        <path d="M40 96h320" stroke="#111111" strokeWidth="2" />
      </svg>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @transformlit/web test -- src/components/home/hero.spec.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/home/hero.tsx apps/web/src/components/home/hero.spec.tsx
git commit -m "feat(web): homepage hero section"
```

---

### Task 4: Who We Are (mission pillars)

**Files:**
- Create: `apps/web/src/components/home/who-we-are.tsx`
- Test: `apps/web/src/components/home/who-we-are.spec.tsx`

**Interfaces:**
- Consumes: `PILLARS` from `./content` (Task 1).
- Produces: `WhoWeAre` — section `id="who-we-are"`, mission paragraph + 3 pillar cards.

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from '@testing-library/react';

import { WhoWeAre } from './who-we-are';

describe('WhoWeAre', () => {
  it('renders the section heading and mission copy', () => {
    render(<WhoWeAre />);
    expect(screen.getByRole('heading', { name: 'Who We Are' })).toBeInTheDocument();
    expect(screen.getByText(/non-stock, non-profit organization/)).toBeInTheDocument();
  });

  it('renders all three pillars', () => {
    render(<WhoWeAre />);
    expect(screen.getByText('Servant-Leadership Trainings')).toBeInTheDocument();
    expect(screen.getByText('Moral-Recovery Literature')).toBeInTheDocument();
    expect(screen.getByText('Mental Health Empowerment')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @transformlit/web test -- src/components/home/who-we-are.spec.tsx`
Expected: FAIL — cannot find module `./who-we-are`.

- [ ] **Step 3: Create `who-we-are.tsx`**

```tsx
import { PILLARS } from './content';

export function WhoWeAre() {
  return (
    <section id="who-we-are" className="mx-auto max-w-[1200px] px-6 py-20">
      <div className="max-w-2xl space-y-4">
        <h2 className="font-display text-headline-h2 text-ink-black">Who We Are</h2>
        <p className="font-body text-body text-on-surface-variant">
          Transform Lit is a non-stock, non-profit organization reaching and
          preparing the next generation through servant-leadership trainings,
          moral-recovery-centered literature, and mental-health empowerment
          through life coaching and community groups.
        </p>
      </div>

      <div className="grid md:grid-cols-3 gap-6 mt-10">
        {PILLARS.map((pillar) => (
          <article key={pillar.title} className="card space-y-4">
            <span
              aria-hidden
              className="inline-flex items-center justify-center h-12 w-12 rounded-full bg-primary-container text-on-primary-container"
            >
              <span className="material-symbols-outlined">{pillar.icon}</span>
            </span>
            <h3 className="font-display text-headline-h3 text-ink-black">{pillar.title}</h3>
            <p className="font-body text-body text-on-surface-variant">{pillar.description}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @transformlit/web test -- src/components/home/who-we-are.spec.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/home/who-we-are.tsx apps/web/src/components/home/who-we-are.spec.tsx
git commit -m "feat(web): homepage who-we-are section"
```

---

### Task 5: MOVE Discipleship System

**Files:**
- Create: `apps/web/src/components/home/move-system.tsx`
- Test: `apps/web/src/components/home/move-system.spec.tsx`

**Interfaces:**
- Consumes: `BOOKS` from `./content` (Task 1).
- Produces: `MoveSystem` — section `id="move-system"`, 4-step journey cards + resource note.

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from '@testing-library/react';

jest.mock('next/link', () => {
  return function MockLink({ children, href, className }: Record<string, unknown>) {
    return <a href={href as string} className={className as string}>{children}</a>;
  };
});

import { MoveSystem } from './move-system';

describe('MoveSystem', () => {
  it('renders the section heading', () => {
    render(<MoveSystem />);
    expect(screen.getByRole('heading', { name: 'The MOVE Discipleship System' })).toBeInTheDocument();
  });

  it('renders the four books in order with their phases', () => {
    render(<MoveSystem />);
    const titles = ['Usbong', 'Usad', 'Unlad', 'Ugnay'];
    for (const title of titles) {
      expect(screen.getAllByText(title).length).toBeGreaterThan(0);
    }
    expect(screen.getByText('Salvation')).toBeInTheDocument();
    expect(screen.getByText('Spiritual Disciplines')).toBeInTheDocument();
    expect(screen.getByText('Servant-Leadership')).toBeInTheDocument();
    expect(screen.getByText('Systematic Theology')).toBeInTheDocument();
  });

  it('links every book to its Shopee product', () => {
    render(<MoveSystem />);
    const shopeeLinks = screen.getAllByText('Buy on Shopee');
    expect(shopeeLinks).toHaveLength(4);
    for (const link of shopeeLinks) {
      expect(link).toHaveAttribute('href', expect.stringMatching(/^https:\/\/shopee\.ph\//));
    }
  });

  it('renders the resources note', () => {
    render(<MoveSystem />);
    expect(screen.getByText(/leaders. guide, presentations, and video supplements/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @transformlit/web test -- src/components/home/move-system.spec.tsx`
Expected: FAIL — cannot find module `./move-system`.

- [ ] **Step 3: Create `move-system.tsx`**

```tsx
import Link from 'next/link';
import { BOOKS } from './content';

export function MoveSystem() {
  return (
    <section id="move-system" className="bg-surface-container-low">
      <div className="mx-auto max-w-[1200px] px-6 py-20">
        <div className="max-w-2xl space-y-3">
          <p className="font-micro text-micro uppercase tracking-[0.15em] text-brand-orange-dark">
            A 2-year journey of transformation
          </p>
          <h2 className="font-display text-headline-h2 text-ink-black">
            The MOVE Discipleship System
          </h2>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 mt-12">
          {BOOKS.map((book) => (
            <article key={book.title} className="card space-y-4 flex flex-col">
              <div className={`h-40 rounded-md ${book.coverClass} border-2 border-ink-black flex items-center justify-center`}>
                <span className="font-display text-headline-h3 text-ink-black">{book.title}</span>
              </div>
              <div className="space-y-2">
                <p className="font-micro text-micro uppercase tracking-[0.1em] text-brand-orange-dark">
                  Book {book.step}
                </p>
                <h3 className="font-display text-headline-h3 text-ink-black">{book.title}</h3>
                <p className="font-small text-small text-secondary">{book.phase}</p>
                <p className="font-body text-body text-on-surface-variant">{book.description}</p>
                <Link
                  href={book.shopeeUrl}
                  className="inline-block mt-2 px-4 py-2 rounded-sm bg-brand text-ink-black font-small text-small font-semibold border-2 border-ink-black hover:bg-brand-orange-dark transition-colors"
                >
                  Buy on Shopee
                </Link>
              </div>
            </article>
          ))}
        </div>

        <p className="font-small text-small text-on-surface-variant mt-10 max-w-3xl">
          Complete resources included — leaders&apos; guide, presentations, and video
          supplements — for disciplers running online or face-to-face small groups.
        </p>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @transformlit/web test -- src/components/home/move-system.spec.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/home/move-system.tsx apps/web/src/components/home/move-system.spec.tsx
git commit -m "feat(web): homepage MOVE system section"
```

---

### Task 6: Partner CTA

**Files:**
- Create: `apps/web/src/components/home/partner-cta.tsx`
- Test: `apps/web/src/components/home/partner-cta.spec.tsx`

**Interfaces:**
- Produces: `PartnerCta` — section `id="partner-with-us"`, partnership copy + CTA card with contact.

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from '@testing-library/react';

jest.mock('next/link', () => {
  return function MockLink({ children, href, className }: Record<string, unknown>) {
    return <a href={href as string} className={className as string}>{children}</a>;
  };
});

import { PartnerCta } from './partner-cta';

describe('PartnerCta', () => {
  it('renders partnership copy and heading', () => {
    render(<PartnerCta />);
    expect(screen.getByRole('heading', { name: 'Partner With Us' })).toBeInTheDocument();
    expect(screen.getByText(/churches, church leaders, and para-church organizations/i)).toBeInTheDocument();
  });

  it('shows contact phone and email', () => {
    render(<PartnerCta />);
    expect(screen.getByText('0927-412-2292')).toBeInTheDocument();
    expect(screen.getByText(/transformlit/i)).toBeInTheDocument();
  });

  it('renders a CTA button anchoring to contact', () => {
    render(<PartnerCta />);
    expect(screen.getByText('Start a Partnership Conversation')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @transformlit/web test -- src/components/home/partner-cta.spec.tsx`
Expected: FAIL — cannot find module `./partner-cta`.

- [ ] **Step 3: Create `partner-cta.tsx`**

```tsx
import Link from 'next/link';

const CONTACT_EMAIL = 'hello@transformlit.com';

export function PartnerCta() {
  return (
    <section id="partner-with-us" className="mx-auto max-w-[1200px] px-6 py-20">
      <div className="grid lg:grid-cols-2 gap-12 items-start">
        <div className="space-y-6">
          <h2 className="font-display text-headline-h2 text-ink-black">Partner With Us</h2>
          <p className="font-body text-body text-on-surface-variant">
            Transform Lit partners with churches, church leaders, and para-church
            organizations in molding transformed followers who raise transformed
            followers — through self-published books, curriculums, and systems.
          </p>
          <ul className="space-y-3 font-body text-body text-on-surface-variant">
            <li className="flex items-start gap-3">
              <span aria-hidden className="material-symbols-outlined text-primary">church</span>
              Church discipleship programs and small groups
            </li>
            <li className="flex items-start gap-3">
              <span aria-hidden className="material-symbols-outlined text-primary">school</span>
              Leadership trainings and events
            </li>
            <li className="flex items-start gap-3">
              <span aria-hidden className="material-symbols-outlined text-primary">menu_book</span>
              Curriculum licensing and bulk book orders
            </li>
          </ul>
          <p className="font-small text-small text-on-surface-variant">
            Donations and contributions support our operational and self-publication
            funds, keeping the organization sustainable and functional.
          </p>
        </div>

        <aside className="card bg-paper-warm space-y-4">
          <h3 className="font-display text-headline-h3 text-ink-black">
            Start a Partnership Conversation
          </h3>
          <p className="font-body text-body text-on-surface-variant">
            Tell us about your church or ministry. We&apos;ll respond with how the
            MOVE system can fit your context.
          </p>
          <Link href={`mailto:${CONTACT_EMAIL}`} className="btn-primary w-full sm:w-auto">
            Partner With Us
          </Link>
          <div className="pt-2 space-y-1 font-small text-small text-on-surface-variant">
            <p>
              <span aria-hidden className="material-symbols-outlined align-middle text-primary">call</span>{' '}
              0927-412-2292
            </p>
            <p>
              <span aria-hidden className="material-symbols-outlined align-middle text-primary">mail</span>{' '}
              {CONTACT_EMAIL}
            </p>
          </div>
        </aside>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @transformlit/web test -- src/components/home/partner-cta.spec.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/home/partner-cta.tsx apps/web/src/components/home/partner-cta.spec.tsx
git commit -m "feat(web): homepage partner CTA section"
```

---

### Task 7: Community Hub gateway

**Files:**
- Create: `apps/web/src/components/home/community-gateway.tsx`
- Test: `apps/web/src/components/home/community-gateway.spec.tsx`

**Interfaces:**
- Produces: `CommunityGateway` — section `id="beyond-the-books"`, 3 spotlight cards + dark banner with `/register` CTA.

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from '@testing-library/react';

jest.mock('next/link', () => {
  return function MockLink({ children, href, className }: Record<string, unknown>) {
    return <a href={href as string} className={className as string}>{children}</a>;
  };
});

import { CommunityGateway } from './community-gateway';

describe('CommunityGateway', () => {
  it('renders the three spotlight cards including Tahanan', () => {
    render(<CommunityGateway />);
    expect(screen.getByText('Community Groups')).toBeInTheDocument();
    expect(screen.getByText('Books & Library')).toBeInTheDocument();
    expect(screen.getByText('Tahanan Campus Community Group')).toBeInTheDocument();
  });

  it('renders the join banner linking to /register and the app to Google Play', () => {
    render(<CommunityGateway />);
    expect(screen.getByText('Join the TransformLit Community')).toBeInTheDocument();
    expect(screen.getByText('Join the Community')).toHaveAttribute('href', '/register');
    expect(screen.getByText('Get the App')).toHaveAttribute(
      'href',
      'https://play.google.com/store/apps/details?id=com.transformlit.app',
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @transformlit/web test -- src/components/home/community-gateway.spec.tsx`
Expected: FAIL — cannot find module `./community-gateway`.

- [ ] **Step 3: Create `community-gateway.tsx`**

```tsx
import Link from 'next/link';

const APP_PLAY_URL = 'https://play.google.com/store/apps/details?id=com.transformlit.app';

const SPOTLIGHTS = [
  {
    icon: 'home_work',
    title: 'Tahanan Campus Community Group',
    description: 'A campus community where students walk the discipleship journey together.',
  },
  {
    icon: 'groups',
    title: 'Community Groups',
    description: 'Find a small group or start one near you.',
  },
  {
    icon: 'auto_stories',
    title: 'Books & Library',
    description: 'Read, buy, and download our publications.',
  },
];

export function CommunityGateway() {
  return (
    <section id="beyond-the-books" className="bg-surface-container-low">
      <div className="mx-auto max-w-[1200px] px-6 py-20">
        <div className="max-w-2xl space-y-3">
          <h2 className="font-display text-headline-h2 text-ink-black">Beyond the Books</h2>
          <p className="font-body text-body text-on-surface-variant">
            The TransformLit Community Hub is where discipleship keeps going —
            reading groups, libraries, and friendships that build one another up.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6 mt-12">
          {SPOTLIGHTS.map((item) => (
            <article key={item.title} className="card space-y-4">
              <span
                aria-hidden
                className="inline-flex items-center justify-center h-12 w-12 rounded-full bg-primary-container text-on-primary-container"
              >
                <span className="material-symbols-outlined">{item.icon}</span>
              </span>
              <h3 className="font-display text-headline-h3 text-ink-black">{item.title}</h3>
              <p className="font-body text-body text-on-surface-variant">{item.description}</p>
            </article>
          ))}
        </div>

        <div className="mt-12 rounded-md bg-paper-warm text-ink-black border border-ink-black/10 p-8 lg:p-12 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
          <div className="space-y-2">
            <h3 className="font-display text-headline-h2 text-ink-black">
              Join the TransformLit Community
            </h3>
            <p className="font-body text-body text-on-surface-variant max-w-xl">
              Sign up free and start reading, joining groups, and growing alongside
              transformed followers.
            </p>
          </div>
          <div className="flex flex-wrap gap-4">
            <Link href="/register" className="btn-primary whitespace-nowrap">
              Join the Community
            </Link>
            <Link
              href={APP_PLAY_URL}
              className="btn-ghost text-ink-black border border-ink-black/40 whitespace-nowrap"
            >
              Get the App
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @transformlit/web test -- src/components/home/community-gateway.spec.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/home/community-gateway.tsx apps/web/src/components/home/community-gateway.spec.tsx
git commit -m "feat(web): homepage community gateway section"
```

---

### Task 8: Announcements + partners strip

**Files:**
- Create: `apps/web/src/components/home/announcements.tsx`, `apps/web/src/components/home/partners-strip.tsx`
- Test: `apps/web/src/components/home/announcements.spec.tsx`

**Interfaces:**
- Consumes: `ANNOUNCEMENTS`, `PARTNERS` from `./content` (Task 1).
- Produces: `Announcements` (section `id="announcements"`), `PartnersStrip`.

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from '@testing-library/react';

import { Announcements } from './announcements';
import { PartnersStrip } from './partners-strip';

describe('Announcements', () => {
  it('renders announcement cards', () => {
    render(<Announcements />);
    expect(screen.getByRole('heading', { name: 'Announcements' })).toBeInTheDocument();
    expect(screen.getByText('Tahanan Registration — Open')).toBeInTheDocument();
  });
});

describe('PartnersStrip', () => {
  it('renders the partners label and partner names', () => {
    render(<PartnersStrip />);
    expect(screen.getByText('Partners & Sponsors')).toBeInTheDocument();
    expect(screen.getByText('Partner Church')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @transformlit/web test -- src/components/home/announcements.spec.tsx`
Expected: FAIL — cannot find module `./announcements` or `./partners-strip`.

- [ ] **Step 3: Create `announcements.tsx`**

```tsx
import { ANNOUNCEMENTS } from './content';

export function Announcements() {
  return (
    <section id="announcements" className="mx-auto max-w-[1200px] px-6 py-20">
      <h2 className="font-display text-headline-h2 text-ink-black">Announcements</h2>
      <div className="grid md:grid-cols-2 gap-6 mt-10">
        {ANNOUNCEMENTS.map((item) => (
          <article key={item.title} className="card space-y-3">
            <p className="font-micro text-micro uppercase tracking-[0.1em] text-on-surface-variant">
              {item.date}
            </p>
            <h3 className="font-display text-headline-h4 text-ink-black">{item.title}</h3>
            <p className="font-body text-body text-on-surface-variant">{item.excerpt}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Create `partners-strip.tsx`**

```tsx
import { PARTNERS } from './content';

export function PartnersStrip() {
  return (
    <section className="border-y border-outline-variant bg-surface-container-low py-10">
      <div className="mx-auto max-w-[1200px] px-6">
        <p className="font-micro text-micro uppercase tracking-[0.15em] text-on-surface-variant text-center">
          Partners & Sponsors
        </p>
        <div className="flex flex-wrap items-center justify-center gap-10 mt-6 opacity-60">
          {PARTNERS.map((partner) => (
            <span key={partner.name} className="font-display text-headline-h4 text-on-surface-variant">
              {partner.name}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @transformlit/web test -- src/components/home/announcements.spec.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/home/announcements.tsx apps/web/src/components/home/partners-strip.tsx apps/web/src/components/home/announcements.spec.tsx
git commit -m "feat(web): homepage announcements and partners strip"
```

---

### Task 9: Footer

**Files:**
- Create: `apps/web/src/components/home/home-footer.tsx`
- Test: `apps/web/src/components/home/home-footer.spec.tsx`

**Interfaces:**
- Produces: `HomeFooter` — section `id="footer"` with brand, FB link, link columns, contact, copyright.

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from '@testing-library/react';

jest.mock('next/link', () => {
  return function MockLink({ children, href, className }: Record<string, unknown>) {
    return <a href={href as string} className={className as string}>{children}</a>;
  };
});

import { HomeFooter } from './home-footer';

describe('HomeFooter', () => {
  it('renders brand, tagline, copyright and contact', () => {
    render(<HomeFooter />);
    expect(screen.getByText('Turning Pages, Turning Hearts.')).toBeInTheDocument();
    expect(screen.getByText(/© 2026 Transform Lit/)).toBeInTheDocument();
    expect(screen.getByText('0927-412-2292')).toBeInTheDocument();
  });

  it('renders all four social links', () => {
    render(<HomeFooter />);
    expect(screen.getByText('Facebook')).toHaveAttribute('href', 'https://facebook.com/transformlit');
    expect(screen.getByText('Instagram')).toHaveAttribute('href', 'https://instagram.com/transformlit');
    expect(screen.getByText('Google Play')).toHaveAttribute(
      'href',
      'https://play.google.com/store/apps/details?id=com.transformlit.app',
    );
    expect(screen.getByText('Shopee')).toHaveAttribute('href', 'https://shopee.ph/transformlit');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @transformlit/web test -- src/components/home/home-footer.spec.tsx`
Expected: FAIL — cannot find module `./home-footer`.

- [ ] **Step 3: Create `home-footer.tsx`**

```tsx
import Link from 'next/link';
import { TAGLINE, FOOTER_SOCIALS } from './content';

const CONTACT_EMAIL = 'hello@transformlit.com';

export function HomeFooter() {
  return (
    <footer id="footer" className="bg-paper border-t border-outline-variant">
      <div className="mx-auto max-w-[1200px] px-6 py-14 grid gap-10 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
        <div className="space-y-3">
          <p className="font-display text-headline-h3 font-bold text-ink-black inline-flex items-center gap-2">
            <span aria-hidden className="inline-block h-4 w-4 rounded-sm bg-brand" />
            Transform Lit
          </p>
          <p className="font-body text-body text-on-surface-variant max-w-xs">{TAGLINE}</p>
          <div className="flex flex-wrap gap-4 pt-1">
            {FOOTER_SOCIALS.map((social) => (
              <Link
                key={social.label}
                href={social.href}
                className="font-small text-small text-on-surface-variant hover:text-primary inline-flex items-center gap-2"
              >
                <span aria-hidden className="material-symbols-outlined">{social.icon}</span>
                {social.label}
              </Link>
            ))}
          </div>
        </div>

        <FooterColumn
          title="About"
          links={[
            { label: 'Transform Lit', href: '#who-we-are' },
            { label: 'MOVE System', href: '#move-system' },
          ]}
        />
        <FooterColumn
          title="Books"
          links={[
            { label: 'MOVE Discipleship', href: '#move-system' },
            { label: 'Theologets Series', href: '#move-system' },
          ]}
        />
        <FooterColumn
          title="Partners"
          links={[
            { label: 'Sponsors', href: '#partner-with-us' },
            { label: 'Churches', href: '#partner-with-us' },
          ]}
        />
      </div>

      <div className="border-t border-outline-variant">
        <div className="mx-auto max-w-[1200px] px-6 py-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 font-small text-small text-on-surface-variant">
          <p>© 2026 Transform Lit. All rights reserved.</p>
          <p>
            <span aria-hidden className="material-symbols-outlined align-middle">call</span>{' '}
            0927-412-2292
            <span aria-hidden className="material-symbols-outlined align-middle ml-4">mail</span>{' '}
            {CONTACT_EMAIL}
          </p>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({ title, links }: { title: string; links: { label: string; href: string }[] }) {
  return (
    <div className="space-y-3">
      <p className="font-micro text-micro uppercase tracking-[0.1em] text-on-surface-variant">{title}</p>
      <ul className="space-y-2">
        {links.map((link) => (
          <li key={link.label}>
            <Link
              href={link.href}
              className="font-small text-small text-on-surface-variant hover:text-primary transition-colors"
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @transformlit/web test -- src/components/home/home-footer.spec.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/home/home-footer.tsx apps/web/src/components/home/home-footer.spec.tsx
git commit -m "feat(web): homepage footer"
```

---

### Task 10: Compose homepage + metadata

**Files:**
- Modify: `apps/web/src/app/page.tsx` (replace whole file)
- Modify: `apps/web/src/app/layout.tsx:7-10` (metadata title/description)
- Test: `apps/web/src/app/page.spec.tsx` (create)

**Interfaces:**
- Consumes: all section components from Tasks 2–9 and existing `./auth-redirect`.
- Produces: the final homepage at `/` with updated site metadata.

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from '@testing-library/react';

jest.mock('./auth-redirect', () => {
  return function MockAuthRedirect({ children }: { children: React.ReactNode }) {
    return <div data-testid="auth-redirect">{children}</div>;
  };
});

jest.mock('next/link', () => {
  return function MockLink({ children, href, className }: Record<string, unknown>) {
    return <a href={href as string} className={className as string}>{children}</a>;
  };
});

import HomePage from './page';

describe('HomePage', () => {
  it('renders every homepage section', () => {
    render(<HomePage />);
    expect(screen.getByText('Who We Are')).toBeInTheDocument();
    expect(screen.getByText('The MOVE Discipleship System')).toBeInTheDocument();
    expect(screen.getAllByText('Partner With Us').length).toBeGreaterThan(0);
    expect(screen.getByText('Beyond the Books')).toBeInTheDocument();
    expect(screen.getByText('Announcements')).toBeInTheDocument();
    expect(screen.getByText(/© 2026 Transform Lit/)).toBeInTheDocument();
  });

  it('wraps content in the auth redirect so authenticated users go to /feed', () => {
    render(<HomePage />);
    expect(screen.getByTestId('auth-redirect')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @transformlit/web test -- src/app/page.spec.tsx`
Expected: FAIL — page renders old placeholder; `Who We Are` not found.

- [ ] **Step 3: Replace `apps/web/src/app/page.tsx`**

```tsx
import AuthRedirect from './auth-redirect';
import { HomeNav } from '../components/home/home-nav';
import { Hero } from '../components/home/hero';
import { WhoWeAre } from '../components/home/who-we-are';
import { MoveSystem } from '../components/home/move-system';
import { PartnerCta } from '../components/home/partner-cta';
import { CommunityGateway } from '../components/home/community-gateway';
import { Announcements } from '../components/home/announcements';
import { PartnersStrip } from '../components/home/partners-strip';
import { HomeFooter } from '../components/home/home-footer';

export default function HomePage() {
  return (
    <AuthRedirect>
      <HomeNav />
      <main>
        <Hero />
        <WhoWeAre />
        <MoveSystem />
        <PartnerCta />
        <CommunityGateway />
        <Announcements />
        <PartnersStrip />
      </main>
      <HomeFooter />
    </AuthRedirect>
  );
}
```

- [ ] **Step 4: Update `apps/web/src/app/layout.tsx` metadata**

Replace lines 7–10:

```tsx
export const metadata: Metadata = {
  title: 'Transform Lit',
  description:
    'A non-profit organization reaching and preparing the next generation through servant-leadership trainings, moral-recovery-centered literature, and mental-health empowerment.',
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @transformlit/web test -- src/app/page.spec.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Run the full web test suite**

Run: `pnpm --filter @transformlit/web test`
Expected: All suites PASS (existing + new).

- [ ] **Step 7: Verify the production build**

Run: `pnpm --filter @transformlit/web build`
Expected: Build succeeds with no type errors.

- [ ] **Step 8: Manual visual verification**

Run: `pnpm --filter @transformlit/web dev` (port 3000), open `http://localhost:3000`.
Check against the Stitch "Transform Lit Homepage" screen: section order, hero gradient, 4 book covers, dark join banner, footer contact. Toggle `next-themes` dark mode — sections must remain readable. Verify logged-in state still redirects to `/feed` (existing behavior, spot-check).

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/app/page.tsx apps/web/src/app/layout.tsx apps/web/src/app/page.spec.tsx
git commit -m "feat(web): compose revamped transformlit homepage"
```

---

### Task 11: Motion animation pass (entrances, micro-interactions, float)

**Files:**
- Modify: `apps/web/package.json` (add `motion`)
- Create: `apps/web/src/components/home/motion-reveal.tsx`, `apps/web/src/components/home/motion-reveal.spec.tsx`
- Modify: `apps/web/src/components/home/home-nav.tsx`, `hero.tsx`, `who-we-are.tsx`, `move-system.tsx`, `partner-cta.tsx`, `community-gateway.tsx`, `announcements.tsx`, `partners-strip.tsx` (+ their specs where assertions change)
- Test: `pnpm --filter @transformlit/web test`, `pnpm --filter @transformlit/web build`

**Interfaces:**
- Produces: `Reveal` client wrapper (`{ children, delay?, className? }`) from `./motion-reveal` — used by every section for scroll reveals.
- Consumes: nothing new from other tasks.

Motion rules (spec §11): hero on mount (`initial`/`animate`), sections via `Reveal` (`whileInView`, once, margin -80px), MOVE via `variants` + `stagger()`, `useReducedMotion()` guards everywhere.

- [ ] **Step 1: Install motion**

Run (from repo root): `pnpm --filter @transformlit/web add motion@^13.1.1`
Expected: `motion@^13.1.1` added to `apps/web/package.json` dependencies and lockfile updated.

- [ ] **Step 2: Write the failing Reveal test**

Create `apps/web/src/components/home/motion-reveal.spec.tsx`:

```tsx
import { render, screen } from '@testing-library/react';

class MockIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
(global as unknown as { IntersectionObserver: unknown }).IntersectionObserver = MockIntersectionObserver;

(global as unknown as { matchMedia: unknown }).matchMedia = (query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
});

import { Reveal } from './motion-reveal';

describe('Reveal', () => {
  it('renders its children', () => {
    render(<Reveal>Hello Reveal</Reveal>);
    expect(screen.getByText('Hello Reveal')).toBeInTheDocument();
  });

  it('accepts a className', () => {
    render(
      <Reveal className="test-class">
        <span>Content</span>
      </Reveal>,
    );
    expect(document.querySelector('.test-class')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @transformlit/web test -- src/components/home/motion-reveal.spec.tsx`
Expected: FAIL — cannot find module `./motion-reveal`.

- [ ] **Step 4: Create `motion-reveal.tsx`**

```tsx
'use client';

import { motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';

export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();

  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.5, ease: 'easeOut', delay }}
    >
      {children}
    </motion.div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @transformlit/web test -- src/components/home/motion-reveal.spec.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Hero — mount stagger + illustration float**

Convert `apps/web/src/components/home/hero.tsx` to a client component. Keep all existing JSX; add the motion props:

```tsx
'use client';

import { motion, useReducedMotion } from 'motion/react';
import Link from 'next/link';

export function Hero() {
  const reduce = useReducedMotion();
  const fade = reduce
    ? {}
    : { initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 } };
  const step = reduce ? {} : { transition: { duration: 0.22, ease: 'easeOut' as const } };

  return (
    <section className="relative bg-gradient-to-b from-paper to-paper-warm">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(60% 60% at 10% 10%, rgba(244,161,28,0.18), transparent 60%)',
        }}
      />
      <div className="relative mx-auto max-w-[1200px] px-6 py-20 lg:py-28 grid lg:grid-cols-[1.2fr_0.8fr] gap-12 items-center">
        <div className="space-y-6">
          <motion.p {...fade} {...step} transition={{ ...step.transition, delay: 0 }} className="font-micro text-micro uppercase tracking-[0.15em] text-brand-orange-dark">
            Turning Pages, Turning Hearts.
          </motion.p>
          <motion.h1 {...fade} {...step} transition={{ ...step.transition, delay: 0.08 }} className="font-display text-display-mobile lg:text-display text-ink-black">
            Raising transformed followers who raise{' '}
            <span className="text-primary">transformed followers</span>.
          </motion.h1>
          <motion.p {...fade} {...step} transition={{ ...step.transition, delay: 0.16 }} className="font-body text-body text-on-surface-variant max-w-xl">
            Transform Lit prepares the next generation through servant-leadership
            trainings, moral-recovery-centered literature, and mental-health
            empowerment through life coaching and community groups.
          </motion.p>
          <motion.div {...fade} {...step} transition={{ ...step.transition, delay: 0.24 }} className="flex flex-col sm:flex-row gap-4 pt-2">
            <Link href="#partner-with-us" className="btn-primary">
              Partner With Us
            </Link>
            <Link href="#move-system" className="btn-secondary">
              Explore the MOVE System
            </Link>
          </motion.div>
        </div>

        {!reduce && (
          <motion.div
            animate={{ y: [0, -10, 0] }}
            transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
            className="hidden lg:block"
          >
            <HeroArtwork />
          </motion.div>
        )}
        {reduce && (
          <div className="hidden lg:block">
            <HeroArtwork />
          </div>
        )}
      </div>
    </section>
  );
}

function HeroArtwork() {
  return (
    <div aria-hidden className="hidden lg:block" data-testid="hero-artwork">
      <svg viewBox="0 0 400 320" className="w-full max-w-[420px]">
        <rect x="40" y="80" width="320" height="200" rx="16" fill="#FFE8C7" stroke="#111111" strokeWidth="2" />
        <rect x="70" y="60" width="140" height="200" rx="12" fill="#F4A11C" stroke="#111111" strokeWidth="2" transform="rotate(-8 70 60)" />
        <rect x="190" y="60" width="140" height="200" rx="12" fill="#FFF6E8" stroke="#111111" strokeWidth="2" transform="rotate(8 190 60)" />
        <circle cx="320" cy="200" r="36" fill="#1F7A6D" />
        <circle cx="120" cy="220" r="24" fill="#2ABFFF" />
        <path d="M40 96h320" stroke="#111111" strokeWidth="2" />
      </svg>
    </div>
  );
}
```

- [ ] **Step 7: Run hero test**

Run: `pnpm --filter @transformlit/web test -- src/components/home/hero.spec.tsx`
Expected: PASS (existing assertions unchanged — content still rendered).

- [ ] **Step 8: MOVE system — variants + stagger + connector draw**

In `apps/web/src/components/home/move-system.tsx`: add `'use client';`, import `{ motion, useReducedMotion } from 'motion/react'`. Wrap the book-card grid:

```tsx
const reduce = useReducedMotion();

const gridVariants = {
  hidden: {},
  visible: { transition: { when: 'beforeChildren' as const, delayChildren: stagger(0.1) } },
};
const cardVariants = reduce
  ? {}
  : {
      hidden: { opacity: 0, y: 24 },
      visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: 'easeOut' as const } },
    };
```

Replace the grid `<div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 mt-12">` with:

```tsx
<motion.div
  className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 mt-12"
  initial={reduce ? false : 'hidden'}
  whileInView="visible"
  viewport={{ once: true, margin: '-80px' }}
  variants={gridVariants}
>
```

Replace each `<article key={book.title} className="card ...">` with a `motion.article` carrying `variants={cardVariants}`. Add the connector draw under the grid (before the resource note):

```tsx
<motion.div
  aria-hidden
  className="mt-10 h-1 rounded-full bg-primary-fixed-dim"
  initial={reduce ? false : { scaleX: 0 }}
  whileInView={{ scaleX: 1 }}
  viewport={{ once: true }}
  transition={{ duration: 0.8, ease: 'easeOut' }}
  style={{ transformOrigin: 'left' }}
/>
```

Import `stagger` alongside `motion`: `import { motion, stagger, useReducedMotion } from 'motion/react';`

- [ ] **Step 9: Run MOVE test**

Run: `pnpm --filter @transformlit/web test -- src/components/home/move-system.spec.tsx`
Expected: PASS (existing assertions unchanged).

- [ ] **Step 10: Nav — tap/underline micro-interactions**

In `apps/web/src/components/home/home-nav.tsx` (already `'use client'`), add `import { motion, useReducedMotion } from 'motion/react';`. Convert the desktop nav links to slide their underline:

```tsx
{NAV_LINKS.map((link) => (
  <Link
    key={link.label}
    href={link.href}
    className="relative font-small text-small text-on-surface-variant hover:text-ink-black transition-colors"
  >
    {link.label}
    <motion.span
      aria-hidden
      className="absolute left-0 -bottom-0.5 h-0.5 w-full rounded-full bg-brand"
      style={{ scaleX: 0, transformOrigin: 'left' }}
      whileHover={{ scaleX: 1 }}
      transition={{ duration: 0.15, ease: 'easeOut' }}
    />
  </Link>
))}
```

Add `whileTap={{ scale: 0.97 }}` to the desktop CTA link and the mobile menu toggle button (wrap the `<Link className="btn-primary">` in a `motion.span` with `whileTap={{ scale: 0.97 }}` and `className="inline-block"`).

- [ ] **Step 11: Remaining sections — wrap in Reveal**

In each file below, add `'use client';`, import `{ Reveal } from './motion-reveal'`, and wrap the section's inner content (the `max-w-[1200px]` container) with `<Reveal>...</Reveal>` so heading + cards reveal together on scroll. Keep every existing class and element unchanged inside the wrapper:

- `who-we-are.tsx` — wrap `<div className="mx-auto max-w-[1200px] px-6 py-20">` content.
- `partner-cta.tsx` — wrap `<div className="grid lg:grid-cols-2 gap-12 items-start">` content.
- `community-gateway.tsx` — wrap `<div className="mx-auto max-w-[1200px] px-6 py-20">` content.
- `announcements.tsx` — wrap `<div className="grid md:grid-cols-2 gap-6 mt-10">` + heading together.
- `partners-strip.tsx` — wrap the `<div className="mx-auto max-w-[1200px] px-6">` content.

- [ ] **Step 12: Run full test suite**

Run: `pnpm --filter @transformlit/web test`
Expected: All suites PASS. If any spec fails because content is now inside `motion` elements, the fix is to add the jsdom `IntersectionObserver` + `matchMedia` mocks shown in Steps 2/5 to that spec — the assertions themselves do not change (elements remain in the DOM).

- [ ] **Step 13: Verify the production build**

Run: `pnpm --filter @transformlit/web build`
Expected: Build succeeds with no type errors.

- [ ] **Step 14: Manual visual check**

Run: `pnpm --filter @transformlit/web dev` (port 3000). Verify: hero staggers in on load; illustration floats; sections reveal once on scroll; MOVE cards stagger + connector draws; hover on nav links slides underline; Shopee pill presses. Toggle OS `prefers-reduced-motion` (or devtools emulate) — all motion disabled, content fully visible. Toggle dark mode — still readable.

- [ ] **Step 15: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml
git add apps/web/src/components/home
git add apps/web/src/app/page.spec.tsx
git commit -m "feat(web): homepage motion animations (motion.dev)"
```