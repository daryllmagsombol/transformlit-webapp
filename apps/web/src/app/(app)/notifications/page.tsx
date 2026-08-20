import type { Metadata } from 'next';
import NotificationsClient from './notifications-client';

export const metadata: Metadata = {
  title: 'Notifications — Transformlit',
};

export default function Route() {
  return <NotificationsClient />;
}
