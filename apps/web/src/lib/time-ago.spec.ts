import { timeAgo } from './time-ago';

describe('timeAgo', () => {
  it('returns "Just now" for dates less than a minute ago', () => {
    const date = new Date(Date.now() - 30_000).toISOString();
    expect(timeAgo(date)).toBe('Just now');
  });

  it('returns singular "1 minute ago"', () => {
    const date = new Date(Date.now() - 60_000).toISOString();
    expect(timeAgo(date)).toBe('1 minute ago');
  });

  it('returns plural minutes ago', () => {
    const date = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(timeAgo(date)).toBe('5 minutes ago');
  });

  it('returns singular "1 hour ago"', () => {
    const date = new Date(Date.now() - 3_600_000).toISOString();
    expect(timeAgo(date)).toBe('1 hour ago');
  });

  it('returns plural hours ago', () => {
    const date = new Date(Date.now() - 3 * 3_600_000).toISOString();
    expect(timeAgo(date)).toBe('3 hours ago');
  });

  it('returns singular "1 day ago"', () => {
    const date = new Date(Date.now() - 86_400_000).toISOString();
    expect(timeAgo(date)).toBe('1 day ago');
  });

  it('returns plural days ago', () => {
    const date = new Date(Date.now() - 7 * 86_400_000).toISOString();
    expect(timeAgo(date)).toBe('7 days ago');
  });

  it('handles future dates as "Just now"', () => {
    const date = new Date(Date.now() + 60_000).toISOString();
    expect(timeAgo(date)).toBe('Just now');
  });

  it('handles invalid date strings without throwing', () => {
    expect(() => timeAgo('not-a-date')).not.toThrow();
  });
});
