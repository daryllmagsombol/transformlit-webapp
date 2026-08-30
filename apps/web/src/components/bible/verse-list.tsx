'use client';

import { Fragment } from 'react';
import type {
  ChapterContent,
  ChapterFootnote,
  ChapterWord,
  ChapterWords,
  FormattedText,
  InlineHeading,
  InlineLineBreak,
  VerseFootnoteReference,
} from '../../lib/bible/types';
import { flattenVerseText, mapWordSpans, type VerseContentItem } from '../../lib/bible/words';

interface VerseListProps {
  content: ChapterContent[];
  footnotes: ChapterFootnote[];
  words?: ChapterWords;
  selectedVerse?: number | null;
  highlightedVerse?: number | null;
  onVerseClick?: (verse: number) => void;
  onFootnoteClick?: (note: ChapterFootnote) => void;
  onWordClick?: (verse: number, word: ChapterWord) => void;
}

const POEM_INDENTS = ['pl-0', 'pl-2', 'pl-4', 'pl-6', 'pl-8'];

/** Cumulative text length of content items before `index` (matches words.ts baseAt math). */
function baseAt(content: VerseContentItem[], index: number): number {
  let total = 0;
  for (let i = 0; i < index; i++) {
    const item = content[i];
    if (typeof item === 'string') total += item.length;
    else if (item && 'text' in item && typeof (item as FormattedText).text === 'string')
      total += (item as FormattedText).text.length;
    else if (item && 'heading' in item && typeof (item as InlineHeading).heading === 'string')
      total += (item as InlineHeading).heading.length;
  }
  return total;
}

function renderInline(
  item: string | FormattedText | InlineHeading | InlineLineBreak | VerseFootnoteReference,
  footnoteCaller: (noteId: number) => string,
  key: number,
  onFootnoteClick?: (note: ChapterFootnote) => void,
) {
  if (typeof item === 'string') return <Fragment key={key}>{item}</Fragment>;
  if ('lineBreak' in item && item.lineBreak) return <br key={key} />;
  if ('noteId' in item) {
    return (
      <sup key={key}>
        <button
          type="button"
          className="inline-target text-footnote-marker font-bold"
          aria-label={`Footnote ${item.noteId}`}
          onClick={() => onFootnoteClick?.({ noteId: item.noteId, text: '', caller: null })}
        >
          {footnoteCaller(item.noteId)}
        </button>
      </sup>
    );
  }
  if ('heading' in item) {
    return <span key={key} className="font-display font-bold">{item.heading}</span>;
  }
  const formatted = item as FormattedText;
  const className = [
    formatted.poem ? `block ${'pl-' + Math.min(formatted.poem, 4)}` : '',
    formatted.wordsOfJesus ? 'text-brand-orange-dark dark:text-primary-fixed' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <span key={key} className={className}>
      {formatted.text}
    </span>
  );
}

