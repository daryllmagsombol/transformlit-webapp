import { render } from '@testing-library/react';
import { LoadingSpinner } from './loading-spinner';

describe('LoadingSpinner', () => {
  it('renders an animated spinner', () => {
    const { container } = render(<LoadingSpinner />);
    const spinner = container.querySelector('.animate-spin');
    expect(spinner).toBeInTheDocument();
  });

  it('renders a "Loading…" label by default', () => {
    render(<LoadingSpinner />);
    expect(document.body.textContent).toContain('Loading…');
  });

  it('renders without a label when showLabel is false', () => {
    const { container } = render(<LoadingSpinner showLabel={false} />);
    expect(container.textContent).toBe('');
  });

  it('uses a full-screen wrapper by default', () => {
    const { container } = render(<LoadingSpinner />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper).toHaveClass('min-h-screen');
  });

  it('omits full-screen wrapper when fullScreen is false', () => {
    const { container } = render(<LoadingSpinner fullScreen={false} />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper).not.toHaveClass('min-h-screen');
  });

  it('applies custom className to the wrapper', () => {
    const { container } = render(<LoadingSpinner className="my-class" />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper).toHaveClass('my-class');
  });
});
