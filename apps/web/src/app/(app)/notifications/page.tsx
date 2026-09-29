import type { Metadata } from 'next';
import NotificationsClient from './notifications-client';

export const metadata: Metadata = {
  title: 'Notifications — TransformLit',
};

export default function Route() {
  return <NotificationsClient />;
}
