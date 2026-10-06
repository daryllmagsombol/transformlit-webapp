const UTC_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * Formats an instant as its UTC+8 (e.g. Asia/Manila) calendar day, `YYYY-MM-DD`.
 * Mirrors the verse-of-the-day computation in feed.service.ts.
 */
export function toDayKey(date: Date): string {
  const shifted = new Date(date.getTime() + UTC_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Lexicographic day-key bounds for a calendar year in UTC+8.
 * `endDayKey` is exclusive (first day of the following year).
 */
export function yearBounds(year: number): { startDayKey: string; endDayKey: string } {
  return { startDayKey: `${year}-01-01`, endDayKey: `${year + 1}-01-01` };
}
