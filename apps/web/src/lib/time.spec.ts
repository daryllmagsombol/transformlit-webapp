import { relativeTime } from './time';

describe('relativeTime', () => {
  const now = Date.now();
  const at = (msAgo: number) => new Date(now - msAgo).toISOString();

  it('returns Just now under a minute', () => {
    expect(relativeTime(at(30_000))).toBe('Just now');
  });
  it('returns minutes', () => {
    expect(relativeTime(at(5 * 60_000))).toBe('5m ago');
  });
  it('returns hours', () => {
    expect(relativeTime(at(3 * 3_600_000))).toBe('3h ago');
  });
  it('returns Yesterday for ~1 day', () => {
    expect(relativeTime(at(26 * 3_600_000))).toBe('Yesterday');
  });
  it('returns days under a week', () => {
    expect(relativeTime(at(3 * 86_400_000))).toBe('3d ago');
  });
  it('returns a locale date for older', () => {
    expect(relativeTime(at(30 * 86_400_000))).toBe(new Date(at(30 * 86_400_000)).toLocaleDateString());
  });
});