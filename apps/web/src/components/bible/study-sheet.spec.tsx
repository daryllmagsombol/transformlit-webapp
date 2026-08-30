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
});
