'use client';

import { useState } from 'react';
import Link from 'next/link';
import { motion, useReducedMotion } from 'motion/react';
import { NAV_LINKS } from './content';

export function HomeNav() {
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotion();

  return (
    <header className="sticky top-0 z-50 bg-surface/95 backdrop-blur border-b border-outline-variant">
      <nav className="mx-auto max-w-[1200px] px-6 h-16 grid grid-cols-[1fr_auto_1fr] items-center gap-4">
        {/* col 1: logo, left */}
        <Link href="/" className="justify-self-start font-display text-headline-h3 font-bold text-ink-black inline-flex items-center gap-2">
          <span aria-hidden className="inline-block h-4 w-4 rounded-sm bg-brand" />
          Transform Lit
        </Link>

        {/* col 2: links, centered */}
        <div className="hidden lg:flex items-center gap-8 justify-self-center">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              className="group relative font-small text-small text-on-surface-variant hover:text-ink-black transition-colors"
            >
              {link.label}
              <span
                aria-hidden
                className="absolute left-0 -bottom-0.5 h-0.5 w-full rounded-full bg-brand origin-left scale-x-0 transition-transform duration-150 group-hover:scale-x-100"
              />
            </Link>
          ))}
        </div>

        {/* col 3: CTA (desktop) + mobile toggle, right */}
        <div className="justify-self-end flex items-center gap-2">
          <div className="hidden lg:block">
            <motion.span
              className="inline-block"
              whileTap={reduce ? undefined : { scale: 0.97 }}
            >
              <Link href="#partner-with-us" className="btn-primary">
                Partner With Us
              </Link>
            </motion.span>
          </div>
          <motion.button
            type="button"
            aria-label="Toggle menu"
            aria-expanded={open}
            aria-controls="mobile-menu"
            onClick={() => setOpen((v) => !v)}
            className="lg:hidden btn-ghost"
            whileTap={reduce ? undefined : { scale: 0.97 }}
          >
            <span className="material-symbols-outlined">{open ? 'close' : 'menu'}</span>
          </motion.button>
        </div>
      </nav>

      {open && (
        <div
          id="mobile-menu"
          role="navigation"
          aria-label="Mobile navigation"
          className="lg:hidden border-t border-outline-variant bg-surface px-6 py-4 flex flex-col gap-2"
        >
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