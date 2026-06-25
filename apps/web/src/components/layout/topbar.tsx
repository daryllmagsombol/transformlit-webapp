'use client';

import { useUIStore, useAuthStore } from '../../store';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { UserAvatar } from '../ui/user-avatar';
import { SIDEBAR_NAV_ITEMS } from '../../lib/constants';

export function TopBar() {
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const user = useAuthStore((s) => s.user);
  const pathname = usePathname();

  return (
    <header className="fixed top-0 left-0 right-0 z-50 h-16 bg-surface dark:bg-surface-dark border-b border-outline-variant flex items-center justify-between px-4 md:px-6">
      {/* Left: hamburger + brand */}
      <div className="flex items-center gap-3">
        <button
          onClick={toggleSidebar}
          className="p-2 text-on-surface-variant hover:text-on-surface md:hidden"
          aria-label="Toggle sidebar"
        >
          <span className="material-symbols-outlined">menu</span>
        </button>
        <Link href="/feed" className="font-display text-headline-h3 font-bold text-primary dark:text-primary-fixed">
          Transformlit
        </Link>
      </div>

      {/* Center: desktop nav */}
      <nav className="hidden md:flex items-center gap-8">
        {SIDEBAR_NAV_ITEMS.map((item) => {
          const isActive = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`font-display text-headline-h4 transition-colors ${
                isActive
                  ? 'text-primary font-bold border-b-2 border-primary py-2'
                  : 'text-on-surface-variant font-medium hover:text-primary py-2'
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Right: search + notifications + avatar */}
      <div className="flex items-center gap-3">
        {/* Search pill */}
        <div className="hidden sm:flex bg-surface-container-high border border-outline-variant rounded-full items-center gap-2 px-4 py-1.5">
          <span className="material-symbols-outlined text-on-surface-variant text-[20px]">search</span>
          <input
            className="bg-transparent border-none focus:ring-0 font-small text-small p-0 w-40 placeholder-on-surface-variant/60"
            placeholder="Search scripture, books..."
            type="text"
          />
        </div>

        {/* Notifications */}
        <button
          className="p-2 text-on-surface-variant hover:text-on-surface hover:bg-surface-container rounded-full transition-colors"
          aria-label="Notifications"
        >
          <span className="material-symbols-outlined">notifications</span>
        </button>

        {/* User avatar */}
        {user ? (
          <UserAvatar avatarUrl={user.avatarUrl} displayName={user.displayName} />
        ) : (
          <Link href="/login" className="btn-primary text-small py-2 px-4">
            Login
          </Link>
        )}
      </div>
    </header>
  );
}
