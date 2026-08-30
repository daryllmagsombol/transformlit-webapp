import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useCrossReferences } from './use-cross-references';
import * as api from '../../lib/bible/api';

jest.mock('../../lib/bible/api');

function Probe({ book, chapter }: { book: string; chapter: number }) {
  const { byVerse, loading, load } = useCrossReferences(book, chapter);
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="count">{Object.keys(byVerse).length}</span>
      <button onClick={() => void load()}>load</button>
    </div>
  );
}

describe('useCrossReferences', () => {
  it('loads references grouped by verse', async () => {
    (api.getCrossReferences as jest.Mock).mockResolvedValue({
      chapter: { number: 12, content: [{ verse: 1, references: [{ book: 'ROM', chapter: 6, verse: 13 }] }] },
    });
    render(<Probe book="ROM" chapter={12} />);
    fireEvent.click(screen.getByText('load'));
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1'));
  });

  it('treats a fetch failure as empty (dataset 404s are expected)', async () => {
    (api.getCrossReferences as jest.Mock).mockRejectedValue(new Error('404'));
    render(<Probe book="ROM" chapter={12} />);
    fireEvent.click(screen.getByText('load'));
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('0'));
  });
});