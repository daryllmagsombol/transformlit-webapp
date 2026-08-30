import { render, screen } from '@testing-library/react';
import { AppShell } from './app-shell';

jest.mock('next/link', () => {
  return function MockLink({ children, href, className }: Record<string, unknown>) {
    return <a href={href as string} className={className}>{children}</a>;
  };
});

jest.mock('next/navigation', () => ({
  usePathname: () => '/feed',
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('../../store', () => {
  const state = { sidebarOpen: true, toggleSidebar: jest.fn(), setSidebarOpen: jest.fn() };
  const store = (selector: (s: typeof state) => unknown) => selector(state);
  store.getState = () => state;
  return {
    useUIStore: store,
    useAuthStore: (selector: (s: Record<string, unknown>) => unknown) => selector({ user: null, token: null }),
  };
});

describe('AppShell', () => {
  it('renders children content', () => {
    render(<AppShell><div data-testid="child">Hello World</div></AppShell>);
    expect(screen.getByTestId('child')).toBeInTheDocument();
    expect(screen.getByText('Hello World')).toBeInTheDocument();
  });

  it('renders the TopBar with brand name', () => {
    render(<AppShell><div>Content</div></AppShell>);
    expect(screen.getByText('Transformlit')).toBeInTheDocument();
  });

  it('renders the Sidebar navigation items', () => {
    render(<AppShell><div>Content</div></AppShell>);
    expect(screen.getAllByText('Feed').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Friends').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Groups').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Books').length).toBeGreaterThanOrEqual(1);
  });

  it('renders a main element wrapping children', () => {
    render(<AppShell><div data-testid="child">Content</div></AppShell>);
    const main = screen.getByRole('main');
    expect(main).toBeInTheDocument();
    expect(main).toContainElement(screen.getByTestId('child'));
  });

  it('applies responsive layout classes to main', () => {
    render(<AppShell><div>Content</div></AppShell>);
    const main = screen.getByRole('main');
    expect(main.className).toContain('pt-20');
    expect(main.className).toContain('md:pl-[240px]');
  });

  it('renders the sidebar toggle button', () => {
    render(<AppShell><div>Content</div></AppShell>);
    expect(screen.getByLabelText('Toggle sidebar')).toBeInTheDocument();
  });
});
