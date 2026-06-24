'use client';

import { useUIStore, useAuthStore } from '../../store';
import { useTheme } from 'next-themes';
import Link from 'next/link';

export function TopBar() {
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const user = useAuthStore((s) => s.user);
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const { theme, setTheme } = useTheme();

  return (
    <header className="fixed top-0 left-0 right-0 z-50 h-[56px] bg-surface border-b border-border flex items-center justify-between px-4">
      <div className="flex items-center gap-3">
        <button
          onClick={toggleSidebar}
          className="p-2 text-ink-soft hover:text-ink md:hidden"
          aria-label="Toggle sidebar"
        >
          ☰
        </button>
        <Link href="/feed" className="font-bold text-lg text-brand">
          Transformlit
        </Link>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="p-2 text-ink-soft hover:text-ink rounded-sm"
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>

        {user ? (
          <div className="flex items-center gap-2">
            <span className="text-sm text-ink-soft hidden sm:inline">{user.displayName}</span>
            <button
              onClick={clearAuth}
              className="btn-ghost text-sm py-1"
            >
              Logout
            </button>
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
