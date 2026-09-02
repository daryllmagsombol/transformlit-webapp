import { render, screen, fireEvent } from '@testing-library/react';
import { TopBar } from './topbar';

var mockToggleSidebar: jest.Mock;

jest.mock('next/link', () => {
  return function MockLink({ children, href, className }: Record<string, unknown>) {
    return <a href={href as string} className={className}>{children}</a>;
  };
});

jest.mock('next/navigation', () => ({
  usePathname: () => '/feed',
  useRouter: () => ({ push: jest.fn() }),
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
  mockToggleSidebar = jest.fn();
  const state = { sidebarOpen: true, toggleSidebar: mockToggleSidebar, setSidebarOpen: jest.fn() };
  const store = (selector: (s: typeof state) => unknown) => selector(state);
  store.getState = () => state;
  return {
    useUIStore: store,
    useAuthStore: (selector: (s: Record<string, unknown>) => unknown) => selector({ user: null, token: null }),
  };
});

describe('TopBar', () => {
  describe('brand', () => {
    it('renders the brand name as a heading', () => {
      render(<TopBar />);
      const brand = screen.getByText('Transformlit');
      expect(brand).toBeInTheDocument();
      expect(brand.tagName).toBe('H1');
    });
  });

  describe('mobile menu button', () => {
    it('renders a toggle sidebar button', () => {
      render(<TopBar />);
      expect(screen.getByLabelText('Toggle sidebar')).toBeInTheDocument();
    });

    it('calls toggleSidebar when hamburger is clicked', () => {
      render(<TopBar />);
      fireEvent.click(screen.getByLabelText('Toggle sidebar'));
      expect(mockToggleSidebar).toHaveBeenCalledTimes(1);
    });
  });

  describe('desktop nav', () => {
    it('renders all navigation items (Feed, Library, Community)', () => {
      render(<TopBar />);
      const header = screen.getByRole('banner');
      expect(header).toBeInTheDocument();
      const nav = header.querySelector('nav');
      expect(nav?.textContent).toContain('Feed');
      expect(nav?.textContent).toContain('Library');
      expect(nav?.textContent).toContain('Community');
    });

    it('highlights the active nav item', () => {
      render(<TopBar />);
      const header = screen.getByRole('banner');
      const nav = header.querySelector('nav');
      const feedLink = nav?.querySelector('a[href="/feed"]');
      expect(feedLink?.className).toContain('text-primary');
      expect(feedLink?.className).toContain('font-bold');
    });
  });

  describe('search', () => {
    it('renders a search input', () => {
      render(<TopBar />);
      const input = screen.getByPlaceholderText('Search scripture, books...');
      expect(input).toBeInTheDocument();
    });
  });

  describe('notifications', () => {
    it('renders a notifications button', () => {
      render(<TopBar />);
      expect(screen.getByLabelText('Notifications')).toBeInTheDocument();
    });
  });

  describe('user avatar', () => {
    it('renders UserAvatar with fallback initial', () => {
      render(<TopBar />);
      // UserAvatar renders 'U' as fallback when no displayName
      expect(screen.getByText('U')).toBeInTheDocument();
    });
  });
});
