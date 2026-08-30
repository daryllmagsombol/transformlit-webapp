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
});
