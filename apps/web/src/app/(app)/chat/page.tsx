import type { Metadata } from 'next';
import { ConversationList } from '../../../components/chat/conversation-list';

export const metadata: Metadata = {
  title: 'Chat — TransformLit',
};

export default function Route() {
  return (
    <>
      {/* Mobile: the list is the whole pane for /chat. Desktop renders the list
          in the layout aside, so this copy is hidden from `md` up. */}
      <div className="flex h-full min-h-0 flex-col md:hidden">
        <ConversationList />
      </div>
      {/* Desktop: no conversation selected yet. */}
      <div className="hidden flex-1 flex-col items-center justify-center py-24 text-center md:flex">
        <span className="material-symbols-outlined text-[80px] text-primary opacity-40 mb-4">
          chat_bubble
        </span>
        <h2 className="font-headline-h3 text-headline-h3 text-on-surface mb-2">
          Select a conversation
        </h2>
        <p className="font-body text-on-surface-variant max-w-xs">
          Choose a conversation from the list to start chatting.
        </p>
      </div>
    </>
  );
}
