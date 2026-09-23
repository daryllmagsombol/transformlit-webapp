import {
  getAccessToken,
  setAccessToken,
  removeAccessToken,
  clearAuth,
  decodeJwt,
  getTokenExpiry,
  isTokenExpiringSoon,
} from './auth';

function buildJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = btoa(JSON.stringify(payload));
  const sig = btoa('fakesig');
  return `${header}.${body}.${sig}`;
}

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
});
