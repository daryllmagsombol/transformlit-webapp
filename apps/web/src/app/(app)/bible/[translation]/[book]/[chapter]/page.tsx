import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { findCuratedTranslation } from '../../../../../../lib/bible/config';
import { getBooks } from '../../../../../../lib/bible/api';
import { resolveChapterRoute } from '../../../../../../lib/bible/chapter-route';
import BibleReaderClient from './bible-reader-client';

interface PageProps {
  params: Promise<{ translation: string; book: string; chapter: string }>;
}

/**
 * Resolves + validates the dynamic route params against the curated
 * translation list and that translation's served books.json — before the
 * chapter payload (or any client fetch) is reached. Invalid translations,
 * unknown book ids, and out-of-range/non-integer chapters render 404 rather
 * than being forwarded to the Bible API as raw input. Returns null when
 * params are invalid so callers can decide (metadata omits title; the page
 * renders notFound()).
 */
async function resolveRoute(params: Awaited<PageProps['params']>) {
  const curated = findCuratedTranslation(params.translation);
  if (!curated) return null;

  const { books } = await getBooks(curated.id);
  return resolveChapterRoute(params.translation, params.book, params.chapter, books, curated);
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const resolved = await resolveRoute(await params);
  if (!resolved) return {};
  return {
    title: `${resolved.bookName} ${resolved.chapter} — ${resolved.translationLabel} — Transformlit`,
  };
}

export default async function ReaderRoute({ params }: PageProps) {
  const resolved = await resolveRoute(await params);
  if (!resolved) notFound();
  return (
    <BibleReaderClient
      translation={resolved.translation}
      book={resolved.book}
      chapter={resolved.chapter}
    />
  );
}
