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
  const token = useAuthStore((s) => s.token);
  const isHydrated = useAuthStore((s) => s.isHydrated);

  useEffect(() => {
    if (isHydrated && token) {
      router.replace('/feed');
    }
  }, [isHydrated, token, router]);

  if (isHydrated && token) {
    return <LoadingSpinner showLabel={false} />;
  }

  return <>{children}</>;
}
