'use client';

import Link from 'next/link';

type NavItemProps = {
  label: string;
  href: string;
  icon: string;
  active?: boolean;
  variant?: 'sidebar' | 'bottom';
  badge?: number;
  className?: string;
};

export function NavItem({ label, href, icon, active = false, variant = 'sidebar', badge, className = '' }: NavItemProps) {
  const isSidebar = variant === 'sidebar';

  const activeClass = isSidebar
    ? 'bg-primary-container dark:bg-primary-fixed-variant text-on-primary-container border-l-4 border-primary font-bold active:translate-x-1'
    : 'bg-secondary-container text-on-secondary-container rounded-full px-4 py-1';

  const inactiveClass = isSidebar
    ? 'text-on-surface-variant hover:bg-surface-container-highest'
    : 'text-on-surface-variant';

  const baseClass = isSidebar
    ? 'px-4 py-3 flex items-center gap-3 transition-all cursor-pointer'
    : 'flex-1 flex flex-col items-center justify-center py-2';

  const labelClass = isSidebar
    ? 'font-micro text-micro uppercase tracking-wider'
    : 'font-micro text-[10px]';

  return (
    <Link
      href={href}
      className={`${baseClass} relative ${active ? activeClass : inactiveClass} ${className}`}
    >
      <span className={`material-symbols-outlined ${active ? 'filled' : ''}`}>
        {icon}
      </span>
      <span className={labelClass}>
        {label}
      </span>
      {badge !== undefined && badge > 0 && (
        <span
          className={`absolute flex items-center justify-center rounded-full bg-brand-orange-dark text-white font-bold ${
            isSidebar
              ? 'right-3 top-1/2 -translate-y-1/2 h-5 min-w-5 px-1 text-[10px]'
              : 'top-0.5 right-3 h-4 min-w-4 px-1 text-[9px]'
          }`}
        >
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </Link>
  );
}
