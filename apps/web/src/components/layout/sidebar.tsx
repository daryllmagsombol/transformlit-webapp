'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useUIStore } from '../../store';

const navItems = [
  { label: 'Feed', href: '/feed', icon: 'dynamic_feed' },
  { label: 'Friends', href: '/friends', icon: 'group' },
  { label: 'Groups', href: '/groups', icon: 'diversity_3' },
  { label: 'Books', href: '/books', icon: 'menu_book' },
];

const bottomNavItems = [
  { label: 'Settings', href: '/settings', icon: 'settings' },
  { label: 'Help', href: '/help', icon: 'help' },
];

export function Sidebar() {
  const pathname = usePathname();
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);

  return (
    <>
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/30 z-40 md:hidden"
          onClick={() => useUIStore.getState().setSidebarOpen(false)}
        />
      )}

      <aside
        className={`fixed left-0 top-16 bottom-0 z-40 bg-surface-raised dark:bg-surface-raised border-r border-border
          transition-transform duration-200 ease-out
          w-[240px] flex flex-col
          md:translate-x-0
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        {/* Main nav */}
        <nav className="flex flex-col gap-1 p-4 flex-1">
          {navItems.map((item) => {
            const isActive = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-4 py-3 text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-brand/10 text-brand border-l-4 border-brand font-bold'
                    : 'text-ink-soft hover:text-ink hover:bg-surface-high'
                }`}
              >
                <span
                  className={`material-symbols-outlined text-xl ${isActive ? 'filled' : ''}`}
                >
                  {item.icon}
                </span>
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Progress widget */}
        <div className="px-4 pb-4">
          <div className="bg-paper-warm/50 dark:bg-paper-warm/10 rounded-lg p-4 border border-border">
            <h3 className="text-xs uppercase tracking-widest text-ink-soft mb-3 font-semibold">
              Your Progress
            </h3>
            <div className="flex justify-between items-end mb-2">
              <span className="text-sm text-ink-soft">Yearly Goal</span>
              <span className="text-lg font-bold text-brand">12/24</span>
            </div>
            <div className="w-full bg-surface-high h-2 rounded-full overflow-hidden">
              <div
                className="bg-brand h-full rounded-full transition-all"
                style={{ width: '50%' }}
              />
            </div>
            <p className="text-xs text-ink-soft mt-3 italic text-center">
              &ldquo;Steady steps lead to deep wisdom.&rdquo;
            </p>
            <button className="mt-4 w-full py-2 bg-brand text-white rounded-md text-sm font-bold flex items-center justify-center gap-2 hover:bg-brand-dark transition-colors active-press">
              <span className="material-symbols-outlined text-[18px]">auto_stories</span>
              Track Progress
            </button>
          </div>
        </div>

        {/* Bottom nav */}
        <div className="border-t border-border p-4 flex flex-col gap-1">
          {bottomNavItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 px-4 py-2 text-sm text-ink-soft hover:text-ink hover:bg-surface-high transition-colors"
            >
              <span className="material-symbols-outlined text-lg">{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </div>
      </aside>
    </>
  );
}
