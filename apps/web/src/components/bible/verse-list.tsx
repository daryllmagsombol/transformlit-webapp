'use client';

import { Fragment } from 'react';
import type {
  ChapterContent,
  ChapterFootnote,
  ChapterWord,
  ChapterWords,
  FormattedText,
  InlineHeading,
  VerseFootnoteReference,
} from '../../lib/bible/types';
import { mapWordSpans, type VerseContentItem } from '../../lib/bible/words';

interface VerseListProps {
  readonly content: ChapterContent[];
  readonly footnotes: ChapterFootnote[];
  readonly words?: ChapterWords;
  readonly selectedVerse?: number | null;
  readonly highlightedVerse?: number | null;
  readonly activeWord?: { verse: number; word: ChapterWord } | null;
  readonly onVerseClick?: (verse: number) => void;
  readonly onFootnoteClick?: (note: ChapterFootnote) => void;
  readonly onWordClick?: (verse: number, word: ChapterWord) => void;
}

const WORD_BUTTON_CLASS =
  'inline-target underline decoration-dotted underline-offset-2 text-primary';
const ACTIVE_WORD_BUTTON_CLASS =
  'inline-target underline decoration-dotted underline-offset-2 text-on-primary-container bg-primary-container/40 rounded';

/** True when `span` is the exact word the study sheet is focused on. */
function isActiveSpan(
  span: ReturnType<typeof mapWordSpans>[number],
  verseNumber: number,
  activeWord: VerseListProps['activeWord'],
): boolean {
  if (!activeWord || activeWord.verse !== verseNumber) return false;
  const target = activeWord.word;
  return (
    span.word.contentIndex === target.contentIndex &&
    span.word.start === target.start &&
    span.word.end === target.end
  );
}

const POEM_INDENTS = ['pl-0', 'pl-2', 'pl-4', 'pl-6', 'pl-8'];

/** Cumulative text length of content items before `index` (matches words.ts baseAt math). */
function baseAt(content: VerseContentItem[], index: number): number {
  let total = 0;
  for (let i = 0; i < index; i++) {
    const item = content[i];
    if (typeof item === 'string') total += item.length;
    else if (item && 'text' in item && typeof item.text === 'string')
      total += item.text.length;
    else if (item && 'heading' in item && typeof item.heading === 'string')
      total += item.heading.length;
    // Note: `in` checks on discriminated unions narrow the type without `as`.
  }
  return total;
}

function renderInline(
  item: InlineHeading | VerseFootnoteReference,
  footnoteCaller: (noteId: number) => string,
  key: number,
  onFootnoteClick?: (note: ChapterFootnote) => void,
) {
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
  return <span key={key} className="font-display font-bold">{item.heading}</span>;
}

function renderWordSpans(
  text: string,
  pieceStart: number,
  spans: ReturnType<typeof mapWordSpans>,
  verseNumber: number,
  onWordClick?: (verse: number, word: ChapterWord) => void,
  activeWord?: VerseListProps['activeWord'],
) {
  const pieceSpans = spans.filter(
    (s) => s.start >= pieceStart && s.end <= pieceStart + text.length,
  );
  if (pieceSpans.length === 0) return text;
  let cursor = 0;
  return (
    <>
      {pieceSpans.map((span) => {
        const isActive = isActiveSpan(span, verseNumber, activeWord);
        const el = (
          <Fragment key={`span-${span.start}-${span.end}`}>
            {text.slice(cursor, span.start - pieceStart)}
            <button
              type="button"
              className={isActive ? ACTIVE_WORD_BUTTON_CLASS : WORD_BUTTON_CLASS}
              aria-pressed={isActive}
              onClick={() => onWordClick?.(verseNumber, span.word)}
            >
              {text.slice(span.start - pieceStart, span.end - pieceStart)}
            </button>
          </Fragment>
        );
        cursor = span.end - pieceStart;
        return el;
      })}
      {text.slice(cursor)}
    </>
  );
}

function buildFormattedClassName(formatted: FormattedText): string {
  return [
    formatted.poem ? POEM_INDENTS[Math.min(formatted.poem, POEM_INDENTS.length - 1)] : '',
    formatted.wordsOfJesus ? 'text-brand-orange-dark dark:text-primary-fixed' : '',
  ]
    .filter(Boolean)
    .join(' ');
}

export function VerseList({
  content,
  footnotes,
  words,
  selectedVerse,
  highlightedVerse,
  activeWord,
  onVerseClick,
  onFootnoteClick,
  onWordClick,
}: VerseListProps) {
  const callerFor = (noteId: number): string => {
    const note = footnotes.find((f) => f.noteId === noteId);
    if (!note) return '';
    if (note.caller === '+' || note.caller === null) return String.fromCodePoint(97 + noteId);
    return note.caller;
  };

  return (
    <div className="font-body text-body leading-relaxed text-on-surface space-y-4">
      {content.map((item) => {
        if (item.type === 'heading') {
          return (
            <h2 key={`heading-${item.content.join(' ')}`} className="font-display text-headline-h3 font-bold text-on-surface pt-4 text-center">
              {item.content.join(' ')}
            </h2>
          );
        }
        if (item.type === 'line_break') return <div key={`lb-${item.type}`} className="h-3" />;
        if (item.type === 'hebrew_subtitle') {
          const subtitleText = item.content
            .map((piece) => {
              if (typeof piece === 'string') return piece;
              if ('text' in piece) return piece.text;
              return '';
            })
            .join(' ');
          return (
            <p key={`subtitle-${subtitleText}`} className="italic text-on-surface-variant text-center text-small">
              {subtitleText}
            </p>
          );
        }

        const verseWords = words?.verses?.[String(item.number)];
        const spans = verseWords ? mapWordSpans(item.content, verseWords) : [];

        const isSelected = selectedVerse === item.number;
        const isHighlighted = highlightedVerse === item.number;

        return (
          <div
            key={`verse-${item.number}`}
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
              {item.content.map((piece) => {
                // typeof guard FIRST — `in` on a string primitive throws TypeError
                if (typeof piece === 'string') {
                  const text = piece;
                  const pieceIndex = item.content.indexOf(piece);
                  const pieceStart = baseAt(item.content, pieceIndex);
                  return (
                    <Fragment key={`text-${text.slice(0, 30)}`}>
                      {renderWordSpans(text, pieceStart, spans, item.number, onWordClick, activeWord)}
                    </Fragment>
                  );
                }
                if ('lineBreak' in piece) return <br key={`br-${item.content.indexOf(piece)}`} />;
                if ('noteId' in piece) {
                  return renderInline(piece, callerFor, item.content.indexOf(piece), onFootnoteClick);
                }
                if ('heading' in piece) {
                  return renderInline(piece, callerFor, item.content.indexOf(piece), onFootnoteClick);
                }
                // FormattedText: wrap word spans, keep wordsOfJesus/poem styling on the wrapper
                // Type narrowed by prior guards (string, lineBreak, noteId, heading)
                const text = piece.text;
                const pieceIndex = item.content.indexOf(piece);
                const pieceStart = baseAt(item.content, pieceIndex);
                const className = buildFormattedClassName(piece);
                return (
                  <span key={`formatted-${text.slice(0, 30)}`} className={className}>
                    {renderWordSpans(text, pieceStart, spans, item.number, onWordClick, activeWord)}
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
