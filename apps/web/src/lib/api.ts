import { getAuthToken } from "./auth-storage";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
  "http://localhost:3005";

export type AuthResponse = {
  token: string;
  tenant: { id: string; name: string; slug: string };
  user: { id: string; email: string; role: string };
};

export type Announcement = {
  id: string;
  title: string;
  body: string;
  status: string;
  publishAt: string | null;
  expiresAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

async function apiFetch<T>(path: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers ?? {});
  headers.set("Content-Type", "application/json");

  const token = getAuthToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const message = errorBody.message ?? "Request failed";
    throw new Error(Array.isArray(message) ? message[0] : message);
  }

  return (await response.json()) as T;
}

export function register(payload: {
  tenantName: string;
  email: string;
  password: string;
  displayName?: string;
}) {
  return apiFetch<AuthResponse>("/auth/register", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function login(payload: {
  tenantSlug: string;
  email: string;
  password: string;
}) {
  return apiFetch<AuthResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function fetchAnnouncements() {
  return apiFetch<Announcement[]>("/announcements");
}

// Friends
export type PublicUser = {
  id: string;
  email: string;
  profile?: { displayName?: string; avatarUrl?: string } | null;
};

export function fetchFriends() {
  return apiFetch<PublicUser[]>("/friends");
}

export function searchFriends(q: string) {
  return apiFetch<PublicUser[]>(`/friends/search?q=${encodeURIComponent(q)}`);
}

export function sendFriendRequest(payload: { addresseeId: string }) {
  return apiFetch("/friends/request", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function acceptFriendRequest(id: string) {
  return apiFetch(`/friends/${id}/accept`, { method: "POST" });
}

export function rejectFriendRequest(id: string) {
  return apiFetch(`/friends/${id}/reject`, { method: "POST" });
}

export function removeFriend(id: string) {
  return apiFetch(`/friends/${id}`, { method: "DELETE" });
}

// Groups and documents APIs will be added similarly.
// Groups
export type Group = {
  id: string;
  name: string;
  description?: string | null;
  visibility: string;
  createdAt: string;
  updatedAt: string;
};

export function fetchGroups() {
  return apiFetch<Group[]>("/groups");
}

export function createGroup(payload: {
  name: string;
  description?: string;
  visibility?: string;
}) {
  return apiFetch<Group>("/groups", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateGroup(
  id: string,
  payload: { name?: string; description?: string; visibility?: string },
) {
  return apiFetch<Group>(`/groups/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function deleteGroup(id: string) {
  return apiFetch(`/groups/${id}`, { method: "DELETE" });
}

export function addGroupMember(
  groupId: string,
  payload: { userId: string; role?: string },
) {
  return apiFetch(`/groups/${groupId}/members`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function removeGroupMember(groupId: string, memberId: string) {
  return apiFetch(`/groups/${groupId}/members/${memberId}`, {
    method: "DELETE",
  });
}

export function searchGroups(q: string) {
  return apiFetch<Group[]>(`/groups/search?q=${encodeURIComponent(q)}`);
}
