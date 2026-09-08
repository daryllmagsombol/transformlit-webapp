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

interface JwtPayload {
  sub: string;
  exp: number;
  iat: number;
}

export function decodeJwt(token: string): JwtPayload | null {
  try {
    const base64 = token.split('.')[1]?.replaceAll(/-/g, '+').replaceAll(/_/g, '/');
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
