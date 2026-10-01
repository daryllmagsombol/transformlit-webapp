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
});
