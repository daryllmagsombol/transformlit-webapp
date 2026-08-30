'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { Modal } from '../ui/modal';
import { isOldTestament } from '../../lib/bible/refs';
import type { TranslationBook } from '../../lib/bible/types';

interface BookChapterPickerProps {
  open: boolean;
  onClose: () => void;
  books: TranslationBook[];
  translation: string;
  bookId: string;
  chapter: number;
}

export function BookChapterPicker({ open, onClose, books, translation, bookId, chapter }: BookChapterPickerProps) {
  const bookRefs = useRef(new Map<string, HTMLButtonElement | null>());

  useEffect(() => {
    if (open) {
      const el = bookRefs.current.get(bookId);
      el?.scrollIntoView({ block: 'center' });
    }
  }, [open, bookId]);

  const current = books.find((b) => b.id === bookId);

  return (
    <Modal open={open} onClose={onClose} title="Choose a Chapter">
      <div className="grid grid-cols-[2fr_3fr] gap-4">
        <div className="max-h-[50dvh] overflow-y-auto custom-scrollbar flex flex-col">
          {(['Old Testament', 'New Testament'] as const).map((label) => {
            const list = books.filter((b) => (label === 'Old Testament' ? isOldTestament(b) : !isOldTestament(b)));
            return (
              <div key={label}>
                <p className="font-micro text-micro uppercase tracking-[0.2em] text-on-surface-variant sticky top-0 bg-surface py-1">
                  {label}
                </p>
                {list.map((b) => (
                  <button
                    key={b.id}
                    ref={(el) => {
                      bookRefs.current.set(b.id, el);
                    }}
                    type="button"
                    className={`w-full text-left px-3 py-2 rounded text-small font-display ${
                      b.id === bookId
                        ? 'bg-primary-container/25 border-l-[3px] border-primary text-on-surface font-bold'
                        : 'text-on-surface-variant hover:bg-surface-container-high'
                    }`}
                  >
                    {b.commonName}
                  </button>
                ))}
              </div>
            );
          })}
        </div>

        <div>
          <p className="font-display text-headline-h4 text-on-surface mb-3">
            {current?.commonName ?? bookId}
          </p>
          <div className="grid grid-cols-4 gap-2">
            {Array.from({ length: current?.numberOfChapters ?? 0 }, (_, i) => i + 1).map((c) => (
              <Link
                key={c}
                href={`/bible/${translation}/${bookId}/${c}`}
                onClick={onClose}
                className={`inline-flex items-center justify-center h-11 rounded text-small font-display border transition-colors ${
                  c === chapter
                    ? 'bg-brand-orange-dark text-on-primary border-brand-orange-dark'
                    : 'border-outline-variant text-on-surface-variant hover:border-primary'
                }`}
              >
                {c}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
