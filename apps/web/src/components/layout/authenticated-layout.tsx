'use client';

import { ApolloProvider } from '../providers/apollo-provider';
import { AppShell } from './app-shell';

export function AuthenticatedLayout({ children }: { readonly children: React.ReactNode }) {
  return (
    <ApolloProvider>
      <AppShell>{children}</AppShell>
    </ApolloProvider>
  );
}
