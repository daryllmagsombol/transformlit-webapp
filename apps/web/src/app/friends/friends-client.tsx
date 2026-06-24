'use client';

import { AuthenticatedLayout } from '../../components/layout/authenticated-layout';

export default function FriendsPage() {
  return (
    <AuthenticatedLayout>
      <div className="space-y-6">
        <h1 className="text-h2 font-bold">Friends</h1>
        <p className="text-ink-soft">Friend management coming soon.</p>
      </div>
    </AuthenticatedLayout>
  );
}
