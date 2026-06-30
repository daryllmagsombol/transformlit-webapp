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
    it('renders the brand name as a link to /feed', () => {
      render(<TopBar />);
      const brand = screen.getByText('Transformlit');
      expect(brand).toBeInTheDocument();
      expect(brand.closest('a')).toHaveAttribute('href', '/feed');
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
    it('renders all navigation items', () => {
      render(<TopBar />);
      const header = screen.getByRole('banner');
      expect(header).toBeInTheDocument();
      const nav = header.querySelector('nav');
      expect(nav?.textContent).toContain('Feed');
      expect(nav?.textContent).toContain('Friends');
      expect(nav?.textContent).toContain('Groups');
      expect(nav?.textContent).toContain('Books');
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
    it('renders Login link when user is not authenticated', () => {
      render(<TopBar />);
      const loginLink = screen.getByText('Login');
      expect(loginLink).toBeInTheDocument();
      expect(loginLink.closest('a')).toHaveAttribute('href', '/login');
    });
  });
});
