import type { Metadata } from 'next';
import { AuthenticatedLayout } from '../../components/layout/authenticated-layout';
import BooksClient from './books-client';

export const metadata: Metadata = {
  title: 'Books — Transformlit',
};

export default function Route() {
  return (
    <AuthenticatedLayout>
      <BooksClient />
    </AuthenticatedLayout>
  );
}
