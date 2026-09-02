import type { Metadata } from 'next';
import { ChatThread } from '../../../../components/chat/chat-thread';

export const metadata: Metadata = {
  title: 'Chat — Transformlit',
};

export default async function Route({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ChatThread conversationId={id} />;
}