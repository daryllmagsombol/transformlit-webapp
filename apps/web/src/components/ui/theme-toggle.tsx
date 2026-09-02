'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

type ThemeToggleProps = {
  className?: string;
};

export function ThemeToggle({ className = '' }: ThemeToggleProps) {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  if (!mounted) {
    return <div className={`flex items-center gap-3 px-4 py-2 ${className}`}><span className="material-symbols-outlined text-lg">dark_mode</span></div>;
  }

  const isDark = (theme === 'dark') || (theme === 'system' && resolvedTheme === 'dark');

  return (
    <button
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className={`flex items-center gap-3 px-4 py-2 text-on-surface-variant hover:bg-surface-container-highest transition-all text-micro uppercase tracking-wider w-full text-left ${className}`}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      <span className="material-symbols-outlined text-lg">
        {isDark ? 'light_mode' : 'dark_mode'}
      </span>
      {isDark ? 'Light Mode' : 'Dark Mode'}
    </button>
  );
}
