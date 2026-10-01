import { useBibleStore } from './bible-store';

describe('useBibleStore', () => {
  beforeEach(() => {
    useBibleStore.setState({
      translation: 'BSB',
      subject: null,
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

  it('resets navigation preferences when the account subject changes', () => {
    const store = useBibleStore.getState();
    store.setAccountSubject('user-a');
    store.setLastPosition('BSB', { book: 'ROM', chapter: 8 });
    store.setIndexStatus('BSB', 'ready');
    expect(useBibleStore.getState().lastPosition['BSB']).toBeDefined();

    // Switching accounts must not leak the previous account's position/index.
    store.setAccountSubject('user-b');
    expect(useBibleStore.getState().lastPosition).toEqual({});
    expect(useBibleStore.getState().indexStatus).toEqual({});
    expect(useBibleStore.getState().subject).toBe('user-b');
  });

  it('drives an account switch through the public seam without leaking position', () => {
    // Simulates the Task 13A activation transition calling the public seam:
    // authorize account A, record a position, then activate account B.
    const activate = (subject: string) => useBibleStore.getState().setAccountSubject(subject);

    activate('subject-a');
    useBibleStore.getState().setLastPosition('BSB', { book: 'JHN', chapter: 3 });

    activate('subject-b');
    expect(useBibleStore.getState().lastPosition).toEqual({});
    expect(useBibleStore.getState().subject).toBe('subject-b');
    expect(useBibleStore.getState().translation).toBe('BSB');

    // The persistence projection must carry the new subject, not account A's data.
    const partialize = useBibleStore.persist.getOptions().partialize;
    const persisted = (partialize ? partialize(useBibleStore.getState()) : {}) as Record<string, unknown>;
    expect(persisted.subject).toBe('subject-b');
    expect(persisted.lastPosition).toEqual({});
  });

  it('keeps the same subject position when re-selecting the same account', () => {
    const store = useBibleStore.getState();
    store.setAccountSubject('user-a');
    store.setLastPosition('BSB', { book: 'ROM', chapter: 8 });
    store.setAccountSubject('user-a');
    expect(useBibleStore.getState().lastPosition['BSB']).toEqual({ book: 'ROM', chapter: 8 });
  });

  it('never exposes a Bible outbox queue', () => {
    const state = useBibleStore.getState() as unknown as Record<string, unknown>;
    expect('enqueueOutbox' in state).toBe(false);
    expect('outbox' in state).toBe(false);
    expect('queueOperation' in state).toBe(false);
  });

  it('drops ambiguous legacy unscoped position on rehydrate', () => {
    const merge = useBibleStore.persist.getOptions().merge;
    const legacy = { translation: 'BSB', lastPosition: { BSB: { book: 'ROM', chapter: 8 } } };
    const current = useBibleStore.getState();
    const merged = (merge ? merge(legacy, current) : current) as typeof current;

    expect(merged.subject).toBeNull();
    expect(merged.lastPosition).toEqual({});
  });
});
