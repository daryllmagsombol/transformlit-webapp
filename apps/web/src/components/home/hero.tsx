'use client';

import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import Link from 'next/link';

export function Hero() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const reduce = useReducedMotion();
  const fade =
    mounted && !reduce
      ? { initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 } }
      : {};
  const step =
    mounted && !reduce ? { transition: { duration: 0.22, ease: 'easeOut' as const } } : {};

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