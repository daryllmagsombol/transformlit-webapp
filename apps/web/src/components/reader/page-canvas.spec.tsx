import { render, screen } from '@testing-library/react';
import { PageCanvas } from './page-canvas';
import type { FrameHandle } from '../../lib/reader/repository';

function frame(url: string, dispose: () => void = jest.fn()): FrameHandle {
  return { source: url.startsWith('blob:') ? 'local' : 'network', url, dispose };
}

describe('PageCanvas', () => {
  it('renders the resolved frame URL without constructing one itself', () => {
    render(<PageCanvas frame={frame('https://api.test/books/b1/pages/1/frame')} items={null} />);
    expect(screen.getByTestId('page-frame')).toHaveAttribute('src', 'https://api.test/books/b1/pages/1/frame');
  });

  it('renders the resolved text layer items', () => {
    render(
      <PageCanvas
        frame={frame('blob:local-1')}
        items={[{ t: 'Hello', x: 0.1, y: 0.1, w: 0.2, h: 0.02 }]}
      />,
    );
    expect(screen.getByTestId('pdf-text-layer')).toBeInTheDocument();
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  it('shows a skeleton until resolved items arrive', () => {
    render(<PageCanvas frame={frame('blob:local-1')} items={null} />);
    expect(screen.getByTestId('page-skeleton')).toBeInTheDocument();
    expect(screen.queryByTestId('pdf-text-layer')).not.toBeInTheDocument();
  });

  it('disposes the previous frame on page change and the current frame on unmount', () => {
    const first = jest.fn();
    const second = jest.fn();
    const { rerender, unmount } = render(<PageCanvas frame={frame('blob:1', first)} items={null} />);
    expect(screen.getByTestId('page-frame')).toHaveAttribute('src', 'blob:1');

    rerender(<PageCanvas frame={frame('blob:2', second)} items={null} />);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();

    unmount();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('does not dispose the current frame on an unrelated rerender', () => {
    const dispose = jest.fn();
    const handle = frame('blob:1', dispose);
    const { rerender } = render(<PageCanvas frame={handle} items={null} />);
    rerender(<PageCanvas frame={handle} items={[]} />);
    expect(dispose).not.toHaveBeenCalled();
  });
});
