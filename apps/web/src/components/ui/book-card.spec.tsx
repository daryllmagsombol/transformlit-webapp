import { render, screen, fireEvent } from '@testing-library/react';
import { BookCard, BookCardSkeleton } from './book-card';
import type { GraphQLBook } from '@transformlit/shared';

function makeBook(overrides: Partial<GraphQLBook> = {}): GraphQLBook {
  return {
    id: 'book-1',
    title: 'Test Book Title',
    author: 'Test Author',
    coverUrl: 'https://example.com/cover.jpg',
    accessLevel: 'FREE',
    status: 'PUBLISHED',
    createdAt: '2024-01-01',
    ...overrides,
  };
}

describe('BookCard', () => {
  it('renders book title', () => {
    render(<BookCard book={makeBook()} />);
    expect(screen.getByText('Test Book Title')).toBeInTheDocument();
  });

  it('renders book author', () => {
    render(<BookCard book={makeBook()} />);
    expect(screen.getByText('Test Author')).toBeInTheDocument();
  });

  it('renders cover image when coverUrl is provided', () => {
    render(<BookCard book={makeBook()} />);
    const img = screen.getByAltText('Test Book Title');
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('src', 'https://example.com/cover.jpg');
  });

  it('renders placeholder icon when no coverUrl', () => {
    render(<BookCard book={makeBook({ coverUrl: null })} />);
    expect(screen.queryByAltText('Test Book Title')).not.toBeInTheDocument();
    expect(screen.getByText('menu_book')).toBeInTheDocument();
  });

  it('renders Community badge for FREE books', () => {
    render(<BookCard book={makeBook({ accessLevel: 'FREE' })} />);
    expect(screen.getByText('Community')).toBeInTheDocument();
    expect(screen.getByText('Community Library')).toBeInTheDocument();
  });

  it('renders Premium badge for non-FREE books', () => {
    render(<BookCard book={makeBook({ accessLevel: 'RESTRICTED' })} />);
    const premiumElements = screen.getAllByText('Premium');
    expect(premiumElements.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Premium Collection')).toBeInTheDocument();
  });

  it('renders FREE label and Read button for free books', () => {
    render(<BookCard book={makeBook({ accessLevel: 'FREE' })} />);
    expect(screen.getByText('FREE')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /read/i })).toBeInTheDocument();
  });

  it('renders price label and Buy button for paid books', () => {
    render(<BookCard book={makeBook({ accessLevel: 'RESTRICTED', price: 9.99, currency: '$' })} />);
    expect(screen.getByText('$9.99')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /buy/i })).toBeInTheDocument();
  });

  it('renders "Premium" label when paid book has no price', () => {
    render(<BookCard book={makeBook({ accessLevel: 'RESTRICTED', price: null })} />);
    const premiumLabels = screen.getAllByText('Premium');
    expect(premiumLabels.length).toBeGreaterThanOrEqual(1);
  });

  it('calls onRead when Read button is clicked', () => {
    const onRead = jest.fn();
    render(<BookCard book={makeBook({ accessLevel: 'FREE' })} onRead={onRead} />);
    fireEvent.click(screen.getByRole('button', { name: /read/i }));
    expect(onRead).toHaveBeenCalledTimes(1);
  });

  it('calls onBuy when Buy button is clicked', () => {
    const onBuy = jest.fn();
    render(<BookCard book={makeBook({ accessLevel: 'RESTRICTED', price: 5 })} onBuy={onBuy} />);
    fireEvent.click(screen.getByRole('button', { name: /buy/i }));
    expect(onBuy).toHaveBeenCalledTimes(1);
  });

  it('does not render author when author is null', () => {
    render(<BookCard book={makeBook({ author: null })} />);
    expect(screen.queryByText('Test Author')).not.toBeInTheDocument();
  });
});

describe('BookCardSkeleton', () => {
  it('renders without crashing', () => {
    const { container } = render(<BookCardSkeleton />);
    expect(container.firstChild).toBeInTheDocument();
  });
});
