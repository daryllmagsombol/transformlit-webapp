'use client';

import { useBibleSearch } from '../../lib/hooks/use-bible-search';
import { SearchResultItem } from './search-result-item';

interface SearchPanelProps {
  readonly translation: string;
  readonly onResult: (href: string) => void;
}

export function SearchPanel({ translation, onResult }: SearchPanelProps) {
  const { query, setQuery, results, indexing, progress, error, ensureIndex } = useBibleSearch(translation);

  return (
    <div className="flex flex-col gap-4">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => {
          void ensureIndex();
        }}
        className="input"
        placeholder="Search the Bible…"
        aria-label="Search the Bible"
      />

      {indexing && (
        <div className="bg-surface-container-low dark:bg-surface-raised rounded-lg p-4">
          <p className="font-display text-small font-semibold text-on-surface">
            Preparing {translation} for search…
          </p>
          <div className="mt-2 h-2 rounded-full bg-outline-variant overflow-hidden">
            <div
              className="h-full bg-primary transition-[width] duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="font-micro text-micro text-on-surface-variant mt-1">
            One-time setup — stored locally on your device.
          </p>
        </div>
      )}

      {error && <p className="text-error text-small">{error}</p>}

      {indexing === false && query.trim() && results.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="font-micro text-micro text-on-surface-variant">
            {results.length} match{results.length === 1 ? '' : 'es'} in {translation}
          </p>
          {results.map((r) => (
            <SearchResultItem key={`${r.b}-${r.c}-${r.v}`} result={r} translation={translation} onNavigate={onResult} />
          ))}
        </div>
      )}

      {indexing === false && query.trim() && results.length === 0 && error === null && (
        <p className="text-on-surface-variant text-small">No matches.</p>
      )}
    </div>
  );
}
