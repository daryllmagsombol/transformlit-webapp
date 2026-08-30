import { render, screen, fireEvent } from '@testing-library/react';
import { VerseList } from './verse-list';
import type { ChapterContent, ChapterFootnote, ChapterWords } from '../../lib/bible/types';

const content: ChapterContent[] = [
  { type: 'heading', content: ['Living Sacrifices'] },
  { type: 'line_break' },
  {
    type: 'verse',
    number: 1,
    content: ['Therefore I urge you, brothers', { noteId: 0 }, ', by the mercies of God.'],
  },
];

const footnotes: ChapterFootnote[] = [
  { noteId: 0, text: 'Cited in Romans 6:13', caller: '+' },
];

describe('VerseList', () => {
  it('renders headings and verses with inline footnote markers', () => {
    render(
      <VerseList
        content={content}
        footnotes={footnotes}
        words={undefined}
        onVerseClick={() => {}}
        onFootnoteClick={() => {}}
      />,
    );
    expect(screen.getByText('Living Sacrifices')).toBeInTheDocument();
    expect(screen.getByText(/Therefore I urge you/)).toBeInTheDocument();
    expect(screen.getByLabelText('Footnote 0')).toBeInTheDocument();
  });

  it('calls onVerseClick when a verse number is tapped', () => {
    const onVerseClick = jest.fn();
    render(
      <VerseList
        content={content}
        footnotes={footnotes}
        words={undefined}
        onVerseClick={onVerseClick}
        onFootnoteClick={() => {}}
      />,
    );
    fireEvent.click(screen.getByLabelText('Verse 1'));
    expect(onVerseClick).toHaveBeenCalledWith(1);
  });

  it('renders tappable word spans when words are provided', () => {
    const words: ChapterWords = {
      verses: {
        '1': [{ contentIndex: 0, start: 12, end: 16, strongs: ['G3870'], lemma: 'παρακαλέω' }],
      },
    };
    const onWordClick = jest.fn();
    render(
      <VerseList
        content={content}
        footnotes={footnotes}
        words={words}
        onVerseClick={() => {}}
        onFootnoteClick={() => {}}
        onWordClick={onWordClick}
      />,
    );
    fireEvent.click(screen.getByText('urge'));
    expect(onWordClick).toHaveBeenCalled();
  });
});
