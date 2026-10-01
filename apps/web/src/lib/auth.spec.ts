import {
  getAccessToken,
  setAccessToken,
  removeAccessToken,
  clearAuth,
  decodeJwt,
  getTokenExpiry,
  isTokenExpiringSoon,
  withAuthLifecycleLock,
  AuthHttpError,
} from './auth';
import { issueAuthInstallTicket, isAuthInstallTicket } from './offline/install-ticket';

function buildJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = btoa(JSON.stringify(payload));
  const sig = btoa('fakesig');
  return `${header}.${body}.${sig}`;
}

describe('withAuthLifecycleLock', () => {
  interface FakeLockManager {
    request<T>(name: string, options: { mode?: 'exclusive' | 'shared' }, callback: () => Promise<T>): Promise<T>;
  }

  function installFakeLocks(): { maxActive: () => number; names: string[] } {
    let tail: Promise<unknown> = Promise.resolve();
    let active = 0;
    let max = 0;
    const names: string[] = [];
    const manager: FakeLockManager = {
      request: <T>(name: string, _options: { mode?: 'exclusive' | 'shared' }, callback: () => Promise<T>) => {
        names.push(name);
        const run = tail.then(async () => {
          active += 1;
          max = Math.max(max, active);
          try {
            return await callback();
          } finally {
            active -= 1;
          }
        });
        tail = run.then(
          () => undefined,
          () => undefined,
        );
        return run as Promise<T>;
      },
    };
    (globalThis.navigator as unknown as { locks?: FakeLockManager }).locks = manager;
    return { maxActive: () => max, names };
  }

  function removeFakeLocks(): void {
    delete (globalThis.navigator as unknown as { locks?: FakeLockManager }).locks;
  }

  afterEach(() => {
    removeFakeLocks();
  });

  it('serializes auth lifecycle operations so a stale cookie response cannot cross', async () => {
    const fake = installFakeLocks();
    const order: string[] = [];
    const first = withAuthLifecycleLock(async () => {
      order.push('start-1');
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push('end-1');
    });
    const second = withAuthLifecycleLock(async () => {
      order.push('start-2');
      order.push('end-2');
    });

    await Promise.all([first, second]);

    expect(fake.maxActive()).toBe(1);
    expect(order).toEqual(['start-1', 'end-1', 'start-2', 'end-2']);
    expect(fake.names.every((name) => name === 'transformlit-auth-lifecycle')).toBe(true);
  });

  it('runs directly when the Web Locks API is unavailable', async () => {
    removeFakeLocks();
    await expect(withAuthLifecycleLock(async () => 'ok')).resolves.toBe('ok');
  });
});

describe('auth utilities', () => {
  beforeEach(() => {
    clearAuth();
  });

  describe('access token', () => {
    it('returns null when no token is stored', () => {
      expect(getAccessToken()).toBeNull();
    });

    it('stores and retrieves an access token in memory', () => {
      setAccessToken('abc123');
      expect(getAccessToken()).toBe('abc123');
    });

    it('removes the access token', () => {
      setAccessToken('abc123');
      removeAccessToken();
      expect(getAccessToken()).toBeNull();
    });
  });

  describe('clearAuth', () => {
    it('clears the in-memory access token', () => {
      setAccessToken('access');
      clearAuth();
      expect(getAccessToken()).toBeNull();
    });
  });

  describe('decodeJwt', () => {
    it('decodes a valid JWT payload', () => {
      const payload = { sub: 'user-1', exp: 9999999999, iat: 1000000000 };
      const token = buildJwt(payload);
      expect(decodeJwt(token)).toEqual(payload);
    });

    it('returns null for a malformed token', () => {
      expect(decodeJwt('not-a-jwt')).toBeNull();
    });

    it('returns null for an empty string', () => {
      expect(decodeJwt('')).toBeNull();
    });

    it('returns null when payload is not valid JSON', () => {
      const token = `header.${btoa('not-json')}.sig`;
      expect(decodeJwt(token)).toBeNull();
    });

    it('handles base64url characters', () => {
      const payload = { sub: 'user-1', exp: 9999999999, iat: 1000000000 };
      const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
      const body = btoa(JSON.stringify(payload))
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
      const token = `${header}.${body}.sig`;
      expect(decodeJwt(token)).toEqual(payload);
    });
  });

  describe('getTokenExpiry', () => {
    it('returns the exp field from the token', () => {
      const token = buildJwt({ sub: 'u', exp: 1234567890, iat: 1000000000 });
      expect(getTokenExpiry(token)).toBe(1234567890);
    });

    it('returns null for an invalid token', () => {
      expect(getTokenExpiry('bad')).toBeNull();
    });
  });

  describe('isTokenExpiringSoon', () => {
    it('returns true for an invalid token', () => {
      expect(isTokenExpiringSoon('bad')).toBe(true);
    });

    it('returns true for an already-expired token', () => {
      const token = buildJwt({ sub: 'u', exp: 1, iat: 0 });
      expect(isTokenExpiringSoon(token)).toBe(true);
    });

    it('returns true when token expires within the default threshold', () => {
      const exp = Math.floor(Date.now() / 1000) + 60;
      const token = buildJwt({ sub: 'u', exp, iat: 0 });
      expect(isTokenExpiringSoon(token)).toBe(true);
    });

    it('returns false when token expires well after the threshold', () => {
      const exp = Math.floor(Date.now() / 1000) + 3600;
      const token = buildJwt({ sub: 'u', exp, iat: 0 });
      expect(isTokenExpiringSoon(token)).toBe(false);
    });

    it('respects a custom threshold', () => {
      const exp = Math.floor(Date.now() / 1000) + 10;
      const token = buildJwt({ sub: 'u', exp, iat: 0 });
      expect(isTokenExpiringSoon(token, 5)).toBe(false);
      expect(isTokenExpiringSoon(token, 30)).toBe(true);
    });
  });

  describe('auth install tickets', () => {
    it('recognizes a ticket minted by the issuer', () => {
      const ticket = issueAuthInstallTicket('user-a', 3);
      expect(isAuthInstallTicket(ticket)).toBe(true);
      expect(ticket).toEqual({ subject: 'user-a', epoch: 3 });
    });

    it('rejects a plain forged object that never passed the gate', () => {
      expect(isAuthInstallTicket({ subject: 'user-a', epoch: 3 })).toBe(false);
      expect(isAuthInstallTicket(null)).toBe(false);
      expect(isAuthInstallTicket(undefined)).toBe(false);
    });

    it('issues distinct ticket objects for the same identity', () => {
      expect(issueAuthInstallTicket('user-a', 1)).not.toBe(issueAuthInstallTicket('user-a', 1));
    });
  });

  describe('AuthHttpError', () => {
    it('carries the HTTP status for classification', () => {
      const error = new AuthHttpError(401, 'unauthorized');
      expect(error).toBeInstanceOf(Error);
      expect(error.status).toBe(401);
      expect(error.name).toBe('AuthHttpError');
    });
  });
});
