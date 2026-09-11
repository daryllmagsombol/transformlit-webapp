import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuthStore } from '../../store';

type RequireAuthResult = {
  /** True when auth state is hydrated AND a signed-in user exists. */
  isReady: boolean;
};

/**
 * Ensures the user is authenticated before rendering protected content.
 *
 * Returns `isReady = false` while:
 * - the auth store hasn't hydrated yet (prevents redirect flash on refresh), or
 * - the store has no signed-in user
 *
 * When hydration completes and no user is present, redirects to
 * `/login?redirect=<current path>` so the user can return to the page they
 * originally tried to visit after signing in. The `/login` route itself is
 * never given a redirect query (avoids a self-referential loop).
 *
 * Usage:
 * ```tsx
 * const { isReady } = useRequireAuth();
 * if (!isReady) return <LoadingSpinner />;
 * // render protected content
 * ```
 */
export function useRequireAuth(): RequireAuthResult {
  const router = useRouter();
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const isHydrated = useAuthStore((s) => s.isHydrated);

  useEffect(() => {
    if (isHydrated && !user) {
      const redirect = pathname && pathname !== '/login' ? pathname : null;
      router.push(
        redirect
          ? `/login?redirect=${encodeURIComponent(redirect)}`
          : '/login',
      );
    }
  }, [isHydrated, user, pathname, router]);

  // Protected content must not render until hydration completes AND the user
  // presence is known, otherwise a brief unauthenticated frame could flash for
  // an actually-logged-in user.
  const isReady = isHydrated && !!user;
  return { isReady };
}
