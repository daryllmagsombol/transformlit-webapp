import type { Metadata } from 'next';
import ProgressClient from './progress-client';

export const metadata: Metadata = {
  title: 'Reading Progress — TransformLit',
};

export default function Route() {
  return <ProgressClient />;
}
