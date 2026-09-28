'use client';

import { motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';
import { staggerContainer, staggerItem } from '../../lib/motion';

/**
 * Entrance stagger for list/grid surfaces.
 *
 * `Stagger` is the container (owns the stagger timing) and `StaggerItem` wraps
 * each row. Children must be direct descendants so motion can propagate the
 * `visible` variant. When reduced motion is on, both render plain elements and
 * nothing animates.
 *
 * `as` keeps document semantics intact — pass `as="ul"`/`as="li"` for real
 * lists rather than nesting divs inside a `ul`.
 *
 * GRID NOTE: `StaggerItem` is the grid/flex item. If the parent is a CSS grid
 * using explicit placement (e.g. `col-span-*`), put those classes on
 * `StaggerItem`, not on the inner element, or the layout collapses.
 *
 * Only opacity + a small translate animate — never `transform` on an ancestor
 * of fixed-position content (see app/(app)/template.tsx for why).
 */
type StaggerTag = 'div' | 'ul' | 'section';
type StaggerItemTag = 'div' | 'li';

export function Stagger({
  children,
  className,
  as = 'div',
  ariaLabel,
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly as?: StaggerTag;
  readonly ariaLabel?: string;
}) {
  const reduce = useReducedMotion();

  if (reduce === true) {
    const Tag = as;
    return (
      <Tag className={className} aria-label={ariaLabel}>
        {children}
      </Tag>
    );
  }

  const MotionTag = as === 'ul' ? motion.ul : as === 'section' ? motion.section : motion.div;

  return (
    <MotionTag
      className={className}
      aria-label={ariaLabel}
      variants={staggerContainer}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: '-40px' }}
    >
      {children}
    </MotionTag>
  );
}

export function StaggerItem({
  children,
  className,
  as = 'div',
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly as?: StaggerItemTag;
}) {
  const reduce = useReducedMotion();

  if (reduce === true) {
    const Tag = as;
    return <Tag className={className}>{children}</Tag>;
  }

  const MotionTag = as === 'li' ? motion.li : motion.div;

  return (
    <MotionTag className={className} variants={staggerItem}>
      {children}
    </MotionTag>
  );
}
