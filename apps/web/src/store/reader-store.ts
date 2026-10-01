import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type ReaderTheme = 'paper' | 'sepia' | 'warm' | 'dark';
export type ReaderMode = 'paged' | 'scroll';

interface ReaderStore {
  theme: ReaderTheme;
  mode: ReaderMode;
  zoom: number;
  isHydrated: boolean;
  setTheme: (theme: ReaderTheme) => void;
  setMode: (mode: ReaderMode) => void;
  setZoom: (zoom: number) => void;
}

interface PersistedReaderState {
  theme: ReaderTheme;
  mode: ReaderMode;
  zoom: number;
}

// Version 2 drops the legacy `lastPage` map. Reading position is now owned by
// the account-scoped offline store; the old unscoped localStorage value must
// never be assigned to an account, so migration intentionally discards it.
const READER_PERSIST_VERSION = 2;

function selectPersisted(state: ReaderStore): PersistedReaderState {
  return { theme: state.theme, mode: state.mode, zoom: state.zoom };
}

/**
 * Version 1 persisted `lastPage` alongside presentation prefs. Returning users
 * must keep `{theme,mode,zoom}` while the ambiguous unscoped progress is
 * dropped — it is never assigned to an account.
 */
function migratePersistedState(persisted: unknown): PersistedReaderState {
  const legacy = (persisted ?? {}) as Partial<ReaderStore>;
  return {
    theme: legacy.theme ?? 'paper',
    mode: legacy.mode ?? 'paged',
    zoom: legacy.zoom ?? 1,
  };
}

export const useReaderStore = create<ReaderStore>()(
  persist(
    (set) => ({
      theme: 'paper',
      mode: 'paged',
      zoom: 1,
      isHydrated: false,
      setTheme: (theme) => set({ theme }),
      setMode: (mode) => set({ mode }),
      setZoom: (zoom) => set({ zoom }),
    }),
    {
      name: 'reader-storage',
      version: READER_PERSIST_VERSION,
      storage: createJSONStorage(() => localStorage),
      partialize: selectPersisted,
      migrate: migratePersistedState,
      // Rebuild state explicitly so legacy/unknown keys (including `lastPage`)
      // cannot leak back into the store from previously persisted JSON.
      merge: (persisted, current) => ({
        ...current,
        ...selectPersisted({ ...current, ...(persisted as Partial<ReaderStore> | undefined) }),
        isHydrated: true,
      }),
    },
  ),
);
