import {
  ApolloClient,
  ApolloLink,
  InMemoryCache,
  CombinedGraphQLErrors,
} from '@apollo/client';
import { HttpLink } from '@apollo/client/link/http';
import { SetContextLink } from '@apollo/client/link/context';
import { ErrorLink } from '@apollo/client/link/error';
import { GraphQLWsLink } from '@apollo/client/link/subscriptions';
import { OperationTypeNode } from 'graphql';
import { Observable } from 'rxjs';
import { createClient } from 'graphql-ws';
import type { GraphQLUser } from '@transformlit/shared';
import { useAuthStore } from '../store';
import {
  clearAuth,
  getAccessToken,
  isTokenExpiringSoon,
  setAccessToken,
} from './auth';
import { API_BASE } from './constants';

const httpUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3005/graphql';
const wsUrl = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3005/graphql';

const isServer = globalThis.window === undefined;

/* ------------------------------------------------------------------ */
/*  Token refresh helpers                                             */
/* ------------------------------------------------------------------ */

let refreshPromise: Promise<boolean> | null = null;
let lastRefreshAttempt = 0;
const MIN_REFRESH_INTERVAL_MS = 30_000;

interface RestRefreshPayload {
  accessToken: string;
  user: GraphQLUser;
}

function redirectToLogin() {
  clearAuth();
  useAuthStore.getState().clearAuth();
  if (!isServer) {
    globalThis.window.location.href = '/login';
  }
}

/**
 * Calls the REST refresh endpoint. The httpOnly `transformlit_refresh` cookie
 * is sent automatically via credentials:'include'; no token is read from JS.
 */
