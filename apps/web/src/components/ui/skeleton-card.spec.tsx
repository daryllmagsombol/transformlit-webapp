import { render } from '@testing-library/react';
import { SkeletonCard } from './skeleton-card';

describe('SkeletonCard', () => {
  it('renders skeleton structure with animate-pulse', () => {
    const { container } = render(<SkeletonCard />);
    const root = container.firstChild as HTMLElement;
    expect(root).toHaveClass('animate-pulse');
  });

  it('renders with default 2 lines', () => {
    const { container } = render(<SkeletonCard />);
    const root = container.firstChild as HTMLElement;
    const lineDivs = root.querySelectorAll('.bg-surface-container-high');
    expect(lineDivs.length).toBe(3);
  });

  it('renders only 1 line when lines=1', () => {
    const { container } = render(<SkeletonCard lines={1} />);
    const root = container.firstChild as HTMLElement;
    const lineDivs = root.querySelectorAll('.bg-surface-container-high');
    expect(lineDivs.length).toBe(2);
  });

  it('renders 3 lines when lines=3', () => {
    const { container } = render(<SkeletonCard lines={3} />);
    const root = container.firstChild as HTMLElement;
    const lineDivs = root.querySelectorAll('.bg-surface-container-high');
    expect(lineDivs.length).toBe(4);
  });

  it('applies custom className', () => {
    const { container } = render(<SkeletonCard className="my-custom-class" />);
    const root = container.firstChild as HTMLElement;
    expect(root).toHaveClass('my-custom-class');
  });
});
