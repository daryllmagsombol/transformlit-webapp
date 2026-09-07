import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { GraphQLUser } from '@transformlit/shared';
import { setAccessToken, clearAuth as clearAuthStorage } from '../lib/auth';

interface AuthStore {
  user: GraphQLUser | null;
  isHydrated: boolean;
  setAuth: (user: GraphQLUser, accessToken: string) => void;
  setUser: (user: GraphQLUser) => void;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      user: null,
      isHydrated: false,
      setAuth: (user, accessToken) => {
        // Access token lives in browser memory ONLY (never persisted).
        setAccessToken(accessToken);
        set({ user });
      },
      setUser: (user) => set({ user }),
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
        const persisted = persistedState as Partial<AuthStore> | undefined;
        const current = currentState as AuthStore;

        // If the current state already has a user (set by setAuth before
        // rehydration completed), prefer it over persisted state to avoid
        // overwriting fresh auth data.
        if (current.user) {
          return { ...current, ...persisted, user: current.user, isHydrated: true };
        }

        // Normal merge: persisted state fills in missing values, mark hydrated
        return { ...current, ...persisted, isHydrated: true };
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
