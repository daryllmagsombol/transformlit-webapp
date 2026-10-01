import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { GraphQLUser } from '@transformlit/shared';
import {
  type AuthInstallTicket,
  clearAuth as clearAuthStorage,
  isAuthInstallTicket,
  setAccessToken,
} from '../lib/auth';

interface AuthStore {
  user: GraphQLUser | null;
  isHydrated: boolean;
  /**
   * Installs an authenticated user. Requires a lifecycle-issued ticket so a
   * component cannot bypass the account-lifecycle gate. Returns false (and
   * installs nothing) when the ticket is missing or invalid.
   */
  installAuth: (user: GraphQLUser, accessToken: string, ticket: AuthInstallTicket) => boolean;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      user: null,
      isHydrated: false,
      installAuth: (user, accessToken, ticket) => {
        if (!isAuthInstallTicket(ticket)) {
          // Fail closed: no ticket means the caller did not pass the lifecycle
          // gate, so no token or user is installed.
          return false;
        }
        // Access token lives in browser memory ONLY (never persisted).
        setAccessToken(accessToken);
        set({ user });
        return true;
      },
      clearAuth: () => {
        clearAuthStorage();
        set({ user: null });
      },
    }),
    {
      name: 'auth-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ user: state.user }),
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<AuthStore>;

        // A persisted `user` is display-only: it is never treated as proof of
        // ownership or as a valid session. Ownership is re-established through
        // the lifecycle gate on bootstrap.
        if (currentState.user) {
          return { ...currentState, ...persisted, user: currentState.user, isHydrated: true };
        }

        // Normal merge: persisted state fills in missing values, mark hydrated
        return { ...currentState, ...persisted, isHydrated: true };
      },
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          console.error('Failed to rehydrate auth store:', error);
        }
        // No token restoration: the access token is memory-only and the
        // refresh cookie is httpOnly, so a reload must bootstrap the session
        // via POST /auth/refresh rather than anything stored client-side.
      },
    },
  ),
);
