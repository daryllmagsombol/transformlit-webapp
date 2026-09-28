import { render, screen, fireEvent } from '@testing-library/react';
import { Sheet } from './sheet';

describe('Sheet', () => {
  it('renders children when open', () => {
    render(
      <Sheet open onClose={() => {}} title="Study">
        <p>Footnotes</p>
      </Sheet>,
    );
    expect(screen.getByText('Study')).toBeInTheDocument();
    expect(screen.getByText('Footnotes')).toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    render(
      <Sheet open={false} onClose={() => {}}>
        <p>Hidden</p>
      </Sheet>,
    );
    expect(screen.queryByText('Hidden')).not.toBeInTheDocument();
  });

  it('calls onClose on backdrop click', () => {
    const onClose = jest.fn();
    render(
      <Sheet open onClose={onClose}>
        <p>Body</p>
      </Sheet>,
    );
    fireEvent.click(screen.getByTestId('sheet-backdrop'));
    expect(onClose).toHaveBeenCalled();
  });

  // Regression guard: a native <dialog> without the `open` attribute computes to
  // display:none in a real browser, hiding the whole sheet. jsdom does not apply
  // UA dialog styles, so assert the attribute directly instead of visibility.
  it('marks the native dialog as open when open is true', () => {
    const { container } = render(
      <Sheet open onClose={() => {}} title="Study">
        <p>Body</p>
      </Sheet>,
    );
    const dialog = container.querySelector('dialog');
    expect(dialog).not.toBeNull();
    expect(dialog).toHaveAttribute('open');
  });
});
