'use client';

import { useCallback, useEffect } from 'react';
import { Sheet } from '../ui/sheet';
import { useToast } from '../ui/toast';
import { CrossRefList } from './cross-ref-list';
import { WordStudyPopover } from './word-study-popover';
import { useCrossReferences } from '../../lib/hooks/use-cross-references';
import type { ChapterFootnote, ChapterWord, CrossRefReference } from '../../lib/bible/types';

interface StudySheetProps {
  open: boolean;
  onClose: () => void;
  verse: number | null;
  verseText: string;
  footnotes: ChapterFootnote[];
  wordsForVerse: ChapterWord[];
  translation: string;
  book: string;
  chapter: number;
  bookName: string;
  onNavigate: (href: string) => void;
  activeWord?: ChapterWord | null;
  activeWordText?: string;
}

export function StudySheet({
  open,
  onClose,
  verse,
  verseText,
  footnotes,
  wordsForVerse,
  translation,
  book,
  chapter,
  bookName,
  onNavigate,
  activeWord = null,
  activeWordText = '',
}: StudySheetProps) {
  const { addToast } = useToast();
  const { byVerse, load } = useCrossReferences(book, chapter);

  useEffect(() => {
    if (open && verse !== null) load();
  }, [open, verse, load]);

  const crossRefs: CrossRefReference[] = verse !== null ? (byVerse[verse] ?? []) : [];

  const reference = verse === null ? bookName : `${bookName} ${chapter}:${verse}`;

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(`${verseText} (${reference})`);
      addToast('Copied.', 'success');
    } catch {
      addToast('Copy failed.', 'error');
    }
  }, [verseText, reference, addToast]);

  return (
    <Sheet open={open} onClose={onClose} title="Study" side="right">
      <div className="flex flex-col gap-5">
        <p className="font-display text-headline-h4 text-on-surface">{reference}</p>

        <blockquote className="font-body text-body text-on-surface border-l-[3px] border-primary pl-4 italic">
          {verseText}
        </blockquote>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={copy}
            className="flex-1 py-2.5 rounded-lg border-2 border-brand text-brand dark:text-primary dark:border-primary font-display text-small font-bold hover:bg-brand hover:text-ink-black dark:hover:bg-primary dark:hover:text-on-primary transition-colors"
          >
            Copy
          </button>
        </div>

        {footnotes.length > 0 && (
          <section>
            <h3 className="font-display text-headline-h4 text-on-surface mb-2">Footnotes</h3>
            <ul className="flex flex-col gap-2">
              {footnotes.map((note) => (
                <li key={note.noteId} className="font-body text-small text-on-surface-variant">
                  <span className="font-bold text-footnote-marker">{note.caller ?? ''}</span>{' '}
                  {note.text}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h3 className="font-display text-headline-h4 text-on-surface mb-2">Cross-references</h3>
          <CrossRefList refs={crossRefs} translation={translation} onNavigate={onNavigate} />
        </section>

        {wordsForVerse.length > 0 && (
          <section>
            <h3 className="font-display text-headline-h4 text-on-surface mb-2">Word study</h3>
            {activeWord ? (
              <WordStudyPopover word={activeWord} text={activeWordText} />
            ) : (
              <p className="text-on-surface-variant text-small">
                Tap a highlighted word in the verse to see its lemma, Strong&apos;s number, and morphology.
              </p>
            )}
          </section>
        )}
      </div>
    </Sheet>
  );
}
