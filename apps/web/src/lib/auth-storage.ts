const TOKEN_KEY = "transformlit_token";
const TENANT_KEY = "transformlit_tenant";
const USER_KEY = "transformlit_user";

export type StoredTenant = {
  id: string;
  name: string;
  slug: string;
};

export type StoredUser = {
  id: string;
  email: string;
  role: string;
};

export function getAuthToken() {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function getStoredTenant(): StoredTenant | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(TENANT_KEY);
  return raw ? (JSON.parse(raw) as StoredTenant) : null;
}

export function getStoredUser(): StoredUser | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(USER_KEY);
  return raw ? (JSON.parse(raw) as StoredUser) : null;
}

export function setAuthState(
  token: string,
  tenant: StoredTenant,
  user: StoredUser,
) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TOKEN_KEY, token);
  window.localStorage.setItem(TENANT_KEY, JSON.stringify(tenant));
  window.localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearAuthState() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(TENANT_KEY);
  window.localStorage.removeItem(USER_KEY);
}
