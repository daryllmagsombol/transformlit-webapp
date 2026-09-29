import type { Metadata } from 'next';
import GroupsClient from './groups-client';

export const metadata: Metadata = {
  title: 'Groups — TransformLit',
};

export default function Route() {
  return <GroupsClient />;
}
