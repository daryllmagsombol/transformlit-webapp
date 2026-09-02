import { useBibleStore } from './bible-store';

describe('useBibleStore', () => {
  beforeEach(() => {
    useBibleStore.setState({
      translation: 'BSB',
      lastPosition: {},
      indexStatus: {},
      isHydrated: true,
    });
  });

  it('defaults translation to BSB', () => {
    expect(useBibleStore.getState().translation).toBe('BSB');
  });

  it('sets translation', () => {
    useBibleStore.getState().setTranslation('ENGWEBP');
    expect(useBibleStore.getState().translation).toBe('ENGWEBP');
  });

  it('tracks last position per translation', () => {
    useBibleStore.getState().setLastPosition('BSB', { book: 'ROM', chapter: 8 });
    expect(useBibleStore.getState().lastPosition['BSB']).toEqual({ book: 'ROM', chapter: 8 });
  });

  it('tracks search index status', () => {
    useBibleStore.getState().setIndexStatus('BSB', 'ready');
    expect(useBibleStore.getState().indexStatus['BSB']).toBe('ready');
  });
});