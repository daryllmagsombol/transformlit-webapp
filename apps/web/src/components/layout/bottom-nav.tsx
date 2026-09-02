'use client';

import { usePathname } from 'next/navigation';
import { NavItem } from '../ui/nav-item';
import { BOTTOM_NAV_ITEMS } from '../../lib/constants';
import { useChatStore } from '../../store/chat-store';

export function BottomNav() {
  const pathname = usePathname();
  const totalUnread = useChatStore((s) => s.totalUnread);

  return (
    <nav
      className="fixed bottom-0 left-0 w-full z-50 flex justify-around items-center px-2 py-1 md:hidden bg-paper-warm shadow-lg border-t border-outline-variant"
      aria-label="Mobile navigation"
    >
      {BOTTOM_NAV_ITEMS.map((item) => (
        <NavItem
          key={item.href}
          {...item}
          active={pathname.startsWith(item.href)}
          variant="bottom"
          badge={item.href === '/chat' ? totalUnread : undefined}
        />
      ))}
    </nav>
  );
}
