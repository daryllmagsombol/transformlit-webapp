'use client';

import { usePathname } from 'next/navigation';
import { Sidebar } from './sidebar';
import { TopBar } from './topbar';
import { BottomNav } from './bottom-nav';
import { ScrollToTop } from './scroll-to-top';
import { useUIStore } from '../../store';
import { ProfileSheetProvider } from '../friends/profile-sheet-provider';
import { ChatProvider } from '../chat/chat-provider';
import { SyncStatusConnected } from '../offline/sync-status-connected';

export function AppShell({ children }: { readonly children: React.ReactNode }) {
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const pathname = usePathname();
  // Chat is full-bleed: it escapes the centered reading column and fills the
  // space between the fixed TopBar (h-16 / 64px) and the mobile BottomNav
  // (~68px) with its own internal scroll. Every other route keeps the default
  // padded, centered layout.
  const isChat = pathname === '/chat' || pathname.startsWith('/chat/');
  // The non-personalized offline hub must render without chat/social providers:
  // those providers open realtime subscriptions and personalized state that are
  // not available offline and must not gate or contaminate offline reading.
  const isOffline = pathname === '/offline' || pathname.startsWith('/offline/');

  const shell = (
    <div className="min-h-dvh bg-surface dark:bg-surface-dark paper-texture">
      <ScrollToTop />
      <TopBar />
      <Sidebar />
      <BottomNav />
      {isChat ? (
        <main
          className={`h-dvh overflow-hidden pt-16 pb-[68px] md:pb-0 transition-all duration-200 ease-out ${
            sidebarOpen ? 'md:pl-[240px]' : 'md:pl-0'
          }`}
        >
          {/*
            `minmax(0,1fr)` gives the row a zero minimum so the panes' content
            can never stretch it — it stays at the definite viewport-derived
            height. `min-h-0` on the wrapper does the same for the grid box.
            Without the zero minimum the desktop list would grow the page.
          */}
          <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)]">{children}</div>
        </main>
      ) : (
        <main
          className={`pt-20 pb-24 md:pb-8 min-h-screen transition-all duration-200 ease-out ${
            sidebarOpen ? 'md:pl-[240px]' : 'md:pl-0'
          }`}
        >
          <div className="max-w-[1200px] mx-auto px-4 md:px-5">
            <SyncStatusConnected />
            {children}
          </div>
        </main>
      )}
    </div>
  );

  if (isOffline) return shell;

  return (
    <ProfileSheetProvider>
      <ChatProvider />
      {shell}
    </ProfileSheetProvider>
  );
}
