import type { Metadata } from 'next';
import { AuthenticatedLayout } from '../../components/layout/authenticated-layout';
import FriendsClient from './friends-client';

export const metadata: Metadata = {
  title: 'Friends — Transformlit',
};

export default function Route() {
  return (
    <AuthenticatedLayout>
      <FriendsClient />
    </AuthenticatedLayout>
  );
}
