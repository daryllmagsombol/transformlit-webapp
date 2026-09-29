import { ConversationList } from '../../../components/chat/conversation-list';

export default function ChatLayout({ children }: { readonly children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-0">
      {/*
        Desktop-only conversation list pane (320px, internal scroll). On mobile
        the list is rendered by /chat/page.tsx and the thread by /chat/[id], so
        each route shows a single pane.
      */}
      <aside className="hidden w-[320px] shrink-0 flex-col border-r border-outline-variant bg-surface md:flex">
        <ConversationList />
      </aside>
      <section className="flex min-w-0 flex-1 flex-col">{children}</section>
    </div>
  );
}
