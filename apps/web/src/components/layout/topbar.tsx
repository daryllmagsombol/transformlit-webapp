'use client';

import { useState } from 'react';
import { useUIStore, useAuthStore } from '../../store';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { UserMenu, BellIcon } from '../ui';
import { ThemeToggle } from '../ui/theme-toggle';
import { NotificationPanel } from '../notifications/notification-panel';

const NAV_LINKS = [
  { label: 'Feed', href: '/feed' },
  { label: 'Bible', href: '/bible' },
  { label: 'Friends', href: '/friends' },
  { label: 'Library', href: '/books' },
  { label: 'Community', href: '/groups' },
] as const;

export function TopBar() {
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const user = useAuthStore((s) => s.user);
  const userId = useAuthStore((s) => s.user?.id);
  const pathname = usePathname();
  const [notificationPanelOpen, setNotificationPanelOpen] = useState(false);
  const handleNotificationClick = () => setNotificationPanelOpen(true);

  return (
    <>
      <header className="flex justify-between items-center h-16 px-4 md:px-5 w-full fixed top-0 bg-surface dark:bg-surface-dark z-50 shadow-sm">
      {/* Left: brand */}
      <div className="flex items-center">
        <h1 className="font-display text-headline-h3 font-bold text-primary dark:text-primary-fixed">
          Transformlit
        </h1>
      </div>

      {/* Center: desktop nav */}
      <div className="hidden md:flex items-center gap-8">
        <nav className="flex gap-6 items-center">
          {NAV_LINKS.map(({ label, href }) => {
            const isActive = pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`font-display text-headline-h4 ${
                  isActive
                    ? 'text-primary font-bold border-b-2 border-primary py-2'
                    : 'text-on-surface-variant font-medium hover:text-primary transition-colors py-2'
                }`}
              >
                {label}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Right: search + theme toggle + notifications + avatar + hamburger */}
      <div className="flex items-center gap-2">
        {/* Search pill */}
        <div className="hidden sm:flex bg-surface-container-high px-4 py-1.5 rounded-full items-center gap-2 border border-outline-variant">
          <span className="material-symbols-outlined text-on-surface-variant text-[20px]">search</span>
          <input
            className="bg-transparent border-none focus:ring-0 text-small font-small p-0 w-48 placeholder-on-surface-variant/60"
            placeholder="Search scripture, books..."
            type="text"
          />
        </div>

        {/* Theme toggle */}
        <ThemeToggle className="btn-ghost !p-0 min-w-11 min-h-11 justify-center !w-auto !gap-0 text-[0px] text-primary hover:bg-primary/10 transition-colors" />

        {/* Notifications */}
        <BellIcon userId={userId ?? ''} onClick={handleNotificationClick} />

        {/* User menu */}
        <UserMenu user={user} />

        {/* Hamburger (rightmost) */}
        <button
          onClick={toggleSidebar}
          className="btn-ghost min-w-11 min-h-11 flex items-center justify-center text-primary hover:bg-primary/10 transition-colors"
          aria-label="Toggle sidebar"
        >
          <span className="material-symbols-outlined">menu</span>
        </button>
      </div>
      </header>

      {notificationPanelOpen && (
      <NotificationPanel
        open={notificationPanelOpen}
        onClose={() => setNotificationPanelOpen(false)}
        userId={userId ?? ''}
      />
      )}
    </>
  );
}
