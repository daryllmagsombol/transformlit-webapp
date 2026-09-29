import type { Metadata } from 'next';
import FriendsClient from './friends-client';

export const metadata: Metadata = {
  title: 'Friends — TransformLit',
};

export default function Route() {
  return <FriendsClient />;
}
