import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Group — Transformlit',
};

export default async function GroupDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  return (
    <div className="space-y-6">
      <h1 className="font-display text-headline-h2 text-on-surface capitalize">{slug.replace(/-/g, ' ')}</h1>
      <p className="font-body text-body text-on-surface-variant">Group detail view coming soon.</p>
    </div>
  );
}
