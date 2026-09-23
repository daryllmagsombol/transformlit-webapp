'use client';

import { getBookName } from '../../lib/bible/config';
import { refToHref } from '../../lib/bible/refs';
import type { SearchResult } from '../../lib/bible/search/matcher';

interface SearchResultItemProps {
  readonly result: SearchResult;
  readonly translation: string;
  readonly onNavigate: (href: string) => void;
}

export function SearchResultItem({ result, translation, onNavigate }: SearchResultItemProps) {
  const reference = `${getBookName(result.b)} ${result.c}:${result.v}`;
  const before = result.snippet.slice(0, result.matchStart);
  const match = result.snippet.slice(result.matchStart, result.matchEnd);
  const after = result.snippet.slice(result.matchEnd);

  return (
    <button
      type="button"
      onClick={() => onNavigate(refToHref(translation, result.b, result.c, result.v))}
      className="w-full text-left bg-surface-container-lowest dark:bg-surface-raised border border-outline-variant rounded-lg p-4 hover:border-primary transition-colors"
    >
      <span className="font-display text-small font-bold text-on-surface">{reference}</span>
      <p className="font-body text-body text-on-surface-variant mt-1">
        {before}
        <mark className="bg-transparent text-primary font-bold">{match}</mark>
        {after}
      </p>
    </button>
  );
}
