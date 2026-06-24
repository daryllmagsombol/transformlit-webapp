'use client';

import { AuthenticatedLayout } from '../../components/layout/authenticated-layout';

export default function GroupsPage() {
  return (
    <AuthenticatedLayout>
      <div className="space-y-6">
        <h1 className="text-h2 font-bold">Groups</h1>
        <p className="text-ink-soft">Group management coming soon.</p>
      </div>
    </AuthenticatedLayout>
  );
}
