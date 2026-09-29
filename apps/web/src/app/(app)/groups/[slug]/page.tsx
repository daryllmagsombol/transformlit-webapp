import type { Metadata } from 'next';
import { GroupDetailClient } from '../../../../components/groups/group-detail-client';

export const metadata: Metadata = { title: 'Group — TransformLit' };

export default async function GroupDetailPage({
  params,
}: {
  readonly params: Promise<{ readonly slug: string }>;
}) {
  const { slug } = await params;
  return <GroupDetailClient slug={slug} />;
}
