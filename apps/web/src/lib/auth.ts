// The access token is short-lived (15m) and kept ONLY in browser memory.
// The long-lived refresh token is an httpOnly cookie handled by the API and
// is never exposed to JS or persisted to localStorage.
let memoryAccessToken: string | null = null;

export function getAccessToken(): string | null {
  return memoryAccessToken;
}

export function setAccessToken(token: string): void {
  memoryAccessToken = token;
}

export function removeAccessToken(): void {
  memoryAccessToken = null;
}

export function clearAuth(): void {
  removeAccessToken();
}

/** The subset of the Web Locks API the auth lifecycle uses. */
interface AuthLockManager {
  request<T>(
    name: string,
    options: { mode?: 'exclusive' | 'shared' },
    callback: () => Promise<T>,
  ): Promise<T>;
}

/**
 * How many auth-lifecycle lock frames the current agent (tab) is nested inside.
 * Web Locks is NOT reentrant, so a nested call that re-acquired the same lock
 * would deadlock. The login flow reaches `invalidateSession` through
 * `hydrate → resumeExit → logout` WHILE holding this lock, so nested calls must
 * reuse the lock the outer operation already holds instead of re-acquiring it.
 * Independent (depth 0) calls still serialize on the cross-tab Web Lock.
 */
let authLockDepth = 0;

function authLockManager(): AuthLockManager | null {
  const nav = globalThis.navigator as (Navigator & { locks?: AuthLockManager }) | undefined;
  return nav?.locks ?? null;
}

/**
 * Serializes cookie-rotating auth operations (refresh, login/registration,
 * logout, and barrier-resume logout) on ONE exclusive cross-tab lock so a stale
 * `Set-Cookie` response can never land inside a newly activated session. It is
 * reentrancy-aware: a nested same-agent call runs inside the lock the outer
 * operation holds (no deadlock), while independent calls still queue. Tokens are
 * never carried across tabs — the lock only orders the requests. Falls back to
 * running directly where Web Locks is absent.
 */
export function withAuthLifecycleLock<T>(run: () => Promise<T>): Promise<T> {
  if (authLockDepth > 0) return run();
  const locks = authLockManager();
  if (!locks) {
    authLockDepth += 1;
    return (async () => {
      try {
        return await run();
      } finally {
        authLockDepth -= 1;
      }
    })();
  }
  return locks.request('transformlit-auth-lifecycle', { mode: 'exclusive' }, async () => {
    authLockDepth += 1;
    try {
      return await run();
    } finally {
      authLockDepth -= 1;
    }
  });
}

/** Test seam: reset the reentrancy depth between tests. */
export function resetAuthLifecycleLockForTests(): void {
  authLockDepth = 0;
}

/**
 * A one-shot proof that a caller passed through the account-lifecycle gate for
 * a verified subject + epoch. The auth store accepts a token/user only when
 * presented with a valid ticket, so no component can install a session by
 * calling the store setter directly.
 *
 * The type is re-exported here for convenience, but the minter
 * (`issueAuthInstallTicket`) lives in the lifecycle-owned
 * `./offline/install-ticket` module and is NOT part of any public barrel, so a
 * component cannot mint its own ticket.
 */
export type { AuthInstallTicket } from './offline/install-ticket';
export { isAuthInstallTicket } from './offline/install-ticket';

/** An authenticated HTTP failure carrying its status for classification. */
export class AuthHttpError extends Error {
  readonly status: number;

  constructor(status: number, message = `Auth request failed with ${status}`) {
    super(message);
    this.name = 'AuthHttpError';
    this.status = status;
  }
}

interface JwtPayload {
  sub: string;
  exp: number;
  iat: number;
}

export function decodeJwt(token: string): JwtPayload | null {
  try {
    const base64 = token.split('.')[1]?.replaceAll('-', '+').replaceAll('_', '/');
    if (!base64) return null;
    const json = atob(base64);
    return JSON.parse(json) as JwtPayload;
  } catch {
    return null;
  }
}

export function getTokenExpiry(token: string): number | null {
  return decodeJwt(token)?.exp ?? null;
}

/**
 * Returns true when the token is missing, unparseable, or will expire within
 * the given threshold (default 2 minutes).
 */
export function isTokenExpiringSoon(token: string, thresholdSeconds = 120): boolean {
  const exp = getTokenExpiry(token);
  if (!exp) return true;
  return exp * 1000 - Date.now() < thresholdSeconds * 1000;
}
