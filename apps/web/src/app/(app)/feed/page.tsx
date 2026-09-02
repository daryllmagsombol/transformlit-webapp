import type { Metadata } from 'next';
import FeedClient from './feed-client';

export const metadata: Metadata = {
  title: 'Feed — Transformlit',
};

export default function FeedRoute() {
  return <FeedClient />;
}
