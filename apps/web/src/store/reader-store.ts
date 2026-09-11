import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type ReaderTheme = 'paper' | 'sepia' | 'warm' | 'dark';
export type ReaderMode = 'paged' | 'scroll';

interface ReaderStore {
  theme: ReaderTheme;
  mode: ReaderMode;
  zoom: number;
  lastPage: Record<string, number>;
  isHydrated: boolean;
  setTheme: (theme: ReaderTheme) => void;
  setMode: (mode: ReaderMode) => void;
  setZoom: (zoom: number) => void;
  setLastPage: (bookId: string, page: number) => void;
}

export const useReaderStore = create<ReaderStore>()(
  persist(
    (set) => ({
      theme: 'paper',
      mode: 'paged',
      zoom: 1,
      lastPage: {},
      isHydrated: false,
      setTheme: (theme) => set({ theme }),
      setMode: (mode) => set({ mode }),
      setZoom: (zoom) => set({ zoom }),
      setLastPage: (bookId, page) => set((s) => ({ lastPage: { ...s.lastPage, [bookId]: page } })),
    }),
    {
      name: 'reader-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        theme: state.theme,
        mode: state.mode,
        zoom: state.zoom,
        lastPage: state.lastPage,
      }),
      merge: (persisted, current) => ({
        ...current,
        ...(persisted as Partial<ReaderStore> | undefined),
        isHydrated: true,
      }),
    },
  ),
);
