import { create } from 'zustand';
import type { GraphQLUser } from '@transformlit/shared';

interface AuthStore {
  user: GraphQLUser | null;
  token: string | null;
  setAuth: (user: GraphQLUser, token: string) => void;
  clearAuth: () => void;
  isAuthenticated: () => boolean;
}

export const useAuthStore = create<AuthStore>((set, get) => ({
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
}));
