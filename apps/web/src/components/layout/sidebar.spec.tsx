import { render, screen, fireEvent } from '@testing-library/react';
import { Sidebar } from './sidebar';
import { useChatStore } from '../../store/chat-store';

// The widget reads progress through the shared Apollo client singleton (the
// same seam as the bell icon and activity recorder); no React provider is
// required, so this stays a unit test of the sidebar itself.
jest.mock('../../lib/apollo-client', () => ({
  apolloClient: { query: jest.fn() },
}));

import { apolloClient } from '../../lib/apollo-client';

const mockQuery = apolloClient.query as jest.Mock;

interface ProgressFixture {
  readonly year: number;
  readonly goal: { readonly year: number; readonly targetKind: string; readonly targetValue: number } | null;
  readonly daysRead: number;
  readonly pagesRead: number;
  readonly currentStreak: number;
  readonly longestStreak: number;
  readonly lastActiveDayKey: string | null;
}

function progressFixture(overrides: Partial<ProgressFixture> = {}): ProgressFixture {
  return {
    year: 2026,
    goal: { year: 2026, targetKind: 'DAYS', targetValue: 24 },
    daysRead: 12,
    pagesRead: 300,
    currentStreak: 5,
    longestStreak: 9,
    lastActiveDayKey: '2026-01-05',
    ...overrides,
  };
}

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
  beforeEach(() => {
    useChatStore.getState().reset();
    // Default the progress query to a pending promise so shell tests stay in
    // the loading state and never emit a post-test state update.
    mockQuery.mockReturnValue(new Promise(() => {}));
  });

  describe('nav items', () => {
    it('renders all sidebar navigation items', () => {
      render(<Sidebar />);
      expect(screen.getByText('Feed')).toBeInTheDocument();
      expect(screen.getByText('Friends')).toBeInTheDocument();
      expect(screen.getByText('Chat')).toBeInTheDocument();
      expect(screen.getByText('Groups')).toBeInTheDocument();
      expect(screen.getByText('Books')).toBeInTheDocument();
    });

    it('renders nav items as links with correct hrefs', () => {
      render(<Sidebar />);
      const feedLinks = screen.getAllByText('Feed');
      const feedLink = feedLinks.find(el => el.closest('a')?.getAttribute('href') === '/feed' && el.tagName === 'SPAN');
      expect(feedLink).toBeInTheDocument();
    });

    it('shows the unread badge on the Chat item', () => {
      useChatStore.setState({ totalUnread: 2 });
      render(<Sidebar />);
      const chatLink = screen.getByText('Chat').closest('a');
      expect(chatLink).toContainElement(screen.getByText('2'));
    });

    it('does not show a badge when there are no unread messages', () => {
      render(<Sidebar />);
      expect(screen.queryByText('0')).not.toBeInTheDocument();
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
    beforeEach(() => {
      mockQuery.mockResolvedValue({ data: { myProgress: progressFixture() } });
    });

    it('renders the progress section', async () => {
      render(<Sidebar />);
      expect(screen.getByText('Your Progress')).toBeInTheDocument();
      expect(screen.getByText('Yearly Goal')).toBeInTheDocument();
      await screen.findByText('12/24');
    });

    it('renders Track Progress button linking to /progress', async () => {
      render(<Sidebar />);
      const button = screen.getByText('Track Progress').closest('a');
      expect(button).toHaveAttribute('href', '/progress');
      await screen.findByText('12/24');
    });

    it('renders daysRead as the numerator for a DAYS goal', async () => {
      render(<Sidebar />);
      expect(await screen.findByText('12/24')).toBeInTheDocument();
    });

    it('renders pagesRead as the numerator for a PAGES goal', async () => {
      mockQuery.mockResolvedValue({
        data: { myProgress: progressFixture({ goal: { year: 2026, targetKind: 'PAGES', targetValue: 1000 }, daysRead: 12, pagesRead: 250 }) },
      });
      render(<Sidebar />);
      expect(await screen.findByText('250/1000')).toBeInTheDocument();
    });

    it('computes the progress bar width from the value/target ratio', async () => {
      render(<Sidebar />);
      await screen.findByText('12/24');
      const bar = screen.getByRole('progressbar');
      expect(bar).toHaveAttribute('aria-valuenow', '50');
      expect(bar.firstElementChild).toHaveStyle({ width: '50%' });
    });

    it('caps the progress bar width at 100%', async () => {
      mockQuery.mockResolvedValue({
        data: { myProgress: progressFixture({ daysRead: 40, goal: { year: 2026, targetKind: 'DAYS', targetValue: 24 } }) },
      });
      render(<Sidebar />);
      await screen.findByText('40/24');
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    });

    it('renders the current streak chip', async () => {
      render(<Sidebar />);
      expect(await screen.findByText('5 day streak')).toBeInTheDocument();
    });

    it('renders a "Set a yearly goal" CTA linking to /progress when no goal is configured', async () => {
      mockQuery.mockResolvedValue({ data: { myProgress: progressFixture({ goal: null }) } });
      render(<Sidebar />);
      const cta = await screen.findByText('Set a yearly goal');
      expect(cta.closest('a')).toHaveAttribute('href', '/progress');
      expect(screen.queryByText('12/24')).not.toBeInTheDocument();
      // The streak chip is goal-independent, so it still renders.
      expect(screen.getByText('5 day streak')).toBeInTheDocument();
    });

    it('falls back to a neutral message when the query fails without blocking the shell', async () => {
      mockQuery.mockRejectedValue(new Error('network down'));
      render(<Sidebar />);
      expect(await screen.findByText('Progress unavailable right now.')).toBeInTheDocument();
      // Failure must not masquerade as "no goal set", and the shell survives.
      expect(screen.queryByText('Set a yearly goal')).not.toBeInTheDocument();
      expect(screen.getByText('Feed')).toBeInTheDocument();
    });
  });
});
