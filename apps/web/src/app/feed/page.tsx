import type { Metadata } from 'next';
import FeedClient from './feed-client';
import { FeedWrapper } from './feed-wrapper';

export const metadata: Metadata = {
  title: 'Feed — Transformlit',
};

export default function FeedRoute() {
  return (
    <FeedWrapper>
      <FeedClient />
    </FeedWrapper>
  );
}
