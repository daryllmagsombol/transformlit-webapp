'use client';

import Link from 'next/link';
import { motion, useReducedMotion } from 'motion/react';
import { springSnappy } from '../../lib/motion';

type NavItemProps = {
  readonly label: string;
  readonly href: string;
  readonly icon: string;
  readonly active?: boolean;
  readonly variant?: 'sidebar' | 'bottom';
  readonly badge?: number;
  readonly className?: string;
};

export function NavItem({ label, href, icon, active = false, variant = 'sidebar', badge, className = '' }: NavItemProps) {
  const isSidebar = variant === 'sidebar';
  const reduce = useReducedMotion();

  // The active background lives on a shared-`layoutId` layer so it slides
  // between destinations instead of jumping. Reduced motion keeps the same
  // element but renders it without animating.
  const indicatorId = isSidebar ? 'sidebar-nav-indicator' : 'bottom-nav-indicator';
  const indicatorClass = isSidebar
    ? 'absolute inset-0 rounded-md bg-primary-container dark:bg-primary-fixed-variant'
    : 'absolute inset-x-1 inset-y-0.5 rounded-full bg-secondary-container';

  const activeClass = isSidebar
    ? 'text-on-primary-container font-bold border-l-4 border-primary'
    : 'text-on-secondary-container rounded-full';

  const inactiveClass = isSidebar
    ? 'text-on-surface-variant hover:bg-surface-container-highest'
    : 'text-on-surface-variant';

  const baseClass = isSidebar
    ? 'px-4 py-3 flex items-center gap-3 transition-colors cursor-pointer'
    : 'flex-1 flex flex-col items-center justify-center py-2';

  const labelClass = isSidebar
    ? 'font-micro text-micro uppercase tracking-wider'
    : 'font-micro text-[10px]';

  return (
    <Link
      href={href}
      className={`${baseClass} relative ${active ? activeClass : inactiveClass} ${className}`}
    >
      {active && (
        <motion.span
          layoutId={indicatorId}
          className={indicatorClass}
          transition={reduce === true ? { duration: 0 } : springSnappy}
          aria-hidden="true"
        />
      )}
      <span className={`material-symbols-outlined relative z-10 ${active ? 'filled' : ''}`}>
        {icon}
      </span>
      <span className={`${labelClass} relative z-10`}>
        {label}
      </span>
      {badge !== undefined && badge > 0 && (
        <span
          className={`absolute z-10 flex items-center justify-center rounded-full bg-brand-orange-dark text-white font-bold ${
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