export function VerseList({
  content,
  footnotes,
  words,
  selectedVerse,
  highlightedVerse,
  onVerseClick,
  onFootnoteClick,
  onWordClick,
}: VerseListProps) {
  const callerFor = (noteId: number): string => {
    const note = footnotes.find((f) => f.noteId === noteId);
    if (!note) return '';
    if (note.caller === '+' || note.caller === null) return String.fromCharCode(97 + noteId);
    return note.caller;
  };

  return (
    <div className="font-body text-body leading-relaxed text-on-surface space-y-4">
      {content.map((item, i) => {
        if (item.type === 'heading') {
          return (
            <h2 key={i} className="font-display text-headline-h3 font-bold text-on-surface pt-4 text-center">
              {item.content.join(' ')}
            </h2>
          );
        }
        if (item.type === 'line_break') return <div key={i} className="h-3" />;
        if (item.type === 'hebrew_subtitle') {
          return (
            <p key={i} className="italic text-on-surface-variant text-center text-small">
              {item.content
                .map((piece) =>
                  typeof piece === 'string' ? piece : 'text' in piece ? piece.text : '',
                )
                .join(' ')}
            </p>
          );
        }

        const verseWords = words?.verses?.[String(item.number)];
        const spans = verseWords ? mapWordSpans(item.content, verseWords) : [];

        const isSelected = selectedVerse === item.number;
        const isHighlighted = highlightedVerse === item.number;

        return (
          <div
            key={i}
            id={`v${item.number}`}
            className={`flex gap-3 scroll-mt-24 rounded-lg px-3 py-2 ${
              isSelected || isHighlighted
                ? 'bg-paper-warm dark:bg-surface-raised border-l-[3px] border-primary'
                : ''
            }`}
          >
            <button
              type="button"
              className="inline-target shrink-0 text-verse-number font-body text-body font-bold select-none"
              aria-label={`Verse ${item.number}`}
              onClick={() => onVerseClick?.(item.number)}
            >
              {item.number}
            </button>
            <p className="flex-1">
              {item.content.map((piece, j) => {
                // typeof guard FIRST — `in` on a string primitive throws TypeError
                if (typeof piece === 'string') {
                  const text = piece;
                  const pieceStart = baseAt(item.content, j);
                  const pieceSpans = spans.filter(
                    (s) => s.start >= pieceStart && s.end <= pieceStart + text.length,
                  );
                  if (pieceSpans.length === 0) return text;
                  let cursor = 0;
                  return (
                    <Fragment key={j}>
                      {pieceSpans.map((span, k) => {
                        const el = (
                          <Fragment key={k}>
                            {text.slice(cursor, span.start - pieceStart)}
                            <button
                              type="button"
                              className="inline-target underline decoration-dotted underline-offset-2 text-primary"
                              onClick={() => onWordClick?.(item.number, span.word)}
                            >
                              {text.slice(span.start - pieceStart, span.end - pieceStart)}
                            </button>
                          </Fragment>
                        );
                        cursor = span.end - pieceStart;
                        return el;
                      })}
                      {text.slice(cursor)}
                    </Fragment>
                  );
                }
                if ('lineBreak' in piece) return <br key={j} />;
                if ('noteId' in piece) {
                  return renderInline(piece, callerFor, j, onFootnoteClick);
                }
                if ('heading' in piece) {
                  return renderInline(piece, callerFor, j, onFootnoteClick);
                }
                // FormattedText: wrap word spans, keep wordsOfJesus/poem styling on the wrapper
                const formatted = piece as FormattedText;
                const text = formatted.text;
                const pieceStart = baseAt(item.content, j);
                const pieceSpans = spans.filter(
                  (s) => s.start >= pieceStart && s.end <= pieceStart + text.length,
                );
                const className = [
                  formatted.poem ? POEM_INDENTS[Math.min(formatted.poem, POEM_INDENTS.length - 1)] : '',
                  formatted.wordsOfJesus ? 'text-brand-orange-dark dark:text-primary-fixed' : '',
                ]
                  .filter(Boolean)
                  .join(' ');
                let cursor = 0;
                return (
                  <span key={j} className={className}>
                    {pieceSpans.length === 0
                      ? text
                      : pieceSpans.map<React.ReactNode>((span, k) => {
                          const el = (
                            <Fragment key={k}>
                              {text.slice(cursor, span.start - pieceStart)}
                              <button
                                type="button"
                                className="inline-target underline decoration-dotted underline-offset-2 text-primary"
                                onClick={() => onWordClick?.(item.number, span.word)}
                              >
                                {text.slice(span.start - pieceStart, span.end - pieceStart)}
                              </button>
                            </Fragment>
                          );
                          cursor = span.end - pieceStart;
                          return el;
                        }).concat(text.slice(cursor))}
                  </span>
                );
              })}
            </p>
          </div>
        );
      })}
    </div>
  );
}
