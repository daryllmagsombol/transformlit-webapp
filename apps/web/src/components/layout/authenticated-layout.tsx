'use client';

import { ApolloProvider } from '../providers/apollo-provider';
import { ProfileSheetProvider } from '../friends/profile-sheet-provider';
import { AppShell } from './app-shell';

export function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  return (
    <ApolloProvider>
      <ProfileSheetProvider>
        <AppShell>{children}</AppShell>
      </ProfileSheetProvider>
    </ApolloProvider>
  );
}
