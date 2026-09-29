import type { Metadata } from 'next';
import UsersClient from './users-client';

export const metadata: Metadata = {
  title: 'Members — TransformLit',
};

export default function Route() {
  return <UsersClient />;
}
