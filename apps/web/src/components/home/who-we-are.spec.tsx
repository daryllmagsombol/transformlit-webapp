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

import { WhoWeAre } from './who-we-are';

describe('WhoWeAre', () => {
  it('renders the section heading and mission copy', () => {
    render(<WhoWeAre />);
    expect(screen.getByRole('heading', { name: 'Who We Are' })).toBeInTheDocument();
    expect(screen.getByText(/non-stock, non-profit organization/)).toBeInTheDocument();
  });

  it('renders all three pillars', () => {
    render(<WhoWeAre />);
    expect(screen.getByText('Servant-Leadership Trainings')).toBeInTheDocument();
    expect(screen.getByText('Moral-Recovery Literature')).toBeInTheDocument();
    expect(screen.getByText('Mental Health Empowerment')).toBeInTheDocument();
  });
});