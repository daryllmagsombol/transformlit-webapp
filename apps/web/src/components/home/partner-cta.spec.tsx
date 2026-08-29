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

import { PartnerCta } from './partner-cta';

describe('PartnerCta', () => {
  it('renders partnership copy and heading', () => {
    render(<PartnerCta />);
    expect(screen.getByRole('heading', { name: 'Partner With Us' })).toBeInTheDocument();
    expect(screen.getByText(/churches, church leaders, and para-church organizations/i)).toBeInTheDocument();
  });

  it('shows contact phone and email', () => {
    render(<PartnerCta />);
    expect(screen.getByText('0927-412-2292')).toBeInTheDocument();
    expect(screen.getByText(/transformlit/i)).toBeInTheDocument();
  });

  it('renders a CTA button anchoring to contact', () => {
    render(<PartnerCta />);
    expect(screen.getByText('Start a Partnership Conversation')).toBeInTheDocument();
  });
});