async function callRestRefresh(): Promise<RestRefreshPayload> {
  const response = await fetch(`${API_BASE}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });

  if (!response.ok) {
    throw new Error(`Refresh failed: ${response.status}`);
  }

  return (await response.json()) as RestRefreshPayload;
}

async function doRefreshTokens(): Promise<boolean> {
  // Skip if the in-memory access token is still valid.
  const currentToken = getAccessToken();
  if (currentToken && !isTokenExpiringSoon(currentToken)) {
    return true;
  }

  lastRefreshAttempt = Date.now();
  try {
    const payload = await callRestRefresh();
    setAccessToken(payload.accessToken);
    useAuthStore.getState().setAuth(payload.user, payload.accessToken);
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

/**
 * Restores an existing session on cold start / OAuth redirect: if an access
 * token is already present (memory) it is a no-op; otherwise it tries the REST
 * refresh endpoint using the httpOnly cookie. On failure the user is treated
 * as signed out (no hard redirect — callers decide).
 */
export async function bootstrapAuth(): Promise<boolean> {
  if (getAccessToken()) return true;
  try {
    const payload = await callRestRefresh();
    setAccessToken(payload.accessToken);
    useAuthStore.getState().setAuth(payload.user, payload.accessToken);
    return true;
  } catch {
    clearAuth();
    useAuthStore.getState().clearAuth();
    return false;
  }
}

function isUnauthorizedError(error: unknown): boolean {
  if (CombinedGraphQLErrors.is(error)) {
    return error.errors.some((err) => {
      const code = (err as { extensions?: { code?: string } }).extensions?.code;
      return (
        code === 'UNAUTHENTICATED' ||
        err.message?.toLowerCase().includes('unauthorized') === true
      );
    });
  }
  if (
    error &&
    typeof error === 'object' &&
    'statusCode' in error &&
    (error as { statusCode?: number }).statusCode === 401
  ) {
    return true;
  }
  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    String((error as { message?: unknown }).message).toLowerCase().includes('unauthorized')
  ) {
    return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/*  WS reconnect handlers                                             */
/* ------------------------------------------------------------------ */

const wsReconnectHandlers = new Set<() => void>();

/**
 * Registers a callback invoked when the GraphQL WS connection is
 * re-established after a network drop (graphql-ws auto-retry). Kept in
 * this module so chat consumers can subscribe without a circular import
 * (chat-queries already imports apollo-client).
 */
export function registerWsReconnectHandler(handler: () => void): void {
  wsReconnectHandlers.add(handler);
}

export function unregisterWsReconnectHandler(handler: () => void): void {
  wsReconnectHandlers.delete(handler);
}

function notifyWsReconnected(): void {
  wsReconnectHandlers.forEach((handler) => {
    try {
      handler();
    } catch {
      // a failing handler must not break the remaining subscribers
    }
  });
}

/* ------------------------------------------------------------------ */
/*  Apollo links                                                      */
/* ------------------------------------------------------------------ */

const httpLink = new HttpLink({
  uri: httpUrl,
  credentials: 'include',
});

const authLink = new SetContextLink((prevContext, _operation) => {
  const token = isServer ? null : getAccessToken();
  return {
    headers: {
      ...((prevContext as { headers?: Record<string, string> })?.headers ?? {}),
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
    return new Observable((subscriber) => {
      refreshTokens()
        .then((success) => {
          if (!success) throw new Error('Session expired');
          return forward(operation);
        })
        .then((observable) => {
          observable.subscribe(subscriber);
        })
        .catch((err) => subscriber.error(err));
    });
  }
  return forward(operation);
});

/**
 * Intercepts 401/UNAUTHENTICATED responses, performs a rotating refresh,
 * and retries the failed request with the new access token.
 */
const errorLink = new ErrorLink(({ error, operation, forward }) => {
  if (isUnauthorizedError(error)) {
    // Login/registration hit unauthenticated endpoints: an "Invalid credentials"
    // (UNAUTHENTICATED) response is a business error, NOT an expired session.
    // Intercepting it here would try a refresh, find no session, and force a
    // page reload — destroying the form and any error toast mid-login.
    const isLoginOrRegister = operation.operationName === 'LoginLocal' || operation.operationName === 'RegisterLocal';
    if (isLoginOrRegister) return;

    const context = operation.getContext();
    if (context.authRetry) return;
    operation.setContext({ ...context, authRetry: true });

    return new Observable((subscriber) => {
      // No-session case: refreshTokens() fails fast via the REST refresh call
      // (401 without a cookie) and redirects to login.
      refreshTokens()
        .then((success) => {
          if (!success) throw new Error('Session expired');
          const token = getAccessToken();
          operation.setContext(({ headers = {} }) => ({
            headers: {
              ...headers,
              authorization: token ? `Bearer ${token}` : '',
            },
          }));
          return forward(operation);
        })
        .then((observable) => {
          observable.subscribe(subscriber);
        })
        .catch((err) => subscriber.error(err));
    });
  }
});

const wsLink = isServer
  ? null
  : new GraphQLWsLink(
      createClient({
        url: wsUrl,
        connectionParams: async () => {
          // Ensure a fresh in-memory access token BEFORE the socket opens.
          // After a full page load the persisted `user` restores instantly but
          // the memory-only access token is gone (and it is not persisted), so
          // an immediate subscribe would send an empty Authorization header and
          // the WS connection dies — HTTP self-heals via the error link's
          // 401→refresh, but a WebSocket cannot. Refreshing here (a no-op when
          // the token is still valid) makes the realtime layer as resilient as
          // the HTTP layer.
          const token = getAccessToken();
          if (token && !isTokenExpiringSoon(token)) {
            return { authorization: `Bearer ${token}` };
          }
          const ok = await refreshTokens();
          const fresh = getAccessToken();
          return { authorization: ok && fresh ? `Bearer ${fresh}` : '' };
        },
        on: {
          // graphql-ws v6 has no `reconnected` event; the `connected` listener
          // receives `wasRetry`, which is true only for reconnects after a
          // network drop. Fire so the chat store can refetch conversations.
          connected: (_socket, _payload, wasRetry) => {
            if (wasRetry) notifyWsReconnected();
          },
        },
      }),
    );

const splitLink =
  isServer || wsLink === null
    ? httpLink
    : ApolloLink.split(
        ({ operationType }) => {
          return operationType === OperationTypeNode.SUBSCRIPTION;
        },
        wsLink,
        httpLink,
      );

export const apolloClient = new ApolloClient({
  link: ApolloLink.from([errorLink, proactiveRefreshLink, authLink, splitLink]),
  ssrMode: isServer,
  cache: new InMemoryCache(),
  defaultOptions: {
    watchQuery: { fetchPolicy: 'cache-and-network' },
    query: { fetchPolicy: 'no-cache' },
  },
});

/**
 * Resets the Apollo cache so no data from the previous session (or previous
 * user) survives into the next one. Best-effort by design: a failed reset
 * must never break the logout/sign-in flow, so errors are swallowed here.
 */
export async function resetApolloState(): Promise<void> {
  try {
    await apolloClient.resetStore();
  } catch {
    // A cache reset failure must not interrupt logout or navigation.
  }
}
