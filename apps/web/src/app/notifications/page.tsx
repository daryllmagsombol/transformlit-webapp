import type { Metadata } from 'next';
import { AuthenticatedLayout } from '../../components/layout/authenticated-layout';
import NotificationsClient from './notifications-client';

export const metadata: Metadata = {
  title: 'Notifications — Transformlit',
};

export default function Route() {
  return (
    <AuthenticatedLayout>
      <NotificationsClient />
    </AuthenticatedLayout>
  );
}
