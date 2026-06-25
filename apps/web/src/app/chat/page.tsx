import type { Metadata } from 'next';
import ChatClient from './chat-client';

export const metadata: Metadata = {
  title: 'Chat — Transformlit',
};

export default function Route() {
  return <ChatClient />;
}
