import { render, screen, fireEvent } from '@testing-library/react';
import { Sidebar } from './sidebar';

var mockSetSidebarOpen: jest.Mock;

jest.mock('next/link', () => {
  return function MockLink({ children, href, className }: Record<string, unknown>) {
    return <a href={href as string} className={className}>{children}</a>;
  };
});

jest.mock('next/navigation', () => ({
  usePathname: () => '/feed',
}));

var mockTheme = 'light';

jest.mock('next-themes', () => ({
  useTheme: () => ({
    theme: mockTheme,
    setTheme: jest.fn(),
    resolvedTheme: mockTheme,
  }),
}));

jest.mock('../../store', () => {
  mockSetSidebarOpen = jest.fn();
  const state = { sidebarOpen: true, toggleSidebar: jest.fn(), setSidebarOpen: mockSetSidebarOpen };
  const store = (selector: (s: typeof state) => unknown) => selector(state);
  store.getState = () => state;
  return {
    useUIStore: store,
    useAuthStore: (selector: (s: Record<string, unknown>) => unknown) => selector({ user: null }),
  };
});

describe('Sidebar', () => {
  describe('nav items', () => {
    it('renders all sidebar navigation items', () => {
      render(<Sidebar />);
      expect(screen.getByText('Feed')).toBeInTheDocument();
      expect(screen.getByText('Friends')).toBeInTheDocument();
      expect(screen.getByText('Groups')).toBeInTheDocument();
      expect(screen.getByText('Books')).toBeInTheDocument();
    });

    it('renders nav items as links with correct hrefs', () => {
      render(<Sidebar />);
      const feedLinks = screen.getAllByText('Feed');
      const feedLink = feedLinks.find(el => el.closest('a')?.getAttribute('href') === '/feed' && el.tagName === 'SPAN');
      expect(feedLink).toBeInTheDocument();
    });
  });

  describe('active item', () => {
    it('marks the current pathname item as active', () => {
      render(<Sidebar />);
      const aside = screen.getByRole('complementary');
      const activeLink = aside.querySelector('a.border-primary');
      expect(activeLink).toBeInTheDocument();
      expect(activeLink?.textContent).toContain('Feed');
    });
  });

  describe('mobile overlay', () => {
    it('renders overlay when sidebar is open', () => {
      render(<Sidebar />);
      const overlay = document.querySelector('.fixed.inset-0');
      expect(overlay).toBeInTheDocument();
    });

    it('calls setSidebarOpen(false) when overlay is clicked', () => {
      render(<Sidebar />);
      const overlay = document.querySelector('.fixed.inset-0') as HTMLElement;
      fireEvent.click(overlay);
      expect(mockSetSidebarOpen).toHaveBeenCalledWith(false);
    });
  });

  describe('sidebar visibility', () => {
    it('applies translate-x-0 when sidebar is open', () => {
      render(<Sidebar />);
      const aside = screen.getByRole('complementary');
      expect(aside.className).toContain('translate-x-0');
    });
  });

  describe('bottom nav', () => {
    it('renders Settings link', () => {
      render(<Sidebar />);
      const settings = screen.getByText('Settings');
      expect(settings.closest('a')).toHaveAttribute('href', '/settings');
    });

    it('renders Help link', () => {
      render(<Sidebar />);
      const help = screen.getByText('Help');
      expect(help.closest('a')).toHaveAttribute('href', '/help');
    });

    it('renders theme toggle button', () => {
      render(<Sidebar />);
      expect(screen.getByRole('button', { name: /switch/i })).toBeInTheDocument();
    });
  });

  describe('progress widget', () => {
    it('renders the progress section', () => {
      render(<Sidebar />);
      expect(screen.getByText('Your Progress')).toBeInTheDocument();
      expect(screen.getByText('Yearly Goal')).toBeInTheDocument();
    });

    it('renders Track Progress button', () => {
      render(<Sidebar />);
      expect(screen.getByText('Track Progress')).toBeInTheDocument();
    });
  });
});
