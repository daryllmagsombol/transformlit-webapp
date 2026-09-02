import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { DEFAULT_TRANSLATION } from '../lib/bible/config';

export type IndexStatus = 'none' | 'building' | 'ready';

interface BibleStore {
  translation: string;
  lastPosition: Record<string, { book: string; chapter: number }>;
  indexStatus: Record<string, IndexStatus>;
  isHydrated: boolean;
  setTranslation: (id: string) => void;
  setLastPosition: (translation: string, pos: { book: string; chapter: number }) => void;
  setIndexStatus: (translation: string, status: IndexStatus) => void;
}

export const useBibleStore = create<BibleStore>()(
  persist(
    (set) => ({
      translation: DEFAULT_TRANSLATION,
      lastPosition: {},
      indexStatus: {},
      isHydrated: false,
      setTranslation: (id) => set({ translation: id }),
      setLastPosition: (translation, pos) =>
        set((s) => ({ lastPosition: { ...s.lastPosition, [translation]: pos } })),
      setIndexStatus: (translation, status) =>
        set((s) => ({ indexStatus: { ...s.indexStatus, [translation]: status } })),
    }),
    {
      name: 'bible-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        translation: state.translation,
        lastPosition: state.lastPosition,
        indexStatus: state.indexStatus,
      }),
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<BibleStore> | undefined;
        return { ...currentState, ...persisted, isHydrated: true };
      },
      onRehydrateStorage: () => (state, error) => {
        if (error) console.error('Failed to rehydrate bible store:', error);
      },
    },
  ),
);