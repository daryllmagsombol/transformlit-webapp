'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '../store';

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
    return (
      <div className="min-h-dvh flex items-center justify-center bg-surface">
        <div className="w-10 h-10 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return <>{children}</>;
}
