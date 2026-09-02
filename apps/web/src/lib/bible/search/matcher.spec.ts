import { searchCorpus } from './matcher';
import type { SearchCorpus } from './build-index';

const corpus: SearchCorpus = {
  verses: [
    'In the beginning was the Word, and the Word was with God.',
    'For God so loved the world, that he gave his only Son.',
    'Love is patient, love is kind.',
  ],
  refs: [
    { b: 'JHN', c: 1, v: 1 },
    { b: 'JHN', c: 3, v: 16 },
    { b: '1CO', c: 13, v: 4 },
  ],
};

describe('searchCorpus', () => {
  it('matches case-insensitively', () => {
    const results = searchCorpus(corpus, 'GOD');
    expect(results.map((r) => r.b)).toEqual(['JHN', 'JHN']);
  });

  it('returns refs with snippet and match offsets', () => {
    const results = searchCorpus(corpus, 'loved');
    expect(results).toHaveLength(1);
    expect(results[0].b).toBe('JHN');
    expect(results[0].c).toBe(3);
    expect(results[0].v).toBe(16);
    // offsets are relative to the SNIPPET (which may carry ellipses), not the raw verse
    expect(results[0].snippet.slice(results[0].matchStart, results[0].matchEnd)).toBe('loved');
    expect(results[0].snippet).toContain('loved');
  });

  it('returns empty for no matches', () => {
    expect(searchCorpus(corpus, 'zzz')).toEqual([]);
  });

  it('limits results', () => {
    expect(searchCorpus(corpus, 'a', 2)).toHaveLength(2);
  });
});