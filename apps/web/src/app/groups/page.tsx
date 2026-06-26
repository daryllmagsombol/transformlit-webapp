import type { Metadata } from 'next';
import { AuthenticatedLayout } from '../../components/layout/authenticated-layout';
import GroupsClient from './groups-client';

export const metadata: Metadata = {
  title: 'Groups — Transformlit',
};

export default function Route() {
  return (
    <AuthenticatedLayout>
      <GroupsClient />
    </AuthenticatedLayout>
  );
}
