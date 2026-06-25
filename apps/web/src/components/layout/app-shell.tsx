'use client';

import { Sidebar } from './sidebar';
import { TopBar } from './topbar';

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-surface dark:bg-surface-dark paper-texture">
      <TopBar />
      <Sidebar />
      <main className="pt-16 pb-24 md:pb-8 md:pl-[240px] min-h-dvh">
        <div className="max-w-[1200px] mx-auto px-4 md:px-6">
          {children}
        </div>
      </main>
    </div>
  );
}
