const ACCESS_TOKEN_KEY = 'accessToken';
const REFRESH_TOKEN_KEY = 'refreshToken';

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function setAccessToken(token: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(ACCESS_TOKEN_KEY, token);
}

export function removeAccessToken(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(ACCESS_TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function setRefreshToken(token: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(REFRESH_TOKEN_KEY, token);
}

export function removeRefreshToken(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

export function clearAuth(): void {
  removeAccessToken();
  removeRefreshToken();
}

interface JwtPayload {
  sub: string;
  exp: number;
  iat: number;
}

export function decodeJwt(token: string): JwtPayload | null {
  try {
    const base64 = token.split('.')[1]?.replace(/-/g, '+').replace(/_/g, '/');
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
