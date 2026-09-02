import { Suspense } from 'react';
import type { Metadata } from 'next';
import { LoadingSpinner } from '../../../components/ui';
import BibleClient from './bible-client';

export const metadata: Metadata = {
  title: 'Bible — Transformlit',
};

export default function BibleRoute() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <BibleClient />
    </Suspense>
  );
}
