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

import { Announcements } from './announcements';
import { PartnersStrip } from './partners-strip';

describe('Announcements', () => {
  it('renders announcement cards', () => {
    render(<Announcements />);
    expect(screen.getByRole('heading', { name: 'Announcements' })).toBeInTheDocument();
    expect(screen.getByText('Tahanan Registration — Open')).toBeInTheDocument();
  });
});

describe('PartnersStrip', () => {
  it('renders the partners label and partner names', () => {
    render(<PartnersStrip />);
    expect(screen.getByText('Partners & Sponsors')).toBeInTheDocument();
    expect(screen.getByText('Partner Church')).toBeInTheDocument();
  });
});