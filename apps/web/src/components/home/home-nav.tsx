'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion, useReducedMotion } from 'motion/react';
import { useTheme } from 'next-themes';
import { NAV_LINKS } from './content';

export function HomeNav() {
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotion();
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isDark = mounted && resolvedTheme === 'dark';

  function getThemeIcon(): string {
    if (!mounted) return 'dark_mode';
    return isDark ? 'light_mode' : 'dark_mode';
  }

  return (
    <header className="sticky top-0 z-50 bg-surface/95 backdrop-blur border-b border-outline-variant">
      <nav className="mx-auto max-w-[1200px] px-6 h-16 grid grid-cols-[1fr_auto_1fr] items-center gap-4">
        {/* col 1: logo, left */}
        <Link href="/" className="justify-self-start font-display text-headline-h3 font-bold text-ink-black inline-flex items-center gap-2">
          <span aria-hidden className="inline-block h-4 w-4 rounded-sm bg-brand" />{' '}
          Transform Lit
        </Link>

        {/* col 2: links, centered */}
        <div className="hidden lg:flex items-center gap-8 justify-self-center">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              className="group relative inline-flex items-center font-small text-small text-on-surface-variant hover:text-ink-black transition-colors"
            >
              {link.label}
              <span
                aria-hidden
                className="absolute left-0 -bottom-0.5 h-0.5 w-full rounded-full bg-brand origin-left scale-x-0 transition-transform duration-150 group-hover:scale-x-100"
              />
            </Link>
          ))}
        </div>

        {/* col 3: theme toggle + CTA (desktop) + mobile toggle, right */}
        <div className="justify-self-end flex items-center gap-2">
          <motion.button
            type="button"
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
            className="btn-ghost"
            whileTap={reduce ? undefined : { scale: 0.97 }}
          >
            <span className="material-symbols-outlined">{getThemeIcon()}</span>
          </motion.button>
          <div className="hidden lg:block">
            <motion.span
              className="inline-block"
              whileTap={reduce ? undefined : { scale: 0.97 }}
            >
              <Link href="/login" className="btn-primary">
                Login
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
        <nav
          id="mobile-menu"
          aria-label="Mobile navigation"
          className="lg:hidden border-t border-outline-variant bg-surface px-6 py-4 flex flex-col gap-2"
        >
          {NAV_LINKS.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              onClick={() => setOpen(false)}
              className="font-small text-small text-on-surface-variant py-2 inline-flex items-center"
            >
              {link.label}
            </Link>
          ))}
          <Link
            href="/login"
            onClick={() => setOpen(false)}
            className="btn-primary mt-2"
          >
            Login
          </Link>
        </nav>
      )}
    </header>
  );
}