import { render, screen } from '@testing-library/react';
import { BookGrid } from './book-grid';
import type { TranslationBook } from '../../lib/bible/types';

const books: TranslationBook[] = [
  { id: 'GEN', name: 'Genesis', commonName: 'Genesis', title: null, order: 1, numberOfChapters: 50, firstChapterNumber: 1, lastChapterNumber: 50, totalNumberOfVerses: 1533 },
  { id: 'MAT', name: 'Matthew', commonName: 'Matthew', title: null, order: 40, numberOfChapters: 28, firstChapterNumber: 1, lastChapterNumber: 28, totalNumberOfVerses: 1071 },
];

describe('BookGrid', () => {
  it('renders OT and NT sections and links to the reader', () => {
    render(<BookGrid books={books} translation="BSB" loading={false} />);
    expect(screen.getByText('Old Testament')).toBeInTheDocument();
    expect(screen.getByText('New Testament')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Genesis/ });
    expect(link).toHaveAttribute('href', '/bible/BSB/GEN/1');
  });
});
