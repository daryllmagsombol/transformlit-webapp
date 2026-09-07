'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '../store';
import { LoadingSpinner } from '../components/ui/loading-spinner';

/**
 * Redirects authenticated users away from public pages (home, login, register)
 * to the feed. Only renders children while unauthenticated or before hydration.
 */
export default function AuthRedirect({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const isHydrated = useAuthStore((s) => s.isHydrated);

  useEffect(() => {
    if (isHydrated && user) {
      router.replace('/feed');
    }
  }, [isHydrated, user, router]);

  if (isHydrated && user) {
    return <LoadingSpinner showLabel={false} />;
  }

  return <>{children}</>;
}
