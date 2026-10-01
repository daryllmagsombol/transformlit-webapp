import { useReaderStore } from './reader-store';

describe('reader store', () => {
  beforeEach(() => {
    useReaderStore.setState({ theme: 'paper', mode: 'paged', zoom: 1 });
  });

  it('sets theme, mode and zoom', () => {
    useReaderStore.getState().setTheme('sepia');
    useReaderStore.getState().setMode('scroll');
    useReaderStore.getState().setZoom(1.25);
    const state = useReaderStore.getState();
    expect(state.theme).toBe('sepia');
    expect(state.mode).toBe('scroll');
    expect(state.zoom).toBe(1.25);
  });

  it('no longer owns authoritative last-page persistence', () => {
    const state = useReaderStore.getState() as unknown as Record<string, unknown>;
    expect('lastPage' in state).toBe(false);
    expect('setLastPage' in state).toBe(false);
  });

  it('persists only harmless presentation preferences', () => {
    const partialize = useReaderStore.persist.getOptions().partialize;
    const persisted = (partialize ? partialize(useReaderStore.getState()) : {}) as Record<string, unknown>;
    expect(Object.keys(persisted).sort()).toEqual(['mode', 'theme', 'zoom']);

    // Zustand's actual JSON storage must not carry progress either.
    expect(globalThis.localStorage.getItem('reader-storage') ?? '').not.toContain('lastPage');
  });

  it('migrates v1 state by keeping presentation prefs and dropping lastPage', () => {
    const migrate = useReaderStore.persist.getOptions().migrate;
    expect(migrate).toBeDefined();

    const legacyV1 = {
      theme: 'sepia',
      mode: 'scroll',
      zoom: 1.5,
      lastPage: { 'book-1': 12, 'book-2': 3 },
    };
    const migrated = (migrate ? migrate(legacyV1, 1) : {}) as Record<string, unknown>;

    expect(migrated).toEqual({ theme: 'sepia', mode: 'scroll', zoom: 1.5 });
    expect('lastPage' in migrated).toBe(false);
  });

  it('migrate tolerates an empty legacy payload', () => {
    const migrate = useReaderStore.persist.getOptions().migrate;
    const migrated = (migrate ? migrate(undefined, 0) : {}) as Record<string, unknown>;
    expect(migrated).toEqual({ theme: 'paper', mode: 'paged', zoom: 1 });
  });
});
