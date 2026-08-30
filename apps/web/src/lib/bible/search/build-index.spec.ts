import { buildIndex } from './build-index';
import type { CompleteTranslation } from '../types';

const complete: CompleteTranslation = {
  translation: { id: 'BSB', name: 'Berean Standard Bible', shortName: 'BSB' },
  books: [
    {
      id: 'JHN',
      commonName: 'John',
      order: 43,
      numberOfChapters: 1,
      totalNumberOfVerses: 1,
      chapters: [
        {
          chapter: {
            number: 1,
            content: [
              { type: 'verse', number: 1, content: ['In the beginning was the Word, and the Word was God.'] },
              { type: 'verse', number: 2, content: ['The same was in the beginning with God.'] },
            ],
          },
        },
      ],
    },
  ],
};

describe('buildIndex', () => {
  it('flattens verses into a searchable corpus with parallel refs', () => {
    const corpus = buildIndex(complete);
    expect(corpus.verses).toEqual([
      'In the beginning was the Word, and the Word was God.',
      'The same was in the beginning with God.',
    ]);
    expect(corpus.refs).toEqual([
      { b: 'JHN', c: 1, v: 1 },
      { b: 'JHN', c: 1, v: 2 },
    ]);
  });

  it('skips headings and line breaks', () => {
    const withHeading: CompleteTranslation = {
      ...complete,
      books: [
        {
          ...complete.books[0],
          chapters: [
            { chapter: { number: 1, content: [{ type: 'heading', content: ['Prologue'] }, { type: 'line_break' }, { type: 'verse', number: 1, content: ['Verse one.'] }] } },
          ],
        },
      ],
    };
    const corpus = buildIndex(withHeading);
    expect(corpus.verses).toEqual(['Verse one.']);
  });
});