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
    expect(onWordClick).toHaveBeenCalledWith(1, expect.objectContaining({ strongs: ['G3870'] }));
  });

  it('calls onFootnoteClick when a footnote marker is tapped', () => {
    const onFootnoteClick = jest.fn();
    render(
      <VerseList
        content={content}
        footnotes={footnotes}
        words={undefined}
        onVerseClick={() => {}}
        onFootnoteClick={onFootnoteClick}
      />,
    );
    fireEvent.click(screen.getByLabelText('Footnote 0'));
    expect(onFootnoteClick).toHaveBeenCalledWith(expect.objectContaining({ noteId: 0 }));
  });

  it('uses a letter caller for plus-marked footnotes', () => {
    render(
      <VerseList
        content={content}
        footnotes={footnotes}
        words={undefined}
        onVerseClick={() => {}}
        onFootnoteClick={() => {}}
      />,
    );
    // noteId 0 with caller '+' renders as the first letter of the alphabet
    expect(screen.getByLabelText('Footnote 0')).toHaveTextContent('a');
  });

  it('renders a blank caller when the footnote is missing', () => {
    render(
      <VerseList
        content={[{ type: 'verse', number: 1, content: ['text', { noteId: 7 }, ' more'] }]}
        footnotes={footnotes}
        words={undefined}
        onVerseClick={() => {}}
        onFootnoteClick={() => {}}
      />,
    );
    expect(screen.getByLabelText('Footnote 7')).toHaveTextContent('');
  });

  it('renders formatted text with poem indents and words-of-Jesus styling', () => {
    const formatted: ChapterContent[] = [
      {
        type: 'verse',
        number: 2,
        content: [{ text: 'Jesus wept.', poem: 2, wordsOfJesus: true }],
      },
    ];
    render(
      <VerseList
        content={formatted}
        footnotes={[]}
        words={undefined}
        onVerseClick={() => {}}
        onFootnoteClick={() => {}}
      />,
    );
    expect(screen.getByText('Jesus wept.')).toBeInTheDocument();
  });

  it('makes words inside formatted text tappable', () => {
    const formatted: ChapterContent[] = [
      { type: 'verse', number: 2, content: [{ text: 'Jesus wept.', poem: 1 }] },
    ];
    const words: ChapterWords = {
      verses: {
        '2': [{ contentIndex: 0, start: 6, end: 10, strongs: ['G2799'], lemma: 'δακρύω', morph: 'V-2AAI-3S' }],
      },
    };
    const onWordClick = jest.fn();
    render(
      <VerseList
        content={formatted}
        footnotes={[]}
        words={words}
        onVerseClick={() => {}}
        onFootnoteClick={() => {}}
        onWordClick={onWordClick}
      />,
    );
    fireEvent.click(screen.getByText('wept'));
    expect(onWordClick).toHaveBeenCalledWith(2, expect.objectContaining({ strongs: ['G2799'] }));
  });

  it('renders hebrew subtitles and line breaks', () => {
    const mixed: ChapterContent[] = [
      { type: 'hebrew_subtitle', content: ['A Psalm of David'] },
      { type: 'line_break' },
      { type: 'verse', number: 1, content: ['Bless the Lord.'] },
    ];
    render(
      <VerseList
        content={mixed}
        footnotes={[]}
        words={undefined}
        onVerseClick={() => {}}
        onFootnoteClick={() => {}}
      />,
    );
    expect(screen.getByText('A Psalm of David')).toBeInTheDocument();
    expect(screen.getByText('Bless the Lord.')).toBeInTheDocument();
  });

  it('applies the selected-verse highlight class', () => {
    const { container } = render(
      <VerseList
        content={content}
        footnotes={footnotes}
        words={undefined}
        selectedVerse={1}
        onVerseClick={() => {}}
        onFootnoteClick={() => {}}
      />,
    );
    expect(container.querySelector('#v1')?.className).toContain('border-primary');
  });
});
