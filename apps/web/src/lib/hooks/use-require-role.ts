import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import type { UserRole } from '@transformlit/shared';
import { useAuthStore } from '../../store';

type RequireRoleResult = {
  /** True when auth state is hydrated AND the user's role is in `roles`. */
  isReady: boolean;
};

/**
 * Ensures the signed-in user holds one of the given global roles before
 * rendering protected content. Mirrors `useRequireAuth`'s hydration/redirect
 * behavior, then additionally requires `user.role` to be in `roles`.
 *
 * Returns `isReady = false` while:
 * - the auth store hasn't hydrated yet (prevents redirect flash on refresh),
 * - the store has no signed-in user, or
 * - the signed-in user's role is not allowed.
 *
 * Redirect rules:
 * - unauthenticated → `/login?redirect=<current path>` (same behavior as
 *   `useRequireAuth`; `/login` never gets a self-referential redirect), or
 * - non-staff (authenticated but role not allowed) → `/feed`.
 *
 * This guard is UX-only: the server authorizes every request independently, so
 * a stale persisted role can render the shell while its queries are denied.
 *
 * Usage:
 * ```tsx
 * const { isReady } = useRequireRole(UserRole.ADMIN, UserRole.MODERATOR);
 * if (!isReady) return <LoadingSpinner />;
 * // render staff-only content
 * ```
 */
export function useRequireRole(...roles: UserRole[]): RequireRoleResult {
  const router = useRouter();
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const isHydrated = useAuthStore((s) => s.isHydrated);

  const hasAllowedRole = user ? roles.some((role) => role === user.role) : false;

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    if (!user) {
      const redirect = pathname && pathname !== '/login' ? pathname : null;
      router.push(
        redirect
          ? `/login?redirect=${encodeURIComponent(redirect)}`
          : '/login',
      );
      return;
    }

    if (!hasAllowedRole) {
      router.push('/feed');
    }
  }, [isHydrated, user, hasAllowedRole, pathname, router]);

  // Protected content must not render until hydration completes AND the user is
  // known to hold an allowed role.
  const isReady = isHydrated && !!user && hasAllowedRole;
  return { isReady };
}
