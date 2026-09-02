import { render, screen, waitFor } from '@testing-library/react';
import { useBibleBooks } from './use-bible-books';
import * as api from '../../lib/bible/api';

jest.mock('../../lib/bible/api');

function Probe({ translation }: { translation: string }) {
  const { books, loading } = useBibleBooks(translation);
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="count">{books.length}</span>
    </div>
  );
}

describe('useBibleBooks', () => {
  it('loads books for the translation', async () => {
    (api.getBooks as jest.Mock).mockResolvedValue({ books: [{ id: 'GEN', commonName: 'Genesis' }] });
    render(<Probe translation="BSB" />);
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1'));
  });
});