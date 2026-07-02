import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '../../store';

type RequireAuthResult = {
  /** True when auth state is hydrated AND a token exists. */
  isReady: boolean;
};

/**
 * Ensures the user is authenticated before rendering protected content.
 *
 * Returns `isReady = false` while:
 * - the auth store hasn't hydrated yet (prevents redirect flash on refresh), or
 * - the user has no token
 *
 * When hydration completes and no token is present, redirects to /login.
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
  const token = useAuthStore((s) => s.token);
  const isHydrated = useAuthStore((s) => s.isHydrated);

  useEffect(() => {
    if (isHydrated && !token) {
      router.push('/login');
    }
  }, [isHydrated, token, router]);

  const isReady = isHydrated && !!token;
  return { isReady };
}
