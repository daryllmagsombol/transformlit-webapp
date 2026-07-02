import { render, screen } from '@testing-library/react';
import { BottomNav } from './bottom-nav';

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
  NavItem: ({ label, href, active }: { label: string; href: string; active?: boolean }) => (
    <a href={href} data-active={active}>{label}</a>
  ),
}));

jest.mock('../../lib/constants', () => ({
  BOTTOM_NAV_ITEMS: [
    { label: 'Feed', href: '/feed', icon: 'dynamic_feed' },
    { label: 'Friends', href: '/friends', icon: 'group' },
    { label: 'Groups', href: '/groups', icon: 'diversity_3' },
    { label: 'Books', href: '/books', icon: 'menu_book' },
  ],
}));

describe('BottomNav', () => {
  it('renders all bottom nav items', () => {
    render(<BottomNav />);
    expect(screen.getByText('Feed')).toBeInTheDocument();
    expect(screen.getByText('Friends')).toBeInTheDocument();
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
});
