'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useUIStore } from '../../store';
import { NavItem } from '../ui/nav-item';
import { SIDEBAR_NAV_ITEMS } from '../../lib/constants';
import { ThemeToggle } from '../ui/theme-toggle';

export function Sidebar() {
  const pathname = usePathname();
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);

  // Open sidebar on desktop, close on mobile — respond to resize across breakpoint
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const handler = (e: MediaQueryListEvent | MediaQueryList) => {
      setSidebarOpen(e.matches);
    };
    handler(mq); // set initial state
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [setSidebarOpen]);

  return (
    <>
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/30 z-40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={`fixed left-0 top-16 bottom-0 z-40 bg-surface-container-low dark:bg-surface-container-lowest
          border-r border-outline-variant
          transition-transform duration-200 ease-out
          w-[240px] flex flex-col
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
          ${sidebarOpen ? 'md:translate-x-0' : 'md:-translate-x-full'}
        `}
      >
        {/* Main nav */}
        <nav className="flex flex-col gap-1 p-4 flex-1">
          {SIDEBAR_NAV_ITEMS.map((item) => (
            <NavItem
              key={item.href}
              {...item}
              active={pathname.startsWith(item.href)}
              variant="sidebar"
            />
          ))}
        </nav>

        {/* Progress widget */}
        <div className="px-4 pb-4">
          <div className="bg-paper-warm/50 rounded-lg p-4 border border-outline-variant shadow-sm">
            <h3 className="font-micro text-micro uppercase tracking-widest text-on-surface-variant mb-3">
              Your Progress
            </h3>
            <div className="flex justify-between items-end mb-2">
              <span className="font-small text-small text-on-surface-variant">Yearly Goal</span>
              <span className="font-headline-h4 text-headline-h4 text-primary">12/24</span>
            </div>
            <div className="w-full bg-surface-container-highest h-2 rounded-full overflow-hidden">
              <div
                className="bg-brand-orange-dark h-full rounded-full transition-all"
                style={{ width: '50%' }}
              />
            </div>
            <p className="font-micro text-micro text-on-surface-variant mt-3 italic text-center">
              &ldquo;Steady steps lead to deep wisdom.&rdquo;
            </p>
            <button className="mt-4 w-full py-2 bg-primary text-on-primary rounded-md font-display text-small font-bold flex items-center justify-center gap-2 hover:bg-brand-orange-dark transition-colors active:scale-95">
              <span className="material-symbols-outlined text-[18px]">auto_stories</span>
              Track Progress
            </button>
          </div>
        </div>

        {/* Bottom nav */}
        <div className="border-t border-outline-variant p-4 flex flex-col gap-1">
          <Link
            href="/settings"
            className="flex items-center gap-3 px-4 py-2 text-on-surface-variant hover:bg-surface-container-highest transition-all text-micro uppercase tracking-wider"
          >
            <span className="material-symbols-outlined text-lg">settings</span>
            Settings
          </Link>
          <Link
            href="/help"
            className="flex items-center gap-3 px-4 py-2 text-on-surface-variant hover:bg-surface-container-highest transition-all text-micro uppercase tracking-wider"
          >
            <span className="material-symbols-outlined text-lg">help</span>
            Help
          </Link>
          <ThemeToggle />
        </div>
      </aside>
    </>
  );
}
