'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useUIStore } from '../../store';

const navItems = [
  { label: 'Feed', href: '/feed', icon: '📰' },
  { label: 'Friends', href: '/friends', icon: '👥' },
  { label: 'Groups', href: '/groups', icon: '👪' },
  { label: 'Books', href: '/books', icon: '📚' },
];

export function Sidebar() {
  const pathname = usePathname();
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);

  return (
    <aside
      className={`fixed left-0 top-[56px] bottom-0 z-40 bg-surface-raised border-r border-border
        transition-transform duration-250 ease-out
        w-[240px] p-4
        md:translate-x-0
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}
    >
      <nav className="flex flex-col gap-1">
        {navItems.map((item) => {
          const isActive = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-3 rounded-sm text-sm font-medium transition-colors
                ${isActive
                  ? 'bg-brand/10 text-brand border-l-[3px] border-brand pl-[9px]'
                  : 'text-ink-soft hover:text-ink hover:bg-surface-high'
                }
              `}
            >
              <span className="text-lg">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
