import { render, screen } from '@testing-library/react';

class MockIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
(global as unknown as { IntersectionObserver: unknown }).IntersectionObserver = MockIntersectionObserver;

(global as unknown as { matchMedia: unknown }).matchMedia = (query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
});

jest.mock('next/link', () => {
  return function MockLink({ children, href, className }: Record<string, unknown>) {
    return <a href={href as string} className={className as string}>{children}</a>;
  };
});

import { MoveSystem } from './move-system';

describe('MoveSystem', () => {
  it('renders the section heading', () => {
    render(<MoveSystem />);
    expect(screen.getByRole('heading', { name: 'The MOVE Discipleship System' })).toBeInTheDocument();
  });

  it('renders the four books in order with their phases', () => {
    render(<MoveSystem />);
    const titles = ['Usbong', 'Usad', 'Unlad', 'Ugnay'];
    for (const title of titles) {
      expect(screen.getAllByText(title).length).toBeGreaterThan(0);
    }
    expect(screen.getByText('Salvation')).toBeInTheDocument();
    expect(screen.getByText('Spiritual Disciplines')).toBeInTheDocument();
    expect(screen.getByText('Servant-Leadership')).toBeInTheDocument();
    expect(screen.getByText('Systematic Theology')).toBeInTheDocument();
  });

  it('links every book to its Shopee product', () => {
    render(<MoveSystem />);
    const shopeeLinks = screen.getAllByText('Buy on Shopee');
    expect(shopeeLinks).toHaveLength(4);
    for (const link of shopeeLinks) {
      expect(link).toHaveAttribute('href', expect.stringMatching(/^https:\/\/shopee\.ph\//));
    }
  });

  it('renders the resources note', () => {
    render(<MoveSystem />);
    expect(screen.getByText(/leaders. guide, presentations, and video supplements/i)).toBeInTheDocument();
  });
});