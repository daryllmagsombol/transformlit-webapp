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
  AuthHttpError,
  clearAuth,
  decodeJwt,
  getAccessToken,
  isTokenExpiringSoon,
  withAuthLifecycleLock,
} from './auth';
import {
  captureOriginEpoch,
  hydrateAccountLifecycle,
  installEpochTaggedAuth,
  markAuthRequired,
  markTransient,
} from './offline/account-activation';
import { classifyAuthError } from './offline/account-lifecycle';
import type { AuthFailureClassification } from './offline/contracts';
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

/** Clears the in-memory token and persisted display profile on genuine 401. */
function clearAuthSession(): void {
  clearAuth();
  useAuthStore.getState().clearAuth();
}

type AuthRedirect = () => void;

function defaultAuthRedirect(): void {
  if (!isServer) {
    globalThis.window.location.href = '/login';
  }
}

// Navigation is a side-effecting boundary; tests inject a recorder so the
// transient-vs-401 policy can be asserted without driving jsdom navigation.
let redirectOnAuthRequired: AuthRedirect = defaultAuthRedirect;

export function setAuthRedirectForTests(redirect: AuthRedirect | null): void {
  redirectOnAuthRequired = redirect ?? defaultAuthRedirect;
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
    // Carry the HTTP status so callers can distinguish a genuine 401 from a
    // transient 5xx without destructive local cleanup.
    throw new AuthHttpError(response.status, `Refresh failed: ${response.status}`);
  }

  return (await response.json()) as RestRefreshPayload;
}

/**
 * Fails closed on a genuine authentication failure: marks replay paused,
 * clears BOTH the in-memory token and the persisted display profile
 * (unconditionally, so a pre-hydration 401 cannot leave a stale `user` in
 * `auth-storage`), and — when `redirect` is true — navigates to the login page.
 *
 * The redirect is suppressed for the bootstrap path: `bootstrapAuth()` runs on
 * the login page itself, so redirecting on a genuine 401 would reload /login,
 * re-enter bootstrap, and loop forever.
 */
function requireAuth(redirect: boolean): void {
  markAuthRequired();
  clearAuthSession();
  if (redirect) redirectOnAuthRequired();
}

/**
 * Verifies the immutable subject from the access token and installs the session
 * through the lifecycle gate. Returns false (installing nothing) when the token
 * has no verifiable subject. A missing/invalid subject is an authentication
 * failure, not a transient one, so it also marks replay auth-required and clears
 * the dead session; `redirect` controls whether the login navigation happens
 * (false on the bootstrap path, which already runs on /login).
 */
async function installVerifiedSession(
  payload: RestRefreshPayload,
  originEpoch: number,
  redirect: boolean,
): Promise<boolean> {
  const subject = decodeJwt(payload.accessToken)?.sub;
  if (!subject) {
    requireAuth(redirect);
    return false;
  }

  const outcome = await installEpochTaggedAuth(
    { epoch: originEpoch, subject, value: payload },
    (ticket) => useAuthStore.getState().installAuth(payload.user, payload.accessToken, ticket),
  );
  return outcome.status === 'INSTALLED';
}

/**
 * Handles a failed refresh/bootstrap according to classification. Only a
 * genuine `AUTH_REQUIRED` failure may clear the session (and, for the refresh
 * path, redirect to login); a `TRANSIENT` network/5xx failure preserves the
 * in-memory token, the persisted profile, and the current route, returning false
 * so callers simply pause auth-dependent work. `options.redirect` defaults to
 * true and is set false by the bootstrap path, which must never self-redirect
 * from the login page. Returns the classification for callers.
 */
function handleRefreshFailure(
  error: unknown,
  options: { readonly redirect?: boolean } = {},
): AuthFailureClassification {
  const classification = classifyAuthError(error);
  if (classification === 'AUTH_REQUIRED') {
    requireAuth(options.redirect ?? true);
  } else {
    markTransient();
  }
  return classification;
}

async function doRefreshTokens(): Promise<boolean> {
  // Skip if the in-memory access token is still valid.
  const currentToken = getAccessToken();
  if (currentToken && !isTokenExpiringSoon(currentToken)) {
    return true;
  }

  lastRefreshAttempt = Date.now();
  const originEpoch = await captureOriginEpoch();
  try {
    const payload = await callRestRefresh();
    return await installVerifiedSession(payload, originEpoch, true);
  } catch (error) {
    handleRefreshFailure(error);
    return false;
  }
}

/**
 * Serializes cookie-rotating refreshes across tabs on the SHARED auth-lifecycle
 * lock, which is also held by login/registration and logout. This makes a
 * delayed logout/refresh response unable to cross into a newly activated
 * session. Tokens only ever travel in the response body.
 */
async function withCookieRefreshLock(run: () => Promise<boolean>): Promise<boolean> {
  return withAuthLifecycleLock(run);
}

export function refreshTokens(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = withCookieRefreshLock(doRefreshTokens).finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

/**
 * Restores an existing session on cold start / OAuth redirect: if an access
 * token is already present (memory) it is a no-op; otherwise it tries the REST
 * refresh endpoint using the httpOnly cookie. Because this runs on the login
 * page, a genuine 401 is classified AUTH_REQUIRED (mark + clear) but NEVER
 * redirects — redirecting would reload /login and loop.
 */
async function bootstrapAttempt(): Promise<boolean> {
  const originEpoch = await captureOriginEpoch();
  try {
    const payload = await callRestRefresh();
    return await installVerifiedSession(payload, originEpoch, false);
  } catch (error) {
    const classification = handleRefreshFailure(error, { redirect: false });
    if (classification === 'TRANSIENT') {
      // A cold-start network/5xx outage must preserve the persisted profile so
      // the user is not silently signed out; only a genuine 401 clears state.
      return false;
    }
    // Genuine 401: `handleRefreshFailure` already cleared the session (marking
    // replay auth-required) WITHOUT redirecting. A concurrent manual login may
    // have established a fresh session in the meantime; never clear that — it
    // would bounce a just-signed-in user back to /login.
    return false;
  }
}

export async function bootstrapAuth(): Promise<boolean> {
  // Restore an established local owner on cold start so the different-subject
  // fail-closed guard applies across restarts.
  await hydrateAccountLifecycle();
  const hadTokenAtStart = getAccessToken() !== null;
  if (hadTokenAtStart) return true;
  // Share the cookie-rotation lock so a bootstrap cannot race a refresh in
  // another tab and double-rotate the refresh cookie.
  return withCookieRefreshLock(bootstrapAttempt);
}

/**
 * True only for a genuine authentication failure: the GraphQL
 * `UNAUTHENTICATED` error code, or an HTTP 401. Deliberately does NOT match on
 * message substrings — a business error such as "Unauthorized action" must not
 * trigger a token refresh + retry (and, on failure, a forced logout).
 */
function isUnauthorizedError(error: unknown): boolean {
  if (CombinedGraphQLErrors.is(error)) {
    return error.errors.some((err) => {
      const code = (err as { extensions?: { code?: string } }).extensions?.code;
      return code === 'UNAUTHENTICATED';
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
      ...(prevContext as { headers?: Record<string, string> })?.headers,
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
