import type { Metadata } from 'next';
import { ConversationList } from '../../../components/chat/conversation-list';

export const metadata: Metadata = {
  title: 'Chat — Transformlit',
};

export default function Route() {
  return (
    <>
      <div className="md:hidden">
        <h1 className="font-display font-headline-h1 text-on-surface mb-6">Chat</h1>
        <ConversationList />
      </div>
      <div className="hidden md:flex flex-col items-center justify-center py-24 text-center">
        <span className="material-symbols-outlined text-[80px] text-primary opacity-40 mb-4">chat_bubble</span>
        <h2 className="font-display font-headline-h3 text-on-surface mb-2">Select a conversation</h2>
        <p className="font-body text-on-surface-variant max-w-xs">
          Choose a conversation from the list to start chatting.
        </p>
      </div>
    </>
  );
}