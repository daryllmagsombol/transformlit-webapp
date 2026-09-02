import { render, screen, fireEvent } from '@testing-library/react';
import { CategoryChip } from './category-chip';

describe('CategoryChip', () => {
  it('renders label text', () => {
    render(<CategoryChip label="Fiction" icon="book" />);
    expect(screen.getByText('Fiction')).toBeInTheDocument();
  });

  it('renders icon', () => {
    render(<CategoryChip label="Fiction" icon="menu_book" />);
    expect(screen.getByText('menu_book')).toBeInTheDocument();
  });

  it('renders as a button', () => {
    render(<CategoryChip label="Fiction" icon="book" />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('calls onClick when clicked', () => {
    const onClick = jest.fn();
    render(<CategoryChip label="Fiction" icon="book" onClick={onClick} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('applies active styling when active', () => {
    const { container } = render(<CategoryChip label="Fiction" icon="book" active />);
    const button = container.firstChild as HTMLElement;
    expect(button).toHaveClass('bg-brand-orange-dark');
    expect(button).toHaveClass('text-white');
  });

  it('applies inactive styling when not active', () => {
    const { container } = render(<CategoryChip label="Fiction" icon="book" />);
    const button = container.firstChild as HTMLElement;
    expect(button).toHaveClass('bg-paper-warm');
    expect(button).toHaveClass('text-on-surface-variant');
  });

  it('defaults to inactive when active prop is not provided', () => {
    const { container } = render(<CategoryChip label="Fiction" icon="book" />);
    const button = container.firstChild as HTMLElement;
    expect(button).not.toHaveClass('bg-brand-orange-dark');
  });
});
