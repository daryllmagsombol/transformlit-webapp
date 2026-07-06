import type { Metadata } from 'next';
import { AuthenticatedLayout } from '../../../components/layout/authenticated-layout';
import UserProfileClient from './user-profile-client';

export const metadata: Metadata = {
  title: 'User Profile — Transformlit',
};

export default function Route() {
  return (
    <AuthenticatedLayout>
      <UserProfileClient />
    </AuthenticatedLayout>
  );
}
