'use client';

import { motion, useReducedMotion } from 'motion/react';
import Link from 'next/link';

export function Hero() {
  const reduce = useReducedMotion();
  const animate = !reduce;

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
          <motion.p
            initial={animate ? { opacity: 0, y: 20 } : false}
            animate={animate ? { opacity: 1, y: 0 } : false}
            transition={animate ? { duration: 0.5, ease: 'easeOut', delay: 0 } : undefined}
            className="font-micro text-micro uppercase tracking-[0.15em] text-brand-orange-dark"
          >
            Turning Pages, Turning Hearts.
          </motion.p>
          <motion.h1
            initial={animate ? { opacity: 0, y: 20 } : false}
            animate={animate ? { opacity: 1, y: 0 } : false}
            transition={animate ? { duration: 0.5, ease: 'easeOut', delay: 0.1 } : undefined}
            className="font-display text-display-mobile lg:text-display text-ink-black"
          >
            Raising transformed followers who raise{' '}
            <span className="text-primary">transformed followers</span>.
          </motion.h1>
          <motion.p
            initial={animate ? { opacity: 0, y: 20 } : false}
            animate={animate ? { opacity: 1, y: 0 } : false}
            transition={animate ? { duration: 0.5, ease: 'easeOut', delay: 0.2 } : undefined}
            className="font-body text-body text-on-surface-variant max-w-xl"
          >
            Transform Lit prepares the next generation through servant-leadership
            trainings, moral-recovery-centered literature, and mental-health
            empowerment through life coaching and community groups.
          </motion.p>
          <motion.div
            initial={animate ? { opacity: 0, y: 20 } : false}
            animate={animate ? { opacity: 1, y: 0 } : false}
            transition={animate ? { duration: 0.5, ease: 'easeOut', delay: 0.3 } : undefined}
            className="flex flex-col sm:flex-row gap-4 pt-2"
          >
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
          >
            <HeroArtwork />
          </motion.div>
        )}
        {reduce && (
          <div>
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
      <img
        src="/images/hero.jpg"
        alt=""
        className="w-full max-w-[420px] rounded-lg shadow-soft border border-ink-black/10"
      />
    </div>
  );
}