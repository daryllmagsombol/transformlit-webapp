'use client';

import { ApolloProvider as Provider } from '@apollo/client/react';
import { apolloClient } from '../../lib/apollo-client';

export function ApolloProvider({ children }: { readonly children: React.ReactNode }) {
  return <Provider client={apolloClient}>{children}</Provider>;
}
