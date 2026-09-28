'use client';

import { motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';
import { pageEnter } from '../../lib/motion';

/**
 * Route-level enter transition for the authenticated app.
 *
 * A `template.tsx` remounts on navigation (unlike `layout.tsx`), which is what
 * makes an enter animation replay per route.
 *
 * Deliberately opacity-only, with NO `transform` and NO `will-change`:
 * - `transform` (and `will-change: transform`) on an ancestor becomes the
 *   containing block for `position: fixed` descendants. Several pages render
 *   fixed floating action buttons (feed-client.tsx, books-client.tsx —
 *   `fixed bottom-24 right-6`), which would then jump.
 * - `will-change: opacity` would PERMANENTLY create a stacking context, which
 *   would trap in-page overlays (`z-[80]` Modal/Sheet) beneath the app chrome
 *   (`z-50` TopBar/BottomNav). Plain animated `opacity` only creates a stacking
 *   context while it is below 1, so layering returns to normal once the short
 *   enter finishes.
 *
 * Put translate/scale motion on per-screen elements instead.
 */
export default function AppTemplate({ children }: { readonly children: ReactNode }) {
  const reduce = useReducedMotion();

  if (reduce === true) {
    return <>{children}</>;
  }

  return (
    <motion.div variants={pageEnter} initial="hidden" animate="visible">
      {children}
    </motion.div>
  );
}
