import {
  ApolloClient,
  ApolloLink,
  InMemoryCache,
  createHttpLink,
  fromPromise,
  split,
} from '@apollo/client';
import { setContext } from '@apollo/client/link/context';
import { onError } from '@apollo/client/link/error';
import { GraphQLWsLink } from '@apollo/client/link/subscriptions';
import { getMainDefinition } from '@apollo/client/utilities';
import { createClient } from 'graphql-ws';
import type { GraphQLUser } from '@transformlit/shared';
import { useAuthStore } from '../store';
import {
  clearAuth,
  getAccessToken,
  getRefreshToken,
  isTokenExpiringSoon,
  setAccessToken,
  setRefreshToken,
} from './auth';

const httpUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3005/graphql';
const wsUrl = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3005/graphql';

const isServer = typeof window === 'undefined';

/* ------------------------------------------------------------------ */
/*  Token refresh helpers                                             */
/* ------------------------------------------------------------------ */

let refreshPromise: Promise<boolean> | null = null;
let lastRefreshAttempt = 0;
const MIN_REFRESH_INTERVAL_MS = 30_000;

interface RefreshPayload {
  accessToken: string;
  refreshToken: string;
  user: GraphQLUser;
}

function redirectToLogin() {
  clearAuth();
  useAuthStore.getState().clearAuth();
  if (!isServer) {
    window.location.href = '/login';
  }
}

async function callRefreshMutation(refreshToken: string): Promise<RefreshPayload> {
  const response = await fetch(httpUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      query: `
        mutation RefreshToken($refreshToken: String!) {
          refreshToken(refreshToken: $refreshToken) {
            accessToken
            refreshToken
            user { id email displayName avatarUrl role status createdAt }
          }
        }
      `,
      variables: { refreshToken },
    }),
  });

  if (!response.ok) {
    throw new Error(`Refresh failed: ${response.status}`);
  }

  const result = (await response.json()) as {
    data?: { refreshToken: RefreshPayload };
    errors?: Array<{ message?: string }>;
  };

  if (result.errors?.length) {
    throw new Error(result.errors[0].message ?? 'Refresh failed');
  }

  if (!result.data?.refreshToken) {
    throw new Error('Refresh response missing tokens');
  }

  return result.data.refreshToken;
}

async function doRefreshTokens(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    redirectToLogin();
    return false;
  }

  lastRefreshAttempt = Date.now();
  try {
    const payload = await callRefreshMutation(refreshToken);
    setAccessToken(payload.accessToken);
    setRefreshToken(payload.refreshToken);
    useAuthStore
      .getState()
      .setAuth(payload.user, payload.accessToken, payload.refreshToken);
    return true;
  } catch {
    redirectToLogin();
    return false;
  }
}

export function refreshTokens(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = doRefreshTokens().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

function isUnauthorizedError(
  graphQLErrors: readonly { extensions?: { code?: string }; message?: string }[] | undefined,
  networkError: unknown,
): boolean {
  if (graphQLErrors?.length) {
    return graphQLErrors.some((err) => {
      const code = err.extensions?.code;
      return (
        code === 'UNAUTHENTICATED' ||
        err.message?.toLowerCase().includes('unauthorized') === true
      );
    });
  }
  if (
    networkError &&
    typeof networkError === 'object' &&
    'statusCode' in networkError &&
    (networkError as { statusCode?: number }).statusCode === 401
  ) {
    return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/*  Apollo links                                                      */
/* ------------------------------------------------------------------ */

const httpLink = createHttpLink({
  uri: httpUrl,
  credentials: 'include',
});

const authLink = setContext((_, { headers }) => {
  const token = isServer ? null : getAccessToken();
  return {
    headers: {
      ...headers,
      authorization: token ? `Bearer ${token}` : '',
    },
  };
});

/**
 * Proactively refreshes the access token shortly before expiry so that
 * subsequent GraphQL requests rarely hit the error link.
 */
const proactiveRefreshLink = new ApolloLink((operation, forward) => {
  const token = getAccessToken();
  if (
    token &&
    isTokenExpiringSoon(token, 120) &&
    Date.now() - lastRefreshAttempt > MIN_REFRESH_INTERVAL_MS
  ) {
    lastRefreshAttempt = Date.now();
    return fromPromise(
      refreshTokens().then((success) => {
        if (!success) throw new Error('Session expired');
        return forward(operation);
      }),
    ).flatMap((observable) => observable);
  }
  return forward(operation);
});

/**
 * Intercepts 401/UNAUTHENTICATED responses, performs a rotating refresh,
 * and retries the failed request with the new access token.
 */
const errorLink = onError(({ graphQLErrors, networkError, operation, forward }) => {
  if (!isUnauthorizedError(graphQLErrors, networkError)) return;

  const context = operation.getContext();
  if (context.authRetry) return;
  operation.setContext({ ...context, authRetry: true });

  return fromPromise(
    refreshTokens().then((success) => {
      if (!success) throw new Error('Session expired');
      const token = getAccessToken();
      operation.setContext(({ headers = {} }) => ({
        headers: {
          ...headers,
          authorization: token ? `Bearer ${token}` : '',
        },
      }));
      return forward(operation);
    }),
  ).flatMap((observable) => observable);
});

const wsLink = !isServer
  ? new GraphQLWsLink(
      createClient({
        url: wsUrl,
        connectionParams: () => {
          const token = getAccessToken();
          return { authorization: token ? `Bearer ${token}` : '' };
        },
      }),
    )
  : null;

const splitLink =
  !isServer && wsLink
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
  link: ApolloLink.from([errorLink, proactiveRefreshLink, authLink, splitLink]),
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
