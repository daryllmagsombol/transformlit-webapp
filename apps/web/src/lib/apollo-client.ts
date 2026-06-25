import {
  ApolloClient,
  InMemoryCache,
  createHttpLink,
  split,
} from '@apollo/client';
import { setContext } from '@apollo/client/link/context';
import { GraphQLWsLink } from '@apollo/client/link/subscriptions';
import { createClient } from 'graphql-ws';
import { getMainDefinition } from '@apollo/client/utilities';

const httpUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3005/graphql';
const wsUrl = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3005/graphql';

const isServer = typeof window === 'undefined';

const httpLink = createHttpLink({
  uri: httpUrl,
  credentials: 'include',
  fetch: !isServer ? undefined : undefined, // use default fetch
});

/** Auth middleware — attaches Bearer token to every HTTP request */
const authLink = setContext((_, { headers }) => {
  const token = isServer ? null : localStorage.getItem('accessToken');
  return {
    headers: {
      ...headers,
      authorization: token ? `Bearer ${token}` : '',
    },
  };
});

const wsLink = !isServer
  ? new GraphQLWsLink(
      createClient({
        url: wsUrl,
        connectionParams: () => {
          const token = localStorage.getItem('accessToken');
          return { authorization: token ? `Bearer ${token}` : '' };
        },
      }),
    )
  : null;

const splitLink = !isServer && wsLink
  ? split(
      ({ query }) => {
        const definition = getMainDefinition(query);
        return (
          definition.kind === 'OperationDefinition' &&
          definition.operation === 'subscription'
        );
      },
      wsLink,
      httpLink,
    )
  : httpLink;

export const apolloClient = new ApolloClient({
  link: authLink.concat(splitLink),
  ssrMode: isServer,
  cache: new InMemoryCache({
    typePolicies: {
      Query: {
        fields: {
          messages: {
            keyArgs: ['conversationId'],
            merge(existing, incoming) {
              return incoming;
            },
          },
        },
      },
    },
  }),
  defaultOptions: {
    watchQuery: { fetchPolicy: 'cache-and-network' },
    query: { fetchPolicy: 'no-cache' },
  },
});
