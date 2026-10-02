import { render, screen } from '@testing-library/react';
import { AppShell } from './app-shell';

jest.mock('next/link', () => {
  return function MockLink({ children, href, className }: Record<string, unknown>) {
    return <a href={href as string} className={className}>{children}</a>;
  };
});

let mockPathname = '/feed';

jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
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

// The offline hub must not mount the chat/social providers.
jest.mock('../chat/chat-provider', () => ({
  ChatProvider: () => <div data-testid="chat-provider" />,
}));
jest.mock('../friends/profile-sheet-provider', () => ({
  ProfileSheetProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="profile-sheet-provider">{children}</div>
  ),
}));

describe('AppShell', () => {
  beforeEach(() => {
    mockPathname = '/feed';
  });

  it('renders children content', () => {
    render(<AppShell><div data-testid="child">Hello World</div></AppShell>);
    expect(screen.getByTestId('child')).toBeInTheDocument();
    expect(screen.getByText('Hello World')).toBeInTheDocument();
  });

  it('renders the TopBar with brand name', () => {
    render(<AppShell><div>Content</div></AppShell>);
    expect(screen.getByText('TransformLit')).toBeInTheDocument();
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

  it('renders the Downloads entry in the authenticated shell', () => {
    render(<AppShell><div>Content</div></AppShell>);
    const downloads = screen.getAllByText('Downloads')[0];
    expect(downloads.closest('a')).toHaveAttribute('href', '/offline');
  });

  it('renders chat/social providers for personalized routes', () => {
    render(<AppShell><div>Content</div></AppShell>);
    expect(screen.getByTestId('chat-provider')).toBeInTheDocument();
    expect(screen.getByTestId('profile-sheet-provider')).toBeInTheDocument();
  });

  it('does not mount chat/social providers on the offline hub', () => {
    mockPathname = '/offline';
    render(<AppShell><div data-testid="child">Content</div></AppShell>);
    expect(screen.getByTestId('child')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-provider')).not.toBeInTheDocument();
    expect(screen.queryByTestId('profile-sheet-provider')).not.toBeInTheDocument();
  });
});
