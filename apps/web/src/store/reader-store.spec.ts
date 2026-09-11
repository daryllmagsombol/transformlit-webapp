import { useReaderStore } from './reader-store';

describe('reader store', () => {
  beforeEach(() => {
    useReaderStore.setState({ theme: 'paper', mode: 'paged', zoom: 1, lastPage: {} });
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

  it('records last page per book', () => {
    useReaderStore.getState().setLastPage('book-1', 12);
    useReaderStore.getState().setLastPage('book-2', 3);
    expect(useReaderStore.getState().lastPage).toEqual({ 'book-1': 12, 'book-2': 3 });
  });
});
