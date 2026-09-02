import { render, screen, waitFor } from '@testing-library/react';
import { useChapter } from './use-chapter';
import * as api from '../../lib/bible/api';

jest.mock('../../lib/bible/api');

function Probe({ translation, book, chapter }: { translation: string; book: string; chapter: number }) {
  const { chapter: ch, words, loading } = useChapter(translation, book, chapter);
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="verses">{ch?.chapter.content.filter((c) => c.type === 'verse').length ?? 0}</span>
      <span data-testid="words">{words ? 'yes' : 'no'}</span>
    </div>
  );
}

describe('useChapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('loads a chapter and its word annotations when supported', async () => {
    (api.getChapter as jest.Mock).mockResolvedValue({
      thisChapterWordsLink: '/api/ENGWEBP/JHN/1.words.json',
      chapter: { number: 1, content: [{ type: 'verse', number: 1, content: ['x'] }], footnotes: [] },
    });
    (api.getWords as jest.Mock).mockResolvedValue({ verses: { '1': [] } });

    render(<Probe translation="ENGWEBP" book="JHN" chapter={1} />);
    await waitFor(() => expect(screen.getByTestId('verses').textContent).toBe('1'));
    await waitFor(() => expect(screen.getByTestId('words').textContent).toBe('yes'));
    expect(api.getWords).toHaveBeenCalledWith('ENGWEBP', 'JHN', 1);
  });

  it('skips words when the translation lacks annotations', async () => {
    (api.getChapter as jest.Mock).mockResolvedValue({
      chapter: { number: 1, content: [{ type: 'verse', number: 1, content: ['x'] }], footnotes: [] },
    });
    render(<Probe translation="BSB" book="JHN" chapter={1} />);
    await waitFor(() => expect(screen.getByTestId('words').textContent).toBe('no'));
    expect(api.getWords).not.toHaveBeenCalled();
  });
});