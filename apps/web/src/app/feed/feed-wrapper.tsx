'use client';

import { ApolloProvider } from '../../components/providers/apollo-provider';
import { ProfileSheetProvider } from '../../components/friends/profile-sheet-provider';

export function FeedWrapper({ children }: { children: React.ReactNode }) {
  return (
    <ApolloProvider>
      <ProfileSheetProvider>
        {children}
      </ProfileSheetProvider>
    </ApolloProvider>
  );
}
