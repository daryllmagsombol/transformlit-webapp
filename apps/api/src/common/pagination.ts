/** Largest page window any admin list endpoint will actually return. */
export const MAX_PAGE_SIZE = 100;

export interface PageWindow {
  page: number;
  pageSize: number;
}

/**
 * Clamps a requested 1-based `page` / `pageSize` to the window the list
 * services apply (`page >= 1`, `1 <= pageSize <= MAX_PAGE_SIZE`). Resolvers echo
 * the *effective* window so a response can never claim a wider window than the
 * service returned (ADM-30b).
 */
export function clampPageWindow(page: number, pageSize: number): PageWindow {
  return {
    page: Math.max(page, 1),
    pageSize: Math.min(Math.max(pageSize, 1), MAX_PAGE_SIZE),
  };
}
