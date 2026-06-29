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
  isAuthenticated: () => boolean;
  setHydrated: (value: boolean) => void;
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set, get) => ({
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
      isAuthenticated: () => !!get().token,
      setHydrated: (value) => set({ isHydrated: value }),
    }),
    {
      name: 'auth-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ user: state.user, token: state.token }),
      onRehydrateStorage: () => (state) => {
        // Always mark as hydrated after rehydration, even on error,
        // so the UI never gets stuck in a loading state.
        // If rehydration fails, token defaults to null and the user
        // is cleanly redirected to /login instead of being stuck.
        useAuthStore.getState().setHydrated(true);
        if (state) {
          const currentToken = useAuthStore.getState().token;
          if (currentToken) setAccessToken(currentToken);
        }
      },
    },
  ),
);
