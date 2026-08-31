import type { Metadata } from 'next';
import { getBookName, findCuratedTranslation } from '../../../../../../lib/bible/config';
import BibleReaderClient from './bible-reader-client';

interface PageProps {
  params: Promise<{ translation: string; book: string; chapter: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { translation, book, chapter } = await params;
  const t = findCuratedTranslation(translation);
  return {
    title: `${getBookName(book.toUpperCase())} ${Number(chapter)} — ${t?.label ?? translation} — Transformlit`,
  };
}

export default async function ReaderRoute({ params }: PageProps) {
  const { translation, book, chapter } = await params;
  const t = findCuratedTranslation(translation);
  return (
    <BibleReaderClient
      translation={t?.id ?? translation}
      book={book.toUpperCase()}
      chapter={Number(chapter)}
    />
  );
}
