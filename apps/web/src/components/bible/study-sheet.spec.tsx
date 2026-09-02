import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { StudySheet } from './study-sheet';

jest.mock('../../lib/hooks/use-cross-references', () => ({
  useCrossReferences: () => ({ byVerse: {}, loading: false, load: jest.fn() }),
}));

jest.mock('../../components/ui/toast', () => ({
  useToast: () => ({ addToast: jest.fn() }),
}));

const footnotes = [{ noteId: 0, text: 'Cited in Romans 6:13', caller: 'a' }];

describe('StudySheet', () => {
  it('shows verse, footnotes, and the empty cross-reference state', async () => {
    render(
      <StudySheet
        open
        onClose={() => {}}
        verse={1}
        verseText="Therefore I urge you, brothers…"
        footnotes={footnotes}
        wordsForVerse={[]}
        translation="BSB"
        book="ROM"
        chapter={12}
        bookName="Romans"
        onNavigate={() => {}}
      />,
    );
    expect(screen.getByText('Romans 12:1')).toBeInTheDocument();
    expect(screen.getByText('Cited in Romans 6:13')).toBeInTheDocument();
    expect(screen.getByText('No cross-references for this verse.')).toBeInTheDocument();
  });

  it('navigates when a cross-reference chip is tapped', () => {
    const onNavigate = jest.fn();
    jest.spyOn(require('../../lib/hooks/use-cross-references'), 'useCrossReferences').mockReturnValue({
      byVerse: {
        1: [
          { book: 'ROM', chapter: 6, verse: 13, score: 1 },
          { book: 'HEB', chapter: 13, verse: 15, endVerse: 16, score: 0.5 },
        ],
      },
      loading: false,
      load: jest.fn(),
    });
    render(
      <StudySheet
        open
        onClose={() => {}}
        verse={1}
        verseText="text"
        footnotes={footnotes}
        wordsForVerse={[]}
        translation="BSB"
        book="ROM"
        chapter={12}
        bookName="Romans"
        onNavigate={onNavigate}
      />,
    );
    fireEvent.click(screen.getByText('Romans 6:13'));
    expect(onNavigate).toHaveBeenCalledWith('/bible/BSB/ROM/6#v13');
  });

  it('shows the word study popover when a word is active', () => {
    render(
      <StudySheet
        open
        onClose={() => {}}
        verse={1}
        verseText="Therefore I urge you, brothers…"
        footnotes={footnotes}
        wordsForVerse={[{ contentIndex: 0, start: 12, end: 16, strongs: ['G3870'], lemma: 'παρακαλέω', morph: 'V-PPA' }]}
        translation="ENGWEBP"
        book="ROM"
        chapter={12}
        bookName="Romans"
        onNavigate={() => {}}
        activeWord={{ contentIndex: 0, start: 12, end: 16, strongs: ['G3870'], lemma: 'παρακαλέω', morph: 'V-PPA' }}
        activeWordText="urge"
      />,
    );
    expect(screen.getByText('urge')).toBeInTheDocument();
    expect(screen.getByText('Lemma')).toBeInTheDocument();
    expect(screen.getByText('G3870')).toBeInTheDocument();
    expect(screen.getByText('V-PPA')).toBeInTheDocument();
  });

  it('shows the hint text when words exist but none is active', () => {
    render(
      <StudySheet
        open
        onClose={() => {}}
        verse={1}
        verseText="text"
        footnotes={footnotes}
        wordsForVerse={[{ contentIndex: 0, start: 0, end: 4, strongs: ['G1234'], lemma: 'λόγος' }]}
        translation="ENGWEBP"
        book="ROM"
        chapter={12}
        bookName="Romans"
        onNavigate={() => {}}
      />,
    );
    expect(screen.getByText(/Tap a highlighted word/)).toBeInTheDocument();
  });
});
