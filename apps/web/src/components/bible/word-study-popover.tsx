'use client';

import type { ChapterWord } from '../../lib/bible/types';

interface WordStudyPopoverProps {
  readonly word: ChapterWord;
  readonly text: string;
}

export function WordStudyPopover({ word, text }: WordStudyPopoverProps) {
  return (
    <div className="bg-surface-container-lowest dark:bg-surface-high border border-outline-variant rounded-lg shadow-lift p-4 max-w-xs">
      <p className="font-display text-small font-bold text-on-surface">{text}</p>
      <dl className="mt-2 flex flex-col gap-1 font-micro text-micro">
        {word.lemma && (
          <div className="flex justify-between">
            <dt className="text-on-surface-variant">Lemma</dt>
            <dd className="text-on-surface">{word.lemma}</dd>
          </div>
        )}
        {word.strongs && (
          <div className="flex justify-between">
            <dt className="text-on-surface-variant">Strong&apos;s</dt>
            <dd className="text-on-surface">{word.strongs.join(', ')}</dd>
          </div>
        )}
        {word.morph && (
          <div className="flex justify-between">
            <dt className="text-on-surface-variant">Morph</dt>
            <dd className="text-on-surface">{word.morph}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}
