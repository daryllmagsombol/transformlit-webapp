'use client';

import { useRequireAuth } from '../../lib/hooks/use-require-auth';
import { ApolloProvider } from '../../components/providers/apollo-provider';

export default function ReaderLayout({ children }: { readonly children: React.ReactNode }) {
  const { isReady } = useRequireAuth();
  if (!isReady) return null;
  return <ApolloProvider>{children}</ApolloProvider>;
}
