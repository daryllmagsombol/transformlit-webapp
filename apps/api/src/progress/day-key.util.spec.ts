import { toDayKey, yearBounds } from './day-key.util.js';

describe('toDayKey', () => {
  it('formats a UTC instant as its UTC+8 calendar day', () => {
    expect(toDayKey(new Date('2026-10-06T00:00:00Z'))).toBe('2026-10-06');
  });

  it('rolls to the next day after 16:00 UTC (UTC+8 midnight)', () => {
    expect(toDayKey(new Date('2026-10-06T16:00:00Z'))).toBe('2026-10-07');
  });

  it('maps Dec 31 23:30 UTC to Jan 1 of the next year', () => {
    expect(toDayKey(new Date('2026-12-31T23:30:00Z'))).toBe('2027-01-01');
  });
});

describe('yearBounds', () => {
  it('returns lexicographic dayKey bounds for the year', () => {
    expect(yearBounds(2026)).toEqual({ startDayKey: '2026-01-01', endDayKey: '2027-01-01' });
  });
});
