'use client';

import { Sidebar } from './sidebar';
import { TopBar } from './topbar';
import { BottomNav } from './bottom-nav';
import { ScrollToTop } from './scroll-to-top';
import { useUIStore } from '../../store';
import { ProfileSheetProvider } from '../friends/profile-sheet-provider';
import { ChatProvider } from '../chat/chat-provider';

export function AppShell({ children }: { children: React.ReactNode }) {
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);

  return (
    <ProfileSheetProvider>
      <ChatProvider />
      <div className="min-h-dvh bg-surface dark:bg-surface-dark paper-texture">
        <ScrollToTop />
        <TopBar />
        <Sidebar />
        <BottomNav />
        <main
          className={`pt-20 pb-24 md:pb-8 min-h-screen transition-all duration-200 ease-out ${
            sidebarOpen ? 'md:pl-[240px]' : 'md:pl-0'
          }`}
        >
          <div className="max-w-[1200px] mx-auto px-4 md:px-5">
            {children}
          </div>
        </main>
      </div>
    </ProfileSheetProvider>
  );
}
