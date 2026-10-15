'use client';

import { UserRole } from '@transformlit/shared';
import { useRequireRole } from '../../../lib/hooks/use-require-role';
import { LoadingSpinner } from '../../../components/ui';

/**
 * Guardian for the whole `/admin` subtree. The surrounding `(app)` layout
 * already mounts `AuthenticatedLayout`/`AppShell`, so this layout only adds the
 * UX role gate and never re-wraps the shell (which would double the sidebar).
 *
 * The server enforces authorization on every admin query independently; this
 * gate only prevents non-staff from seeing a shell whose requests would 403.
 */
export default function AdminLayout({ children }: { readonly children: React.ReactNode }) {
  const { isReady } = useRequireRole(UserRole.ADMIN, UserRole.MODERATOR);

  if (!isReady) {
    return <LoadingSpinner />;
  }

  return <>{children}</>;
}
