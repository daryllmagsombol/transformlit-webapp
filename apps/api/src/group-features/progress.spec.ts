import { expectedPercent, memberPercent, isOnPace } from './progress.js';

describe('expectedPercent', () => {
  const start = new Date('2026-01-10T00:00:00Z');
  const target = new Date('2026-01-20T00:00:00Z');

  it('returns 0 before the window starts', () => {
    expect(expectedPercent(start, target, new Date('2026-01-05T00:00:00Z'))).toBe(0);
  });

  it('returns 0 exactly at the start', () => {
    expect(expectedPercent(start, target, start)).toBe(0);
  });

  it('returns the elapsed fraction rounded', () => {
    expect(expectedPercent(start, target, new Date('2026-01-15T00:00:00Z'))).toBe(50);
  });

  it('rounds a non-exact fraction to a whole percent', () => {
    expect(
      expectedPercent(new Date('2026-01-01T00:00:00Z'), new Date('2026-01-04T00:00:00Z'), new Date('2026-01-02T00:00:00Z')),
    ).toBe(33);
  });

  it('returns 100 exactly at the target', () => {
    expect(expectedPercent(start, target, target)).toBe(100);
  });

  it('returns 100 after the target', () => {
    expect(expectedPercent(start, target, new Date('2026-02-01T00:00:00Z'))).toBe(100);
  });

  it('returns 100 for a zero-length window (start equals target)', () => {
    expect(expectedPercent(start, start, new Date('2026-01-15T00:00:00Z'))).toBe(100);
  });
});

describe('memberPercent', () => {
  it('returns 0 when totalPages is null', () => {
    expect(memberPercent(42, null)).toBe(0);
  });

  it('returns 0 when totalPages is zero', () => {
    expect(memberPercent(42, 0)).toBe(0);
  });

  it('returns 0 for zero progress', () => {
    expect(memberPercent(0, 100)).toBe(0);
  });

  it('rounds currentPage / totalPages to a whole percent', () => {
    expect(memberPercent(1, 3)).toBe(33);
  });

  it('clamps values above 100', () => {
    expect(memberPercent(150, 100)).toBe(100);
  });

  it('clamps negative values to 0', () => {
    expect(memberPercent(-5, 100)).toBe(0);
  });
});

describe('isOnPace', () => {
  it('is true when progress is within the default tolerance', () => {
    expect(isOnPace(45, 50)).toBe(true);
  });

  it('is true exactly at the tolerance boundary', () => {
    expect(isOnPace(40, 50)).toBe(true);
  });

  it('is false one point outside the tolerance boundary', () => {
    expect(isOnPace(39, 50)).toBe(false);
  });

  it('respects a custom tolerance', () => {
    expect(isOnPace(24, 50, 25)).toBe(false);
    expect(isOnPace(25, 50, 25)).toBe(true);
  });
});
