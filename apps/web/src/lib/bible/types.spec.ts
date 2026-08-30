import type {
  ChapterContent,
  FormattedText,
  VerseFootnoteReference,
} from './types';

describe('bible types', () => {
  it('discriminates chapter content by type', () => {
    const heading: ChapterContent = { type: 'heading', content: ['The Creation'] };
    const verse: ChapterContent = { type: 'verse', number: 1, content: ['In the beginning…'] };
    expect(heading.type).toBe('heading');
    expect(verse.type).toBe('verse');
  });

  it('typed-formatted text and footnote reference members exist', () => {
    const formatted: FormattedText = { text: 'God said', wordsOfJesus: true };
    const ref: VerseFootnoteReference = { noteId: 0 };
    expect(formatted.wordsOfJesus).toBe(true);
    expect(ref.noteId).toBe(0);
  });
});