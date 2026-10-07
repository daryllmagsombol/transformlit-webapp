const clampPercent = (value: number): number => Math.min(100, Math.max(0, value));

/**
 * Percent of a start→target window that has elapsed by `today`, clamped 0..100.
 * Before the start → 0; at or after the target → 100; a zero-length window → 100.
 */
export function expectedPercent(start: Date, target: Date, today: Date): number {
  const total = target.getTime() - start.getTime();
  if (total <= 0) {
    return 100;
  }

  const elapsed = today.getTime() - start.getTime();
  if (elapsed <= 0) {
    return 0;
  }
  if (elapsed >= total) {
    return 100;
  }

  return clampPercent(Math.round((elapsed / total) * 100));
}

/**
 * A member's completion percent for a book, clamped 0..100.
 * Returns 0 when the book has no known page count.
 */
export function memberPercent(currentPage: number, totalPages: number | null): number {
  if (!totalPages) {
    return 0;
  }

  return clampPercent(Math.round((currentPage / totalPages) * 100));
}

/**
 * Whether a member's percent is on pace versus the expected percent,
 * allowing a tolerance of missed percent points (default 10).
 */
export function isOnPace(percent: number, expected: number, tolerance = 10): boolean {
  return percent + tolerance >= expected;
}
