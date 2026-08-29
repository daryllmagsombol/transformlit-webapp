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

jest.mock('./auth-redirect', () => {
  return function MockAuthRedirect({ children }: { children: React.ReactNode }) {
    return <div data-testid="auth-redirect">{children}</div>;
  };
});

jest.mock('next/link', () => {
  return function MockLink({ children, href, className }: Record<string, unknown>) {
    return <a href={href as string} className={className as string}>{children}</a>;
  };
});

import HomePage from './page';

describe('HomePage', () => {
  it('renders every homepage section', () => {
    render(<HomePage />);
    expect(screen.getByText('Who We Are')).toBeInTheDocument();
    expect(screen.getByText('The MOVE Discipleship System')).toBeInTheDocument();
    expect(screen.getAllByText('Partner With Us').length).toBeGreaterThan(0);
    expect(screen.getByText('Beyond the Books')).toBeInTheDocument();
    expect(screen.getByText('Announcements')).toBeInTheDocument();
    expect(screen.getByText(/© 2026 Transform Lit/)).toBeInTheDocument();
  });

  it('wraps content in the auth redirect so authenticated users go to /feed', () => {
    render(<HomePage />);
    expect(screen.getByTestId('auth-redirect')).toBeInTheDocument();
  });
});