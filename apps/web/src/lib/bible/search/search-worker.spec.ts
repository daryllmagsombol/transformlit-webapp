import type { CompleteTranslation } from '../types';

const complete: CompleteTranslation = {
  translation: { id: 'ENGWEBP', name: 'World English Bible', shortName: 'WEBP' },
  books: [
    {
      id: 'JHN',
      commonName: 'John',
      order: 43,
      numberOfChapters: 1,
      totalNumberOfVerses: 1,
      chapters: [{ chapter: { number: 1, content: [{ type: 'verse', number: 1, content: ['In the beginning was the Word.'] }] } }],
    },
  ],
};

const corpus = {
  verses: ['In the beginning was the Word.'],
  refs: [{ b: 'JHN', c: 1, v: 1 }],
};

describe('search worker', () => {
  let postMessage: jest.Mock;

  beforeEach(() => {
    postMessage = jest.fn();
    Object.defineProperty(self, 'postMessage', {
      value: postMessage,
      writable: true,
      configurable: true,
    });
    jest.resetModules();
    require('./search-worker');
  });

  it('builds an index and posts it back', () => {
    const onmessage = (self as { onmessage?: (e: MessageEvent) => void }).onmessage;
    expect(onmessage).toBeDefined();
    onmessage!({ data: { kind: 'build', id: 1, payload: complete } } as MessageEvent);

    expect(postMessage).toHaveBeenCalledWith({
      id: 1,
      kind: 'built',
      corpus: expect.objectContaining({ verses: ['In the beginning was the Word.'] }),
    });
  });

  it('searches a corpus and posts the results', () => {
    const onmessage = (self as { onmessage?: (e: MessageEvent) => void }).onmessage;
    onmessage!({
      data: { kind: 'search', id: 2, payload: { corpus, query: 'Word', limit: 5 } },
    } as MessageEvent);

    expect(postMessage).toHaveBeenCalledWith({
      id: 2,
      kind: 'results',
      results: expect.arrayContaining([expect.objectContaining({ b: 'JHN', c: 1, v: 1 })]),
    });
  });
});