'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { useRequireAuth } from '../../../lib/hooks/use-require-auth';
import { useBibleBooks } from '../../../lib/hooks/use-bible-books';
import { useBibleStore } from '../../../store/bible-store';
import { BookGrid, TranslationPicker, SearchPanel } from '../../../components/bible';
import { LoadingSpinner } from '../../../components/ui';
import { QUICK_TRACKS, getCuratedTranslation, findCuratedTranslation, getBookName } from '../../../lib/bible/config';
import { refToHref } from '../../../lib/bible/refs';

export default function BibleClient() {
  const { isReady } = useRequireAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const view = searchParams.get('view');
  const translationParam = searchParams.get('translation');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [mode, setMode] = useState<'browse' | 'search'>(view === 'search' ? 'search' : 'browse');

  const translation = useBibleStore((s) => s.translation);
  const setTranslation = useBibleStore((s) => s.setTranslation);
  const lastPosition = useBibleStore((s) => s.lastPosition[translation]);
  const { books, loading } = useBibleBooks(translation);

  // Consume the ?translation= redirect param (canonicalized, case-insensitive)
  useEffect(() => {
    if (translationParam) {
      const curated = findCuratedTranslation(translationParam);
      if (curated) setTranslation(curated.id);
    }
  }, [translationParam, setTranslation]);

  const curated = getCuratedTranslation(translation);

  if (!isReady) return <LoadingSpinner />;

  const continueHref = lastPosition
    ? refToHref(translation, lastPosition.book, lastPosition.chapter)
    : null;

  return (
    <>
      <div className="max-w-[1200px] mx-auto px-4 md:px-5 flex flex-col gap-8">
        {/* Header */}
        <div className="flex items-center justify-between pt-2">
          <h1 className="font-display text-headline-h1 font-bold text-on-surface">Bible</h1>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-full border border-outline-variant bg-surface-container-low dark:bg-surface-raised text-small font-display font-semibold text-on-surface hover:border-primary transition-colors"
          >
            {curated?.id ?? translation} · {curated?.label ?? ''}
            <span className="material-symbols-outlined text-[18px] text-on-surface-variant">expand_more</span>
          </button>
        </div>

        {/* Continue reading */}
        {continueHref && (
          <Link
            href={continueHref}
            className="bg-paper-warm dark:bg-surface-raised border border-outline-variant rounded-xl p-6 shadow-soft flex items-center justify-between hover:border-primary transition-colors"
          >
            <div>
              <p className="font-micro text-micro uppercase tracking-[0.2em] text-brand-orange-dark mb-1">
                Continue reading
              </p>
              <p className="font-display text-headline-h3 font-bold text-on-surface">
                {getBookName(lastPosition.book)} {lastPosition.chapter}
              </p>
              <p className="font-micro text-micro text-on-surface-variant">{curated?.label}</p>
            </div>
            <span className="px-5 py-2.5 rounded-lg bg-brand-orange-dark text-on-primary font-display text-small font-bold">
              Resume
            </span>
          </Link>
        )}

        {/* Quick tracks */}
        <div className="flex flex-wrap gap-2">
          {QUICK_TRACKS.map((track) => (
            <Link
              key={track.label}
              href={refToHref(translation, track.book, track.chapter)}
              className="px-4 py-1.5 rounded-full border border-outline-variant text-small font-display text-on-surface-variant hover:border-primary hover:text-primary transition-colors"
            >
              {track.label}
            </Link>
          ))}
        </div>

        {/* Mode toggle */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setMode('browse')}
            className={`px-4 py-2 rounded-lg font-display text-small font-bold transition-colors ${
              mode === 'browse'
                ? 'bg-primary-container/25 text-on-primary-container border border-primary/40'
                : 'border border-outline-variant text-on-surface-variant'
            }`}
          >
            Browse
          </button>
          <button
            type="button"
            onClick={() => setMode('search')}
            className={`px-4 py-2 rounded-lg font-display text-small font-bold transition-colors ${
              mode === 'search'
                ? 'bg-primary-container/25 text-on-primary-container border border-primary/40'
                : 'border border-outline-variant text-on-surface-variant'
            }`}
          >
            Search
          </button>
        </div>

        {mode === 'search' ? (
          <SearchPanel
            translation={translation}
            onResult={(href) => {
              // router push preserves SPA state + the api module cache; hash scroll runs post-load in the reader
              router.push(href);
            }}
          />
        ) : (
          <BookGrid books={books} translation={translation} loading={loading} />
        )}
      </div>

      <TranslationPicker open={pickerOpen} onClose={() => setPickerOpen(false)} />
    </>
  );
}
