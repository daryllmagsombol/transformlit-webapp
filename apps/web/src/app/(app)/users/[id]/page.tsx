import type { Metadata } from 'next';
import UserProfileClient from './user-profile-client';

export const metadata: Metadata = {
  title: 'User Profile — Transformlit',
};

export default function Route() {
  return <UserProfileClient />;
}
