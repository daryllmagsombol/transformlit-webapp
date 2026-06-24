'use client';

import { Sidebar } from './sidebar';
import { TopBar } from './topbar';

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-paper">
      <TopBar />
      <Sidebar />
      <main className="pt-[56px] md:pl-[240px] p-4 md:p-6 transition-all">
        <div className="max-w-[1200px] mx-auto">{children}</div>
      </main>
    </div>
  );
}
