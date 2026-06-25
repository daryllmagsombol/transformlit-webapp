'use client';

import { useUIStore, useAuthStore } from '../../store';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navItems = [
  { label: 'Feed', href: '/feed' },
  { label: 'Library', href: '/books' },
  { label: 'Community', href: '/groups' },
];

export function TopBar() {
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const user = useAuthStore((s) => s.user);
  const pathname = usePathname();

  return (
    <header className="fixed top-0 left-0 right-0 z-50 h-16 bg-surface dark:bg-surface-raised border-b border-border flex items-center justify-between px-4 md:px-6">
      {/* Left: hamburger + brand */}
      <div className="flex items-center gap-3">
        <button
          onClick={toggleSidebar}
          className="p-2 text-ink-soft hover:text-ink md:hidden"
          aria-label="Toggle sidebar"
        >
          <span className="material-symbols-outlined">menu</span>
        </button>
        <Link href="/feed" className="font-bold text-lg text-brand">
          Transformlit
        </Link>
      </div>

      {/* Center: desktop nav */}
      <nav className="hidden md:flex items-center gap-8">
        {navItems.map((item) => {
          const isActive = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`font-semibold text-base transition-colors ${
                isActive
                  ? 'text-brand border-b-2 border-brand py-2'
                  : 'text-ink-soft hover:text-ink'
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
        <div className="hidden sm:flex bg-surface-high border border-border rounded-full items-center gap-2 px-4 py-1.5">
          <span className="material-symbols-outlined text-ink-soft text-[20px]">search</span>
          <input
            className="bg-transparent border-none focus:ring-0 text-sm p-0 w-40 placeholder-ink-soft/60"
            placeholder="Search scripture, books..."
            type="text"
          />
        </div>

        {/* Notifications */}
        <button
          className="p-2 text-ink-soft hover:text-ink hover:bg-surface-high rounded-full transition-colors"
          aria-label="Notifications"
        >
          <span className="material-symbols-outlined">notifications</span>
        </button>

        {/* User avatar */}
        {user ? (
          <div className="w-9 h-9 rounded-full bg-brand/10 overflow-hidden border border-brand/20 flex items-center justify-center">
            {user.avatarUrl ? (
              <img
                className="w-full h-full object-cover"
                alt={user.displayName}
                src={user.avatarUrl}
              />
            ) : (
              <span className="text-sm font-bold text-brand">
                {user.displayName.charAt(0).toUpperCase()}
              </span>
            )}
          </div>
        ) : (
          <Link href="/login" className="btn-primary text-sm py-2 px-4">
            Login
          </Link>
        )}
      </div>
    </header>
  );
}
