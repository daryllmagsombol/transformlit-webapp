import type { Metadata } from 'next';
import GroupsClient from './groups-client';

export const metadata: Metadata = {
  title: 'Groups — Transformlit',
};

export default function Route() {
  return <GroupsClient />;
}
