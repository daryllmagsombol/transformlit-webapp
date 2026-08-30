import { flattenVerseText, mapWordSpans, hasWordAnnotations } from './words';
import type { BibleChapter, ChapterWord } from './types';

const verseContent = [
  'In the beginning was the Word, and the Word was with God, and the Word was God.',
];

describe('flattenVerseText', () => {
  it('joins strings and formatted text, skipping footnote refs and line breaks', () => {
    const content = [
      'Hello ',
      { text: 'world', wordsOfJesus: true },
      { noteId: 0 },
      { lineBreak: true },
      '!',
    ];
    expect(flattenVerseText(content as never[])).toBe('Hello world!');
  });
});

describe('mapWordSpans', () => {
  it('maps contentIndex/start/end offsets onto the flattened verse text', () => {
    const words: ChapterWord[] = [
      { contentIndex: 0, start: 0, end: 2, strongs: ['G1722'], lemma: 'ἐν' },
      { contentIndex: 0, start: 3, end: 6, strongs: ['G0746'], lemma: 'ἀρχή' },
    ];
    const spans = mapWordSpans(verseContent as never[], words);
    expect(spans).toHaveLength(2);
    expect(flattenVerseText(verseContent as never[]).slice(spans[0].start, spans[0].end)).toBe('In');
    expect(spans[0].word.strongs).toEqual(['G1722']);
    expect(flattenVerseText(verseContent as never[]).slice(spans[1].start, spans[1].end)).toBe('the');
  });

  it('ignores words whose contentIndex is out of range', () => {
    const words: ChapterWord[] = [{ contentIndex: 5, start: 0, end: 2 }];
    expect(mapWordSpans(verseContent as never[], words)).toEqual([]);
  });
});

describe('hasWordAnnotations', () => {
  it('detects support via thisChapterWordsLink', () => {
    const chapter = { thisChapterWordsLink: '/api/ENGWEBP/JHN/1.words.json' } as BibleChapter;
    expect(hasWordAnnotations(chapter)).toBe(true);
    expect(hasWordAnnotations({} as BibleChapter)).toBe(false);
  });
});