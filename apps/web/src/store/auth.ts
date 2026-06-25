import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { GraphQLUser } from '@transformlit/shared';

interface AuthStore {
  user: GraphQLUser | null;
  token: string | null;
  setAuth: (user: GraphQLUser, token: string) => void;
  clearAuth: () => void;
  isAuthenticated: () => boolean;
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      setAuth: (user, token) => {
        localStorage.setItem('accessToken', token);
        set({ user, token });
      },
      clearAuth: () => {
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        set({ user: null, token: null });
      },
      isAuthenticated: () => !!get().token,
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({ user: state.user, token: state.token }),
    },
  ),
);
