import { render, screen, fireEvent } from '@testing-library/react';
import { ReadingProgressCard } from './reading-progress-card';

describe('ReadingProgressCard', () => {
  const defaultProps = {
    title: 'The Great Gatsby',
    author: 'F. Scott Fitzgerald',
    currentPage: 50,
    totalPages: 200,
    coverUrl: 'https://example.com/cover.jpg',
  };

  it('renders book title', () => {
    render(<ReadingProgressCard {...defaultProps} />);
    expect(screen.getByText('The Great Gatsby')).toBeInTheDocument();
  });

  it('renders author when provided', () => {
    render(<ReadingProgressCard {...defaultProps} />);
    expect(screen.getByText('F. Scott Fitzgerald')).toBeInTheDocument();
  });

  it('does not render author when null', () => {
    render(<ReadingProgressCard {...defaultProps} author={null} />);
    expect(screen.queryByText('F. Scott Fitzgerald')).not.toBeInTheDocument();
  });

  it('calculates and displays progress percentage', () => {
    render(<ReadingProgressCard {...defaultProps} />);
    expect(screen.getByText('25%')).toBeInTheDocument();
  });

  it('displays current page and total pages', () => {
    render(<ReadingProgressCard {...defaultProps} />);
    expect(screen.getByText('50 / 200 pages')).toBeInTheDocument();
  });

  it('renders progress bar with correct width', () => {
    const { container } = render(<ReadingProgressCard {...defaultProps} />);
    const progressBar = container.querySelector('.bg-brand-orange-dark');
    expect(progressBar).toHaveStyle({ width: '25%' });
  });

  it('renders cover image when coverUrl is provided', () => {
    render(<ReadingProgressCard {...defaultProps} />);
    const img = screen.getByAltText('The Great Gatsby');
    expect(img).toHaveAttribute('src', 'https://example.com/cover.jpg');
  });

  it('renders placeholder when no coverUrl', () => {
    render(<ReadingProgressCard {...defaultProps} coverUrl={null} />);
    expect(screen.queryByAltText('The Great Gatsby')).not.toBeInTheDocument();
    expect(screen.getByText('menu_book')).toBeInTheDocument();
  });

  it('renders Continue Reading button', () => {
    render(<ReadingProgressCard {...defaultProps} />);
    expect(screen.getByRole('button', { name: /continue reading/i })).toBeInTheDocument();
  });

  it('calls onContinue when button is clicked', () => {
    const onContinue = jest.fn();
    render(<ReadingProgressCard {...defaultProps} onContinue={onContinue} />);
    fireEvent.click(screen.getByRole('button', { name: /continue reading/i }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('handles 0 total pages without division error', () => {
    render(<ReadingProgressCard {...defaultProps} totalPages={0} />);
    expect(screen.getByText('0%')).toBeInTheDocument();
  });

  it('rounds percentage correctly', () => {
    render(<ReadingProgressCard {...defaultProps} currentPage={1} totalPages={3} />);
    expect(screen.getByText('33%')).toBeInTheDocument();
  });

  it('shows 100% when currentPage equals totalPages', () => {
    render(<ReadingProgressCard {...defaultProps} currentPage={200} totalPages={200} />);
    expect(screen.getByText('100%')).toBeInTheDocument();
  });
});
