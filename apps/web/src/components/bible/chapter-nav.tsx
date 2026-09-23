'use client';

import Link from 'next/link';

export interface NavLink {
  href: string;
  label: string;
}

interface ChapterNavProps {
  readonly prev: NavLink | null;
  readonly next: NavLink | null;
}

export function ChapterNav({ prev, next }: ChapterNavProps) {
  if (!prev && !next) {
    return <p className="text-center text-on-surface-variant text-small py-6">Start of the Bible</p>;
  }
  return (
    <div className="flex items-center justify-between gap-4 py-6">
      {prev ? (
        <Link
          href={prev.href}
          className="flex-1 text-center px-4 py-3 rounded-lg border-2 border-brand text-brand dark:text-primary dark:border-primary font-display text-small font-bold hover:bg-brand hover:text-ink-black dark:hover:bg-primary dark:hover:text-on-primary transition-colors"
        >
          ‹ {prev.label}
        </Link>
      ) : (
        <span className="flex-1" />
      )}
      {next ? (
        <Link
          href={next.href}
          className="flex-1 text-center px-4 py-3 rounded-lg bg-brand-orange-dark text-on-primary font-display text-small font-bold hover:bg-brand-orange-dark/90 transition-colors"
        >
          {next.label} ›
        </Link>
      ) : (
        <span className="flex-1" />
      )}
    </div>
  );
}
