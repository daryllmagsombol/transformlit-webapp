import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { GraphQLUser } from '@transformlit/shared';
import {
  setAccessToken,
  setRefreshToken,
  clearAuth as clearAuthStorage,
} from '../lib/auth';

interface AuthStore {
  user: GraphQLUser | null;
  token: string | null;
  isHydrated: boolean;
  setAuth: (user: GraphQLUser, token: string, refreshToken?: string) => void;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      isHydrated: false,
      setAuth: (user, token, refreshToken) => {
        setAccessToken(token);
        if (refreshToken) setRefreshToken(refreshToken);
        set({ user, token });
      },
      clearAuth: () => {
        clearAuthStorage();
        set({ user: null, token: null });
      },
    }),
    {
      name: 'auth-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ user: state.user, token: state.token }),
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<AuthStore> | undefined;
        const current = currentState as AuthStore;

        // If current state has a token (set by setAuth before rehydration completed),
        // prefer it over the persisted state to avoid overwriting fresh auth data
        if (current.token) {
          return { ...current, ...persisted, user: current.user, token: current.token, isHydrated: true };
        }

        // Normal merge: persisted state fills in missing values, mark hydrated
        return { ...current, ...persisted, isHydrated: true };
      },
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          console.error('Failed to rehydrate auth store:', error);
        }
        if (state?.token) {
          setAccessToken(state.token);
        }
      },
    },
  ),
);
