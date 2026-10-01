import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { DEFAULT_TRANSLATION } from '../lib/bible/config';

export type IndexStatus = 'none' | 'building' | 'ready';

interface BibleStore {
  translation: string;
  /** Locally established account subject; null means no account is active. */
  subject: string | null;
  lastPosition: Record<string, { book: string; chapter: number }>;
  indexStatus: Record<string, IndexStatus>;
  isHydrated: boolean;
  setTranslation: (id: string) => void;
  /**
   * Binds navigation preferences to an account. Switching subjects resets the
   * per-account position and search-index markers so one account's progress
   * never appears under another. Re-selecting the same subject is a no-op.
   *
   * FORWARD REFERENCE (Task 13A, same lane): this seam is currently UNWIRED —
   * no production code calls it yet, so a stale position could still surface
   * across accounts until the auth/lifecycle transition invokes it. Task 13A
   * MUST call `setAccountSubject(verifiedSubject)` on every activation path
   * (bootstrap, login, registration, OAuth, refresh) after the immutable
   * subject is verified and before private content is shown.
   */
  setAccountSubject: (subject: string | null) => void;
  setLastPosition: (translation: string, pos: { book: string; chapter: number }) => void;
  setIndexStatus: (translation: string, status: IndexStatus) => void;
}

interface PersistedBibleState {
  translation: string;
  subject: string | null;
  lastPosition: Record<string, { book: string; chapter: number }>;
  indexStatus: Record<string, IndexStatus>;
}

function selectPersisted(state: BibleStore): PersistedBibleState {
  return {
    translation: state.translation,
    subject: state.subject,
    lastPosition: state.lastPosition,
    indexStatus: state.indexStatus,
  };
}

/** Drops any stored position/index belonging to a different account subject. */
function scopeToSubject(state: BibleStore, subject: string | null): Partial<BibleStore> {
  if (state.subject === subject) return selectPersisted(state);
  return { translation: state.translation, subject, lastPosition: {}, indexStatus: {} };
}

export const useBibleStore = create<BibleStore>()(
  persist(
    (set) => ({
      translation: DEFAULT_TRANSLATION,
      subject: null,
      lastPosition: {},
      indexStatus: {},
      isHydrated: false,
      setTranslation: (id) => set({ translation: id }),
      setAccountSubject: (subject) => set((s) => scopeToSubject(s, subject)),
      setLastPosition: (translation, pos) =>
        set((s) => ({ lastPosition: { ...s.lastPosition, [translation]: pos } })),
      setIndexStatus: (translation, status) =>
        set((s) => ({ indexStatus: { ...s.indexStatus, [translation]: status } })),
    }),
    {
      name: 'bible-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: selectPersisted,
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<BibleStore> | undefined;
        // Only restore navigation prefs when the persisted account still
        // matches the current subject; otherwise a stale owner's position must
        // not be adopted by whoever is active now.
        if (persisted?.subject !== null && persisted?.subject !== currentState.subject) {
          return { ...currentState, isHydrated: true };
        }
        return { ...currentState, ...persisted, isHydrated: true };
      },
      onRehydrateStorage: () => (state, error) => {
        if (error) console.error('Failed to rehydrate bible store:', error);
      },
    },
  ),
);
