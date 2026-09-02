'use client';

import { getBookName } from '../../lib/bible/config';
import { refToHref } from '../../lib/bible/refs';
import type { CrossRefReference } from '../../lib/bible/types';

interface CrossRefListProps {
  refs: CrossRefReference[];
  translation: string;
  onNavigate: (href: string) => void;
}

export function CrossRefList({ refs, translation, onNavigate }: CrossRefListProps) {
  if (refs.length === 0) {
    return <p className="text-on-surface-variant text-small">No cross-references for this verse.</p>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {refs.map((r, i) => {
        const label = `${getBookName(r.book)} ${r.chapter}:${r.verse}${r.endVerse ? `–${r.endVerse}` : ''}`;
        return (
          <button
            key={`${r.book}-${r.chapter}-${r.verse}-${i}`}
            type="button"
            onClick={() => onNavigate(refToHref(translation, r.book, r.chapter, r.verse))}
            className="px-3 py-1.5 rounded-full border border-outline-variant text-small font-display text-on-surface-variant hover:text-accent-teal-light hover:border-accent-teal-light transition-colors"
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
