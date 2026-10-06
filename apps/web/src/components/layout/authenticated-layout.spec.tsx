import { render, screen } from '@testing-library/react';
import { AuthenticatedLayout } from './authenticated-layout';

jest.mock('../providers/apollo-provider', () => ({
  ApolloProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="apollo-provider">{children}</div>
  ),
}));

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
    useAuthStore: (selector: (s: Record<string, unknown>) => unknown) => selector({ user: null }),
  };
});

// AuthenticatedLayout renders the real AppShell → Sidebar → ProgressWidget,
// which reads MyProgress through the shared Apollo client singleton. Mock it so
// mounting the layout never fires a real query at the API; the default pending
// promise keeps the widget in its loading state for these layout assertions.
jest.mock('../../lib/apollo-client', () => ({
  apolloClient: { query: jest.fn(() => new Promise(() => {})) },
}));

describe('AuthenticatedLayout', () => {
  it('renders children', () => {
    render(<AuthenticatedLayout><div data-testid="child">Protected Content</div></AuthenticatedLayout>);
    expect(screen.getByTestId('child')).toBeInTheDocument();
    expect(screen.getByText('Protected Content')).toBeInTheDocument();
  });

  it('wraps content in ApolloProvider', () => {
    render(<AuthenticatedLayout><div>Content</div></AuthenticatedLayout>);
    expect(screen.getByTestId('apollo-provider')).toBeInTheDocument();
  });

  it('renders the AppShell with TopBar', () => {
    render(<AuthenticatedLayout><div>Content</div></AuthenticatedLayout>);
    expect(screen.getByText('TransformLit')).toBeInTheDocument();
  });

  it('renders the AppShell with Sidebar nav items', () => {
    render(<AuthenticatedLayout><div>Content</div></AuthenticatedLayout>);
    expect(screen.getAllByText('Feed').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Groups').length).toBeGreaterThanOrEqual(1);
  });
});
