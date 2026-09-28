/**
 * Motion tokens and reusable variants — the single source of truth for JS-side
 * animation. Mirrors the `--duration-*` / `--ease-*` values in globals.css.
 *
 * Design intent: this app should feel native, not cinematic. Every duration is
 * short (<= 320ms) and every offset is small (<= 16px) so movement reads as
 * responsive feedback rather than decoration.
 *
 * Wrap animated elements in `AnimatePresence` when they mount/unmount. In tests
 * note that the exiting node stays mounted until the exit transition finishes —
 * await `waitFor` instead of asserting synchronously.
 */

import type { Transition, Variants } from 'motion/react';

/** Durations in seconds (motion uses seconds, CSS uses ms). */
export const DURATION = {
  instant: 0.1,
  fast: 0.15,
  normal: 0.22,
  slow: 0.32,
} as const;

/** Cubic-bezier easings matching the CSS custom properties. */
export const EASE = {
  outQuint: [0.22, 1, 0.36, 1],
  springSoft: [0.34, 1.56, 0.64, 1],
} as const;

/** Soft overshoot — for overlays and interactive surfaces. */
export const springSoft: Transition = {
  type: 'spring',
  stiffness: 380,
  damping: 32,
  mass: 0.9,
};

/** Snappier spring — for small, frequent movements (indicators, badges). */
export const springSnappy: Transition = {
  type: 'spring',
  stiffness: 520,
  damping: 34,
  mass: 0.7,
};

export const tweenOut: Transition = {
  type: 'tween',
  duration: DURATION.normal,
  ease: EASE.outQuint,
};

/* ── Variants ─────────────────────────────────────────────────────────── */

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: tweenOut },
  exit: { opacity: 0, transition: { duration: DURATION.fast } },
};

/** Small upward slide. Offset stays small so it never feels floaty. */
export const slideUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: springSoft },
  exit: { opacity: 0, y: 8, transition: { duration: DURATION.fast } },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  visible: { opacity: 1, scale: 1, transition: springSoft },
  exit: { opacity: 0, scale: 0.98, transition: { duration: DURATION.fast } },
};

export const backdrop: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: DURATION.fast } },
  exit: { opacity: 0, transition: { duration: DURATION.fast } },
};

/** Sheet/drawer entrance from the given edge. */
export function sheetFrom(side: 'right' | 'bottom'): Variants {
  const offset = side === 'right' ? { x: '100%' } : { y: '100%' };
  const settled = side === 'right' ? { x: 0 } : { y: 0 };
  return {
    hidden: { ...offset },
    visible: { ...settled, transition: springSoft },
    exit: { ...offset, transition: { duration: DURATION.normal, ease: EASE.outQuint } },
  };
}

/** Toast entrance: rises from below with a touch of overshoot. */
export const toastVariants: Variants = {
  hidden: { opacity: 0, y: 16, scale: 0.98 },
  visible: { opacity: 1, y: 0, scale: 1, transition: springSoft },
  exit: { opacity: 0, y: 8, scale: 0.98, transition: { duration: DURATION.fast } },
};

/**
 * Route enter. Opacity ONLY — deliberately.
 *
 * A CSS transform on an ancestor becomes the containing block for
 * `position: fixed` descendants, and motion leaves the transform in place after
 * animating. Pages such as feed-client.tsx and books-client.tsx render fixed
 * FABs (`fixed bottom-24 right-6`), so a translating route wrapper would
 * permanently misposition them. Put transforms on per-screen elements instead.
 */
export const pageEnter: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: DURATION.fast, ease: EASE.outQuint } },
};

export const staggerContainer: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.04, delayChildren: 0.02 } },
};

export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: springSoft },
};
