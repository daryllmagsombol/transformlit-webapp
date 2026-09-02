import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { Card } from './card';

describe('Card', () => {
  it('renders children', () => {
    render(<Card>Card content</Card>);
    expect(screen.getByText('Card content')).toBeInTheDocument();
  });

  it('applies card base class', () => {
    const { container } = render(<Card>Content</Card>);
    expect(container.firstChild).toHaveClass('card');
  });

  it('applies custom className', () => {
    const { container } = render(<Card className="custom-class">Content</Card>);
    expect(container.firstChild).toHaveClass('card');
    expect(container.firstChild).toHaveClass('custom-class');
  });

  it('passes through additional props', () => {
    render(<Card data-testid="card">Content</Card>);
    expect(screen.getByTestId('card')).toBeInTheDocument();
  });

  describe('forwardRef', () => {
    it('forwards ref to the div element', () => {
      const ref = createRef<HTMLDivElement>();
      render(<Card ref={ref}>Content</Card>);
      expect(ref.current).toBeInstanceOf(HTMLDivElement);
      expect(ref.current?.tagName).toBe('DIV');
    });
  });
});
