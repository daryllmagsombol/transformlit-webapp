'use client';

import { AuthenticatedLayout } from '../../components/layout/authenticated-layout';

export default function BooksPage() {
  return (
    <AuthenticatedLayout>
      <div className="space-y-6">
        <h1 className="text-h2 font-bold">Books</h1>
        <p className="text-ink-soft">Book browser and reader coming soon.</p>
      </div>
    </AuthenticatedLayout>
  );
}
