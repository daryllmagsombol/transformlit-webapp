import { render, screen } from '@testing-library/react';
import { BookReaderView } from './book-reader-view';
import type { FrameHandle, ReaderCapabilities } from '../../lib/reader/repository';

const NETWORK_CAPABILITIES: ReaderCapabilities = {
  audio: true,
  remoteSearch: true,
  enrichment: true,
  realtime: true,
  navigation: true,
};

const LOCAL_CAPABILITIES: ReaderCapabilities = {
  audio: false,
  remoteSearch: false,
  enrichment: false,
  realtime: false,
  navigation: true,
};

function frame(url: string): FrameHandle {
  return { source: 'network', url, dispose: jest.fn() };
}

function renderView(capabilities: ReaderCapabilities) {
  return render(
    <BookReaderView
      title="Test Book"
      page={1}
      pageCount={3}
      items={[{ t: 'Hello', x: 0.1, y: 0.1, w: 0.2, h: 0.02 }]}
      frame={frame('https://api.test/books/b1/pages/1/frame')}
      capabilities={capabilities}
      onPageChange={jest.fn()}
      onBack={jest.fn()}
    />,
  );
}

describe('BookReaderView', () => {
  it('renders the resolved frame and text layer', () => {
    renderView(NETWORK_CAPABILITIES);
    expect(screen.getByTestId('page-frame')).toHaveAttribute('src', 'https://api.test/books/b1/pages/1/frame');
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();
  });

  it('shows no unavailable notice when every network feature is present', () => {
    renderView(NETWORK_CAPABILITIES);
    expect(screen.queryByTestId('reader-unavailable-features')).not.toBeInTheDocument();
  });

  it('labels network-only controls unavailable offline', () => {
    renderView(LOCAL_CAPABILITIES);
    const notice = screen.getByTestId('reader-unavailable-features');
    expect(notice).toHaveTextContent('Unavailable offline');
    expect(notice).toHaveTextContent('Audio');
    expect(notice).toHaveTextContent('Search');
  });

  it('shows an optional source notice', () => {
    render(
      <BookReaderView
        title="Test Book"
        page={1}
        pageCount={1}
        items={null}
        frame={frame('blob:local')}
        capabilities={LOCAL_CAPABILITIES}
        onPageChange={jest.fn()}
        onBack={jest.fn()}
        statusNotice="Saved offline"
      />,
    );
    expect(screen.getByTestId('reader-status-notice')).toHaveTextContent('Saved offline');
  });

  it('renders a conflict region when conflicts are supplied', () => {
    render(
      <BookReaderView
        title="Test Book"
        page={1}
        pageCount={1}
        items={null}
        frame={frame('blob:local')}
        capabilities={LOCAL_CAPABILITIES}
        onPageChange={jest.fn()}
        onBack={jest.fn()}
        conflicts={<div data-testid="inline-conflicts">conflict panel</div>}
      />,
    );
    expect(screen.getByTestId('reader-conflicts')).toContainElement(
      screen.getByTestId('inline-conflicts'),
    );
  });

  it('omits the conflict region when there are none', () => {
    renderView(NETWORK_CAPABILITIES);
    expect(screen.queryByTestId('reader-conflicts')).not.toBeInTheDocument();
  });
});
