import type { Metadata } from 'next';
import BooksClient from './books-client';

export const metadata: Metadata = {
  title: 'Books — Transformlit',
};

export default function Route() {
  return <BooksClient />;
}
