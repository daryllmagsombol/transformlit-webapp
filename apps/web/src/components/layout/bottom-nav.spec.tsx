import { render, screen } from '@testing-library/react';
import { BottomNav } from './bottom-nav';
import { useChatStore } from '../../store/chat-store';

jest.mock('next/link', () => {
  return function MockLink({ children, href, className }: Record<string, unknown>) {
    return <a href={href as string} className={className}>{children}</a>;
  };
});

const mockPathname = '/feed';

jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));

jest.mock('../ui/nav-item', () => ({
  NavItem: ({ label, href, active, badge }: { label: string; href: string; active?: boolean; badge?: number }) => (
    <a href={href} data-active={active}>
      {label}
      {badge !== undefined && badge > 0 && <span>{badge > 9 ? '9+' : badge}</span>}
    </a>
  ),
}));

jest.mock('../../lib/constants', () => ({
  BOTTOM_NAV_ITEMS: [
    { label: 'Feed', href: '/feed', icon: 'dynamic_feed' },
    { label: 'Friends', href: '/friends', icon: 'group' },
    { label: 'Chat', href: '/chat', icon: 'chat_bubble' },
    { label: 'Groups', href: '/groups', icon: 'diversity_3' },
    { label: 'Books', href: '/books', icon: 'menu_book' },
  ],
}));

describe('BottomNav', () => {
  beforeEach(() => useChatStore.getState().reset());

  it('renders all bottom nav items', () => {
    render(<BottomNav />);
    expect(screen.getByText('Feed')).toBeInTheDocument();
    expect(screen.getByText('Friends')).toBeInTheDocument();
    expect(screen.getByText('Chat')).toBeInTheDocument();
    expect(screen.getByText('Groups')).toBeInTheDocument();
    expect(screen.getByText('Books')).toBeInTheDocument();
  });

  it('renders nav links with correct hrefs', () => {
    render(<BottomNav />);
    const feedLink = screen.getByText('Feed').closest('a');
    expect(feedLink).toHaveAttribute('href', '/feed');

    const booksLink = screen.getByText('Books').closest('a');
    expect(booksLink).toHaveAttribute('href', '/books');
  });

  it('marks the active route', () => {
    render(<BottomNav />);
    const feedLink = screen.getByText('Feed').closest('a');
    expect(feedLink).toHaveAttribute('data-active', 'true');

    const booksLink = screen.getByText('Books').closest('a');
    expect(booksLink).toHaveAttribute('data-active', 'false');
  });

  it('is only visible on mobile (md:hidden)', () => {
    const { container } = render(<BottomNav />);
    const nav = container.querySelector('nav');
    expect(nav?.className).toContain('md:hidden');
  });

  it('shows the unread badge on the Chat item', () => {
    useChatStore.setState({ totalUnread: 2 });
    render(<BottomNav />);
    const chatLink = screen.getByText('Chat').closest('a');
    expect(chatLink).toContainElement(screen.getByText('2'));
  });

  it('does not show a badge when there are no unread messages', () => {
    render(<BottomNav />);
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });
});
